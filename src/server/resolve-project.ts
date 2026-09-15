import { createHash } from "node:crypto";
import { posix } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import semver from "semver";
import { node, finalize } from "./graph.js";
import { parseManifest } from "./parsers.js";
import { declarations } from "./declarations.js";
import type { Graph, PackageNode, Project } from "../shared/types.js";
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
  const declared = declarations(
    files.filter(
      (f) =>
        project.files.includes(f.filename) ||
        f.filename === project.manifest ||
        f.filename === project.lockfile,
    ),
  );
  let graph: Graph;
  try {
    graph = resolveExact(project, files);
  } catch (error) {
    graph = {
      nodes: [rootFor(project)],
      edges: [],
      warnings: [`Exact resolution failed: ${(error as Error).message}`],
    };
    if (project.ecosystem === "npm") {
      try {
        const fallback = npmManifest(
          project,
          files.find((f) => f.filename === project.manifest),
        );
        graph.nodes.push(...fallback.nodes.filter((n) => n.kind === "package"));
        graph.edges.push(...fallback.edges);
      } catch {}
    }
  }
  graph.warnings.push(...declared.warnings);
  const normalize = (name: string) =>
    project.ecosystem === "pypi" ? name.toLowerCase().replace(/[-_.]+/g, "-") : name;
  for (const d of declared.declarations) {
    if (
      graph.nodes.some(
        (n) =>
          n.kind === "package" &&
          normalize(n.name) === normalize(d.name) &&
          (n.versionStatus === "unresolved"
            ? !d.exactVersion && n.declaredSpecifier === d.specifier
            : !d.exactVersion || n.version === d.exactVersion),
      )
    )
      continue;
    const n = node(project.ecosystem, d.name, d.exactVersion || "");
    n.id = hash(project.id + ":" + normalize(d.name) + ":" + (d.exactVersion || d.specifier));
    n.projectId = project.id;
    n.versionStatus = d.exactVersion ? "exact" : "unresolved";
    n.declaredSpecifier = d.specifier;
    n.scope = d.scope;
    n.relationship = "listed";
    n.coverage = d.exactVersion ? "unchecked" : "partial";
    n.provenance = files.filter((f) => f.filename === d.file).map((f) => f.provenance);
    graph.nodes.push(n);
    graph.edges.push({
      from: "service-" + project.id,
      to: n.id,
      projectId: project.id,
      relationship: "listed",
      scope: d.scope,
    });
  }
  graph = finalize(graph);
  project.declarations = declared.declarations;
  const packages = graph.nodes.filter((n) => n.kind === "package");
  project.packageCount = packages.length;
  project.exactCount = packages.filter((n) => n.versionStatus !== "unresolved").length;
  project.unresolvedCount = packages.length - project.exactCount;
  if (!packages.length)
    graph.warnings.push(
      files.length
        ? "No package declarations or exact installed entries were extracted from the readable files. See format-specific notes; a workspace root may require selecting its child projects."
        : "No dependency files could be read for this project.",
    );
  if (project.unresolvedCount)
    graph.warnings.push(
      `${project.unresolvedCount} dependency declarations have no exact installed version. They are retained but excluded from vulnerability matching.`,
    );
  project.ingestionStatus = !packages.length
    ? "UNSUPPORTED"
    : !project.exactCount
      ? "DECLARED_ONLY"
      : graph.warnings.length || project.unresolvedCount
        ? "PARTIAL"
        : "EXACT";
  project.relationships = graph.edges.some((e) => e.relationship === "listed")
    ? "partial"
    : graph.edges.length
      ? "recorded"
      : "unavailable";
  project.resolution =
    project.ingestionStatus === "EXACT"
      ? "resolved"
      : project.ingestionStatus === "UNSUPPORTED"
        ? "unsupported"
        : "partial";
  return graph;
}
function resolveExact(project: Project, files: SourceFile[]): Graph {
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
  let data = JSON.parse(file.content);
  const legacyWithoutManifest = data.lockfileVersion === 1 && !manifest;
  let info: any = {};
  let manifestError = "";
  try {
    info = manifest ? JSON.parse(manifest.content) : {};
  } catch {
    manifestError = "Manifest JSON could not be parsed; installed lockfile entries were retained.";
  }
  if (data.lockfileVersion === 1 && data.dependencies) {
    const entries: Record<string, any> = {
      "": {
        name: data.name,
        version: data.version,
        dependencies: Object.fromEntries(
          Object.entries(data.dependencies).map(([name, d]: [string, any]) => [name, d.version]),
        ),
      },
    };
    const walk = (deps: Record<string, any>, parent = "") => {
      for (const [name, d] of Object.entries(deps)) {
        const path = (parent ? parent + "/" : "") + "node_modules/" + name;
        entries[path] = { ...d, dependencies: d.requires || {} };
        if (d.dependencies) walk(d.dependencies, path);
      }
    };
    walk(data.dependencies);
    data = { ...data, lockfileVersion: 2, packages: entries };
  }
  if (![2, 3].includes(data.lockfileVersion) || !data.packages)
    return {
      ...npmManifest(p, manifest),
      warnings: [
        "This npm lockfile version is unsupported; only exact manifest pins were imported.",
      ],
    };
  const entries = data.packages as Record<string, any>;
  if (!entries[""] && p.path === posix.dirname(file.filename))
    entries[""] = { name: data.name, version: data.version };
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
  const graph: Graph = { nodes: [root], edges: [], warnings: manifestError ? [manifestError] : [] };
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
      } else {
        const missing = node("npm", name, "");
        missing.id = hash(file.filename + ":" + path + ":" + name + ":" + String(requested));
        missing.versionStatus = "unresolved";
        missing.declaredSpecifier = String(requested);
        missing.coverage = "partial";
        missing.scope = "unknown";
        missing.projectId = p.id;
        missing.relationship = "listed";
        missing.provenance = [file.provenance];
        graph.nodes.push(missing);
        graph.edges.push({
          from: parent.id,
          to: missing.id,
          projectId: p.id,
          relationship: "listed",
          scope: "unknown",
        });
        graph.warnings.push(
          `Could not determine the installed dependency ${name} used by ${parent.name}.`,
        );
      }
    }
  }
  connect(root, entry, { ...entries[entry], ...info }, true);
  if (legacyWithoutManifest) {
    for (const edge of graph.edges.filter((e) => e.from === root.id)) edge.relationship = "listed";
    graph.warnings.push(
      "Legacy npm lockfile without package.json: installed entries are retained, but root direct dependencies are not known.",
    );
  }
  if (
    !graph.nodes.some((n) => n.kind === "package") &&
    entry === "" &&
    !entries[entry].workspaces &&
    !info.workspaces
  ) {
    for (const path of Object.keys(entries).filter((path) => path.startsWith("node_modules/"))) {
      const child = add(path);
      if (child)
        graph.edges.push({
          from: root.id,
          to: child.id,
          projectId: p.id,
          relationship: "listed",
          scope: "unknown",
        });
    }
    if (graph.nodes.length > 1)
      graph.warnings.push(
        "Lockfile packages were retained, but root dependency declarations were unavailable. Listed links do not establish direct ancestry.",
      );
  }
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
      "No supported resolved lockfile is available. Exact direct pins can be checked; other declarations remain unresolved and indirect relationships are unknown.",
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
