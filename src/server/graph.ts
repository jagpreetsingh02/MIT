import { PackageURL } from "packageurl-js";
import { createHash } from "node:crypto";
import type { Ecosystem, Graph, PackageNode, Risk, Simulation } from "../shared/types.js";
export function purl(ecosystem: Ecosystem, name: string, version: string) {
  if (ecosystem === "pypi") name = name.toLowerCase().replace(/[-_.]+/g, "-");
  const split =
    ecosystem === "maven" ? name.lastIndexOf(":") : name.startsWith("@") ? name.indexOf("/") : -1;
  return new PackageURL(
    ecosystem,
    split < 0 ? undefined : name.slice(0, split),
    split < 0 ? name : name.slice(split + 1),
    version,
    undefined,
    undefined,
  ).toString();
}
export function node(
  ecosystem: Ecosystem,
  name: string,
  version: string,
  kind: PackageNode["kind"] = "package",
): PackageNode {
  const identity = purl(ecosystem, name, version);
  return {
    id: createHash("sha256").update(identity).digest("hex").slice(0, 20),
    purl: identity,
    ecosystem,
    name,
    version,
    kind,
    scope: "runtime",
    depth: null,
    advisories: [],
    provenance: [],
    coverage: "unchecked",
  };
}
export function finalize(graph: Graph): Graph {
  const nodes = new Map<string, PackageNode>();
  for (const n of graph.nodes) {
    const prior = nodes.get(n.id);
    if (!prior) nodes.set(n.id, n);
    else {
      if (n.scope === "runtime") prior.scope = "runtime";
      prior.provenance = [
        ...new Map(
          [...prior.provenance, ...n.provenance].map((p) => [p.url + ":" + p.source, p]),
        ).values(),
      ];
    }
  }
  graph.nodes = [...nodes.values()];
  graph.edges = [
    ...new Map(
      graph.edges
        .filter((e) => nodes.has(e.from) && nodes.has(e.to) && e.from !== e.to)
        .map((e) => [
          e.from +
            ":" +
            e.to +
            ":" +
            (e.projectId || "") +
            ":" +
            (e.scope || "") +
            ":" +
            (e.relationship || ""),
          e,
        ]),
    ).values(),
  ];
  graph.warnings = [...new Set(graph.warnings)];
  const children = new Map<string, typeof graph.edges>();
  for (const e of graph.edges) children.set(e.from, [...(children.get(e.from) || []), e]);
  graph.nodes.forEach((n) => {
    n.depth = null;
  });
  const queue = graph.nodes.filter((n) => n.kind === "service");
  queue.forEach((n) => {
    n.depth = 0;
  });
  for (let i = 0; i < queue.length; i++)
    for (const e of children.get(queue[i].id) || []) {
      if (e.relationship === "listed") continue;
      const child = nodes.get(e.to)!;
      if (child.depth === null) {
        child.depth = queue[i].depth! + 1;
        queue.push(child);
      }
    }
  const runtime = new Set(graph.nodes.filter((n) => n.kind === "service").map((n) => n.id));
  const todo = [...runtime];
  for (let i = 0; i < todo.length; i++)
    for (const e of children.get(todo[i]) || []) {
      if (e.scope === "development" || e.scope === "unknown" || e.relationship === "listed")
        continue;
      if (!runtime.has(e.to)) {
        runtime.add(e.to);
        todo.push(e.to);
      }
    }
  graph.nodes.forEach((n) => {
    if (n.kind === "package" && n.scope !== "unknown")
      n.scope = runtime.has(n.id) ? "runtime" : "development";
  });
  return graph;
}
function indexGraph(graph: Graph) {
  const parents = new Map<string, typeof graph.edges>();
  const byPurl = new Map<string, string[]>();
  for (const e of new Map(graph.edges.map((e) => [e.from + ":" + e.to, e])).values())
    parents.set(e.to, [...(parents.get(e.to) || []), e]);
  graph.nodes
    .filter((n) => n.kind === "package")
    .forEach((n) => byPurl.set(n.purl, [...(byPurl.get(n.purl) || []), n.id]));
  return {
    parents,
    byPurl,
    nodes: new Map(graph.nodes.map((n) => [n.id, n])),
    roots: graph.nodes.filter((n) => n.kind === "service"),
  };
}
function trace(
  graph: Graph,
  nodeId: string,
  index: ReturnType<typeof indexGraph>,
  includePaths = true,
): Simulation {
  const selected = index.nodes.get(nodeId);
  if (!selected) throw new Error("Package not found in this scan.");
  const seeds = selected.kind === "service" ? [nodeId] : index.byPurl.get(selected.purl)!;
  const seedSet = new Set(seeds);
  const seen = new Set(seeds);
  const queue = [...seeds];
  const distances: Record<string, number> = Object.fromEntries(seeds.map((id) => [id, 0]));
  const shortest = new Map(seeds.map((id) => [id, [id]]));
  for (let i = 0; i < queue.length; i++)
    for (const e of index.parents.get(queue[i]) || []) {
      if (!seen.has(e.from)) {
        seen.add(e.from);
        queue.push(e.from);
        shortest.set(e.from, [e.from, ...shortest.get(queue[i])!]);
        distances[e.from] = distances[queue[i]] + 1;
      }
    }
  const services = index.roots
    .filter((n) => seen.has(n.id) && !seedSet.has(n.id))
    .map((n) => n.id)
    .sort();
  const affected = [...seen].filter((id) => !seedSet.has(id)).sort();
  // All simple paths within a bounded search, not merely one path per service.
  const paths: string[][] = [];
  const signatures = new Set<string>();
  let truncated = false;
  let steps = 0;
  if (includePaths) {
    const stack = seeds.map((id) => [id]);
    while (stack.length) {
      const path = stack.pop()!;
      if (++steps > 20000 || paths.length >= 200) {
        truncated = true;
        break;
      }
      const first = path[0];
      if (index.nodes.get(first)?.kind === "service" && !seedSet.has(first)) {
        const key = path.join("/");
        if (!signatures.has(key)) {
          signatures.add(key);
          paths.push(path);
        }
        continue;
      }
      for (const e of index.parents.get(first) || [])
        if (!path.includes(e.from)) stack.push([e.from, ...path]);
    }
    // Guarantee at least one displayed shortest path for every affected service.
    for (const id of services) if (!paths.some((p) => p[0] === id)) paths.push(shortest.get(id)!);
  }
  const edges = graph.edges.filter((e) => seen.has(e.from) && seen.has(e.to));
  return {
    nodeId,
    seedIds: seeds,
    affected,
    services,
    edges,
    impact: Math.round((100 * affected.length) / Math.max(1, graph.nodes.length - seeds.length)),
    paths,
    pathCount: paths.length,
    pathsTruncated: truncated,
    totalServices: index.roots.length,
    serviceImpact: Math.round((100 * services.length) / Math.max(1, index.roots.length)),
    distances,
    hypothetical: !selected.advisories.length,
    relationshipUncertain: edges.some((e) => e.relationship === "listed"),
  };
}
export function simulate(graph: Graph, nodeId: string): Simulation {
  return trace(graph, nodeId, indexGraph(graph));
}
export function risks(graph: Graph): Risk[] {
  const index = indexGraph(graph);
  const unique = [
    ...new Map(graph.nodes.filter((n) => n.kind === "package").map((n) => [n.purl, n])).values(),
  ];
  return unique
    .map((n) => {
      const ripple = trace(graph, n.id, index, false);
      const instances = index.byPurl.get(n.purl)!.map((id) => index.nodes.get(id)!);
      const advisories = instances.flatMap((n) => n.advisories);
      const severity = Math.max(0, ...advisories.map((a) => a.cvss || 0)) * 6;
      const exploit = advisories.some((a) => a.exploited === true) ? 15 : 0;
      const knownDepths = instances.map((n) => n.depth).filter((d): d is number => d !== null);
      const depth = knownDepths.length ? Math.min(...knownDepths) : null;
      const runtime = instances.some((n) => n.scope === "runtime");
      const devOnly = instances.every((n) => n.scope === "development");
      const exposure =
        depth === null ? 0 : Math.round((10 / Math.max(1, depth)) * (devOnly ? 0.5 : 1));
      const blastRadius = Math.round(
        (12 * ripple.services.length) / Math.max(1, index.roots.length) +
          (3 * ripple.affected.length) / Math.max(1, graph.nodes.length - instances.length),
      );
      const score = Math.min(100, Math.round(severity + exploit + exposure + blastRadius));
      const cvss = Math.max(0, ...advisories.map((a) => a.cvss || 0));
      const reasons = [
        advisories.length
          ? cvss >= 9
            ? "Critical vulnerability"
            : cvss >= 7
              ? "High severity vulnerability"
              : cvss
                ? "Known vulnerability"
                : "Known advisory; severity not scored"
          : "No known advisory in checked sources",
        ...(exploit ? ["Known exploitation reported by a source"] : []),
        depth === null
          ? "Exact dependency depth is unknown"
          : depth === 1
            ? "Direct dependency"
            : `Hidden ${depth} levels deep`,
        runtime
          ? "Used at runtime"
          : devOnly
            ? "Development tooling only"
            : "Runtime/development use not fully determined",
        `Used by ${ripple.services.length} of ${index.roots.length} projects`,
      ];
      return {
        nodeId: n.id,
        score,
        level:
          score >= 80
            ? ("critical" as const)
            : score >= 60
              ? ("high" as const)
              : score >= 35
                ? ("medium" as const)
                : ("low" as const),
        factors: { severity: Math.round(severity * 10) / 10, exploit, exposure, blastRadius },
        ancestors: ripple.affected.length,
        services: ripple.services,
        advisories: new Set(advisories.map((a) => a.id)).size,
        coverage: n.coverage,
        reasons,
      };
    })
    .sort(
      (a, b) =>
        Number(b.advisories > 0) - Number(a.advisories > 0) ||
        b.score - a.score ||
        a.nodeId.localeCompare(b.nodeId),
    );
}
