import { createHash } from "node:crypto";
import { posix } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import semver from "semver";
import { node, finalize } from "./graph.js";
import { parseManifest } from "./parsers.js";
import type { Graph, PackageNode, Project, Provenance } from "../shared/types.js";
import type { SourceFile } from "./discovery.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 20);
const exact = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9][0-9A-Za-z.!+_-]*$/.test(s);
function rootFor(p: Project, version = "0.0.0") {
  const n = node(
    p.ecosystem,
    p.ecosystem === "maven" ? `repository:${p.id}` : p.name,
    exact(version) ? version : "0.0.0",
    "service",
  );
  n.id = "service-" + p.id;
  n.name = p.name;
  n.projectId = p.id;
  n.path = p.path;
  return n;
}
export function resolveProject(project: Project, files: SourceFile[]): Graph {
  const lock = files.find((f) => f.filename === project.lockfile);
  const manifest = files.find((f) => f.filename === project.manifest);
  if (lock && /(?:package-lock|npm-shrinkwrap)\.json$/.test(lock.filename))
    return npmLock(project, lock, manifest);
  if (lock?.filename.endsWith("pnpm-lock.yaml")) return pnpmLock(project, lock, manifest);
  if (lock && /(?:uv|poetry)\.lock$/.test(lock.filename)) return pythonLock(project, lock);
  if (project.ecosystem === "npm") return npmManifest(project, manifest);
  const preferred = lock && !lock.filename.endsWith("yarn.lock") ? lock : manifest;
  if (!preferred)
    return {
      nodes: [rootFor(project)],
      edges: [],
      warnings: ["No readable dependency snapshot was found."],
    };
  if (/pyproject.toml|setup.py|setup.cfg|Pipfile$/.test(preferred.filename))
    return pythonManifest(project, preferred);
  const graph = parseManifest(preferred.filename, preferred.content, preferred.provenance);
  const ids = new Map(
    graph.nodes.map((n) => [
      n.id,
      n.kind === "service" ? "service-" + project.id : hash(project.id + ":" + n.id),
    ]),
  );
  graph.nodes.forEach((n) => {
    n.id = ids.get(n.id)!;
    n.projectId = project.id;
    if (n.kind === "service") {
      n.name = project.name;
      n.path = project.path;
    }
    if (project.ecosystem === "pypi") {
      n.relationship = "listed";
      n.scope = n.scope === "development" ? "development" : "unknown";
    }
  });
  graph.edges.forEach((e) => {
    e.from = ids.get(e.from)!;
    e.to = ids.get(e.to)!;
    e.projectId = project.id;
    if (project.ecosystem === "pypi") e.relationship = "listed";
  });
  return finalize(graph);
}
function npmLock(p: Project, file: SourceFile, manifest?: SourceFile): Graph {
  const data = JSON.parse(file.content);
  const info = manifest ? JSON.parse(manifest.content) : {};
  if (![2, 3].includes(data.lockfileVersion) || !data.packages)
    return {
      ...npmManifest(p, manifest),
      warnings: [
        "This npm lockfile version is unsupported; only exact manifest pins were imported.",
      ],
    };
  const entries = data.packages as Record<string, any>;
  const base = posix.dirname(file.filename);
  const entry = posix.relative(base, p.path === "." ? "." : p.path);
  if (!Object.hasOwn(entries, entry)) {
    const g = npmManifest(p, manifest);
    g.warnings.push(
      "The parent lockfile does not record this workspace. Indirect relationships could not be determined.",
    );
    return g;
  }
  const root = rootFor(p, info.version || entries[entry].version);
  root.provenance = [file.provenance];
  const graph: Graph = { nodes: [root], edges: [], warnings: [] };
  const byPath = new Map<string, PackageNode>();
  const pending: string[] = [];
  const resolvePath = (from: string, name: string): string | undefined => {
    let at = from;
    while (true) {
      const path = (at ? at + "/" : "") + "node_modules/" + name;
      let record = entries[path];
      if (record) {
        if (record.link) {
          const target = record.resolved;
          if (typeof target !== "string" || !Object.hasOwn(entries, target)) {
            graph.warnings.push(`Workspace link ${name} is missing its target.`);
            return;
          }
          return target;
        }
        return path;
      }
      if (!at) return;
      at = posix.dirname(at);
      if (at === ".") at = "";
    }
  };
  function add(path: string) {
    let n = byPath.get(path);
    if (n) return n;
    const record = entries[path];
    const name = record.name || path.split("node_modules/").pop()!;
    if (!exact(record.version)) {
      graph.warnings.push(`Installed version is missing for ${name}.`);
      return;
    }
    n = node("npm", name, record.version);
    n.id = hash(file.filename + ":" + path + ":" + n.purl);
    n.scope = record.dev ? "development" : "runtime";
    n.relationship = "known";
    n.provenance = [file.provenance];
    n.license = typeof record.license === "string" ? record.license : undefined;
    byPath.set(path, n);
    graph.nodes.push(n);
    pending.push(path);
    return n;
  }
  function connect(parent: PackageNode, path: string, record: any, isRoot = false) {
    const deps = {
      ...record.dependencies,
      ...record.optionalDependencies,
      ...record.peerDependencies,
      ...(isRoot ? record.devDependencies : {}),
    };
    for (const [name, requested] of Object.entries(deps)) {
      const resolved = resolvePath(path, name);
      const child = resolved ? add(resolved) : undefined;
      if (child) {
        graph.edges.push({
          from: parent.id,
          to: child.id,
          projectId: p.id,
          scope:
            isRoot && record.devDependencies?.[name] && !record.dependencies?.[name]
              ? "development"
              : "runtime",
          relationship: "known",
        });
        if (
          typeof requested === "string" &&
          semver.validRange(requested) &&
          !semver.satisfies(child.version, requested)
        )
          graph.warnings.push(
            `Lockfile version for ${name} does not satisfy its declared range ${requested}; regenerate the lockfile.`,
          );
      } else if (!record.optionalDependencies?.[name] && !record.peerDependencies?.[name])
        graph.warnings.push(
          `Could not determine the installed dependency ${name} used by ${parent.name}.`,
        );
    }
  }
  connect(root, entry, { ...entries[entry], ...info }, true);
  for (let i = 0; i < pending.length; i++) {
    if (i >= 10000) {
      graph.warnings.push(
        "Large project: dependency expansion stopped at 10,000 installed entries.",
      );
      break;
    }
    const path = pending[i];
    connect(byPath.get(path)!, path, entries[path]);
  }
  if (!graph.nodes.some((n) => n.kind === "package"))
    graph.warnings.push("No installed package dependencies were found for this project.");
  return finalize(graph);
}
function npmManifest(p: Project, file?: SourceFile): Graph {
  const data = file ? JSON.parse(file.content) : {};
  const root = rootFor(p, data.version);
  const graph: Graph = {
    nodes: [root],
    edges: [],
    warnings: [
      "No supported resolved lockfile is available. Only exact direct pins are shown; indirect relationships are unknown.",
    ],
  };
  for (const [name, version] of Object.entries({
    ...data.dependencies,
    ...data.optionalDependencies,
    ...data.devDependencies,
  })) {
    if (!semver.valid(version as string)) {
      graph.warnings.push(
        `${name}: ${String(version)} is not an exact installed version; omitted from vulnerability checks.`,
      );
      continue;
    }
    const n = node("npm", name, version as string);
    n.id = hash(p.id + ":" + n.purl);
    n.provenance = file ? [file.provenance] : [];
    n.scope = data.dependencies?.[name] ? "runtime" : "development";
    n.relationship = "known";
    graph.nodes.push(n);
    graph.edges.push({ from: root.id, to: n.id, scope: n.scope, projectId: p.id });
  }
  return finalize(graph);
}
function pnpmLock(p: Project, file: SourceFile, manifest?: SourceFile): Graph {
  const data = parseYaml(file.content, { maxAliasCount: 50 });
  const base = posix.dirname(file.filename);
  const key = posix.relative(base, p.path) || ".";
  const importer = data.importers?.[key] || (key === "." ? data : undefined);
  if (!importer) {
    const g = npmManifest(p, manifest);
    g.warnings.push("This project is not an importer in the parent pnpm lockfile.");
    return g;
  }
  const root = rootFor(p);
  const graph: Graph = { nodes: [root], edges: [], warnings: [] };
  const records = data.snapshots || data.packages || {};
  const packages = data.packages || {};
  const visited = new Map<string, PackageNode>();
  const queue: { n: PackageNode; key: string }[] = [];
  function connect(parent: PackageNode, name: string, value: any, scope: PackageNode["scope"]) {
    const raw = typeof value === "string" ? value : value?.version;
    if (typeof raw !== "string") return;
    if (/^(link:|workspace:|file:)/.test(raw)) {
      graph.warnings.push(`Local pnpm link ${name} is not expanded by this importer.`);
      return;
    }
    const candidates = [`${name}@${raw}`, `/${name}@${raw}`, `/${name}/${raw}`];
    const recordKey = candidates.find((k) => Object.hasOwn(records, k));
    const version = raw.split("(")[0].split("_")[0];
    if (!exact(version)) {
      graph.warnings.push(`Could not read the installed pnpm version of ${name}.`);
      return;
    }
    const id = recordKey || `${name}@${raw}`;
    let n = visited.get(id);
    if (!n) {
      n = node("npm", name, version);
      n.id = hash(file.filename + ":" + id);
      n.scope = scope;
      n.provenance = [file.provenance];
      n.relationship = "known";
      visited.set(id, n);
      graph.nodes.push(n);
      if (recordKey) queue.push({ n, key: recordKey });
      else graph.warnings.push(`Indirect relationships are missing for ${name}@${version}.`);
    }
    if (scope === "runtime") n.scope = "runtime";
    graph.edges.push({ from: parent.id, to: n.id, projectId: p.id, scope });
  }
  for (const group of ["dependencies", "optionalDependencies", "devDependencies"])
    for (const [name, v] of Object.entries(importer[group] || {}))
      connect(root, name, v, group === "devDependencies" ? "development" : "runtime");
  for (let i = 0; i < queue.length; i++) {
    if (i >= 10000) {
      graph.warnings.push("Large pnpm graph: expansion was limited to 10,000 entries.");
      break;
    }
    const { n, key } = queue[i];
    const record = records[key] || packages[key];
    for (const [name, v] of Object.entries({
      ...record.dependencies,
      ...record.optionalDependencies,
    }))
      connect(n, name, v, n.scope);
  }
  return finalize(graph);
}
function pythonLock(p: Project, file: SourceFile): Graph {
  const doc = parseToml(file.content) as any;
  const records = doc.package || [];
  const root = rootFor(p);
  const graph: Graph = { nodes: [root], edges: [], warnings: [] };
  const byName = new Map<string, PackageNode[]>();
  const normalize = (n: string) => n.toLowerCase().replace(/[-_.]+/g, "-");
  for (const record of records) {
    if (
      !exact(record.version) ||
      record.source?.editable !== undefined ||
      record.source?.virtual !== undefined
    )
      continue;
    const n = node("pypi", record.name, record.version);
    n.id = hash(p.id + ":" + n.purl);
    n.provenance = [file.provenance];
    n.scope = "unknown";
    n.relationship = "listed";
    graph.nodes.push(n);
    const name = normalize(n.name);
    byName.set(name, [...(byName.get(name) || []), n]);
  }
  for (const record of records) {
    const from = (byName.get(normalize(record.name)) || []).find(
      (n) => n.version === record.version,
    );
    if (!from) continue;
    const deps = Array.isArray(record.dependencies)
      ? record.dependencies
      : Object.keys(record.dependencies || {}).map((name) => ({ name }));
    for (const d of deps) {
      const options = (byName.get(normalize(d.name)) || []).filter(
        (n) => !d.version || n.version === d.version,
      );
      if (options.length === 1) {
        graph.edges.push({
          from: from.id,
          to: options[0].id,
          projectId: p.id,
          relationship: "known",
          scope: "unknown",
        });
      } else
        graph.warnings.push(
          `Conditional or ambiguous Python dependency: ${record.name} → ${d.name}.`,
        );
    }
  }
  // Python lockfiles can cover multiple environments; root membership is not guessed.
  for (const n of graph.nodes.filter((n) => n.kind === "package"))
    graph.edges.push({
      from: root.id,
      to: n.id,
      projectId: p.id,
      relationship: "listed",
      scope: "unknown",
    });
  graph.warnings.push(
    "Python lockfile versions and recorded package edges are shown. Root membership, environment markers and optional groups are not fully resolved; dashed root links mean listed packages, not proven direct dependencies.",
  );
  return finalize(graph);
}
function pythonManifest(p: Project, file: SourceFile): Graph {
  const root = rootFor(p);
  const graph: Graph = {
    nodes: [root],
    edges: [],
    warnings: [
      "No exact resolved Python snapshot is available. Unpinned dependencies are not checked; use uv.lock, poetry.lock, Pipfile.lock or pinned requirements.",
    ],
  };
  if (file.filename.endsWith("pyproject.toml")) {
    const doc = parseToml(file.content) as any;
    for (const req of doc.project?.dependencies || []) {
      const m = String(req).match(/^([A-Za-z0-9_.-]+)==([0-9][\w.!+-]*)$/);
      if (!m) continue;
      const n = node("pypi", m[1], m[2]);
      n.id = hash(p.id + ":" + n.purl);
      n.provenance = [file.provenance];
      n.scope = "runtime";
      graph.nodes.push(n);
      graph.edges.push({ from: root.id, to: n.id, projectId: p.id });
    }
  }
  return finalize(graph);
}
