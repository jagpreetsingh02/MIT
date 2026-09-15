import { readFile, writeFile, mkdir } from "node:fs/promises";
import { discoverProjects, type SourceFile } from "../src/server/discovery.js";
import { resolveProject } from "../src/server/resolve-project.js";
import { finalize, risks, simulate } from "../src/server/graph.js";
import { enrichGraph } from "../src/server/connectors.js";
import { Transport } from "../src/server/transport.js";
import { Store } from "../src/server/store.js";
const names = [
  "package.json",
  "package-lock.json",
  "apps/storefront/package.json",
  "apps/checkout/package.json",
  "apps/admin/package.json",
  "packages/shared-http/package.json",
];
const files: SourceFile[] = await Promise.all(
  names.map(async (filename) => ({
    filename,
    content: await readFile("demo-repository/" + filename, "utf8"),
    provenance: {
      source: "Controlled demo lockfile",
      url: "",
      retrievedAt: new Date().toISOString(),
    },
  })),
);
const map = discoverProjects(
  names.map((path) => ({ path, sha: "" })),
  "demo/rootline-recording",
  "main",
  "local-prepared",
);
const selected = map.projects.filter((p) => p.path.startsWith("apps/"));
const graphs = selected.map((p) => resolveProject(p, files));
const graph = finalize({
  nodes: graphs.flatMap((g) => g.nodes),
  edges: graphs.flatMap((g) => g.edges),
  warnings: graphs.flatMap((g) => g.warnings),
});
const store = new Store("data/controlled-demo-verification.sqlite");
try {
  await enrichGraph(graph, new Transport(store), () => {});
  const ranked = risks(graph);
  const top = ranked[0];
  const ripple = simulate(graph, top.nodeId);
  const report = {
    verifiedAt: new Date().toISOString(),
    projects: selected.map((p) => p.path),
    packageVersions: ranked.length,
    checked: graph.nodes.filter((n) => n.coverage === "checked").length,
    findings: ranked.filter((r) => r.advisories > 0).length,
    top: { name: graph.nodes.find((n) => n.id === top.nodeId)?.name, ...top },
    ripple: { projects: ripple.services.length, paths: ripple.pathCount },
    warnings: graph.warnings,
    advisories: graph.nodes
      .filter((n) => n.advisories.length)
      .map((n) => ({ name: n.name, version: n.version, advisories: n.advisories })),
  };
  await mkdir("docs/verification", { recursive: true });
  await writeFile("docs/verification/controlled-demo.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, advisories: report.advisories.length }));
  if (!report.findings || ripple.services.length !== 3) process.exitCode = 1;
} finally {
  store.close();
}
