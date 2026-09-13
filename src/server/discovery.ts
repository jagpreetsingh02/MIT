import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { Ecosystem, Project, RepositoryMap } from "../shared/types.js";
export interface RepositoryFile {
  path: string;
  sha: string;
  size?: number;
  type?: string;
}
export interface SourceFile {
  filename: string;
  content: string;
  provenance: import("../shared/types.js").Provenance;
}
const ecosystemFiles: Record<Ecosystem, string[]> = {
  npm: ["package.json", "npm-shrinkwrap.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
  pypi: [
    "pyproject.toml",
    "Pipfile",
    "Pipfile.lock",
    "requirements.txt",
    "requirements-dev.txt",
    "uv.lock",
    "poetry.lock",
    "setup.py",
    "setup.cfg",
  ],
  maven: ["pom.xml", "dependency-tree.json"],
};
export const relevantFile = (path: string) =>
  Object.values(ecosystemFiles).flat().includes(posix.basename(path));
export const projectId = (ecosystem: Ecosystem, path: string) =>
  createHash("sha256")
    .update(ecosystem + ":" + path)
    .digest("hex")
    .slice(0, 16);
/** File discovery does not execute manifests. Related manifests/locks become one project. */
export function discoverProjects(
  files: RepositoryFile[],
  repository: string,
  ref: string,
  commit: string,
): RepositoryMap {
  const groups = new Map<string, { path: string; ecosystem: Ecosystem; files: string[] }>();
  for (const file of files) {
    if (file.type && file.type !== "blob") continue;
    if (/(^|\/)(node_modules|vendor|\.git|\.venv|venv|site-packages)\//.test(file.path)) continue;
    const base = posix.basename(file.path);
    const eco = (Object.keys(ecosystemFiles) as Ecosystem[]).find((e) =>
      ecosystemFiles[e].includes(base),
    );
    if (!eco) continue;
    const directory = posix.dirname(file.path);
    const key = eco + ":" + directory;
    const group = groups.get(key) || { path: directory, ecosystem: eco, files: [] };
    group.files.push(file.path);
    groups.set(key, group);
  }
  const projects: Project[] = [...groups.values()]
    .map((group): Project => {
      const find = (names: string[]) =>
        names.map((n) => group.files.find((f) => posix.basename(f) === n)).find(Boolean);
      const manifest = find(
        group.ecosystem === "npm"
          ? ["package.json"]
          : group.ecosystem === "pypi"
            ? ["pyproject.toml", "Pipfile", "requirements.txt", "setup.cfg", "setup.py"]
            : ["pom.xml"],
      );
      const lockfile = find(
        group.ecosystem === "npm"
          ? ["npm-shrinkwrap.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]
          : group.ecosystem === "pypi"
            ? ["uv.lock", "poetry.lock", "Pipfile.lock"]
            : ["dependency-tree.json"],
      );
      const resolved =
        !!lockfile && /package-lock.json|npm-shrinkwrap.json|dependency-tree.json/.test(lockfile);
      const tooling =
        /(^|\/)(test|tests|fixtures|examples|benchmarks|docs|scripts|tools)(\/|$)/.test(group.path);
      return {
        id: projectId(group.ecosystem, group.path),
        name:
          group.path === "."
            ? repository.split("/").pop() || "Application"
            : posix.basename(group.path),
        path: group.path,
        ecosystem: group.ecosystem,
        files: group.files.sort(),
        manifest,
        lockfile,
        role: tooling ? "tooling" : "project",
        selected: !tooling,
        resolution: resolved ? "resolved" : "partial",
        notes: resolved
          ? ["Lockfile found. Installed relationships will be validated during analysis."]
          : ["Exact indirect dependency relationships may not be available."],
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.ecosystem.localeCompare(b.ecosystem));
  // Shared lockfiles are candidates only; the importer validates workspace membership.
  for (const project of projects)
    if (project.ecosystem === "npm" && !project.lockfile) {
      const ancestor = projects
        .filter(
          (p) =>
            p.ecosystem === "npm" &&
            p.lockfile &&
            p.path !== project.path &&
            (p.path === "." || project.path.startsWith(p.path + "/")),
        )
        .sort((a, b) => b.path.length - a.path.length)[0];
      if (ancestor) {
        project.lockfile = ancestor.lockfile;
        project.notes = [
          "Uses a parent lockfile if this package is recorded as a workspace; otherwise exact manifest pins only.",
        ];
      }
    }
  if (projects.length === 1) projects[0].selected = true;
  return {
    repository,
    ref,
    commit,
    projects,
    warnings: [],
    fileCount: projects.reduce((sum, p) => sum + p.files.length, 0),
  };
}
