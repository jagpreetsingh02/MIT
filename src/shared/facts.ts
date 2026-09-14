import type { Advisory, PackageNode, Project, Risk, Scan } from "./types.js";

export type Severity = "critical" | "high" | "medium" | "low" | "unscored";
export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "unscored"];

export function severityOf(a: Advisory): Severity {
  if (a.cvss !== undefined)
    return a.cvss >= 9 ? "critical" : a.cvss >= 7 ? "high" : a.cvss >= 4 ? "medium" : "low";
  return a.severity ?? "unscored";
}

export function entryLabel(n: PackageNode) {
  if (n.depth === null) return "Relationship unknown";
  if (n.depth <= 1) return "Direct dependency";
  return `Hidden ${n.depth} levels deep`;
}

export function versionLabel(n: PackageNode) {
  return n.versionStatus === "unresolved"
    ? (n.declaredSpecifier || "No version declared") + " · exact version unresolved"
    : n.version;
}

export function ecosystemLabel(e: PackageNode["ecosystem"]) {
  return e === "pypi" ? "Python" : e === "maven" ? "Maven" : "npm";
}

export interface Finding {
  advisory: Advisory;
  severity: Severity;
  packages: PackageNode[];
  services: string[];
  topRisk?: Risk;
}

export interface FindingRow {
  key: string;
  advisory: Advisory;
  severity: Severity;
  pkg: PackageNode;
  risk?: Risk;
}

export function findingKey(advisoryId: string, nodeId: string) {
  return `${advisoryId}::${nodeId}`;
}

export interface Application {
  node: PackageNode;
  project?: Project;
  dependencies: PackageNode[];
  direct: number;
  vulnerable: PackageNode[];
  findings: number;
}

export interface Facts {
  services: PackageNode[];
  packages: PackageNode[];
  checked: number;
  unresolved: number;
  exact: number;
  unchecked: number;
  findings: Finding[];
  findingRows: FindingRow[];
  vulnerablePackages: PackageNode[];
  applications: Application[];
  riskFor: (n: PackageNode) => Risk | undefined;
  nodeById: Map<string, PackageNode>;
}

export function deriveFacts(scan: Scan): Facts {
  const graph = scan.graph ?? { nodes: [], edges: [], warnings: [] };
  const risks = scan.risks ?? [];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const services = graph.nodes.filter((n) => n.kind === "service");
  const packages = [
    ...new Map(
      graph.nodes
        .filter((n) => n.kind === "package")
        .map((n) => [n.versionStatus === "unresolved" ? n.id : n.purl, n]),
    ).values(),
  ];
  const riskByPurl = new Map<string, Risk>();
  for (const r of risks) {
    const n = nodeById.get(r.nodeId);
    if (n && !riskByPurl.has(n.purl)) riskByPurl.set(n.purl, r);
  }
  const riskFor = (n: PackageNode) => riskByPurl.get(n.purl);

  const checked = packages.filter((n) => ["checked", "fixture"].includes(n.coverage)).length;
  const unresolved = packages.filter((n) => n.versionStatus === "unresolved").length;
  const exact = packages.length - unresolved;
  const vulnerablePackages = packages.filter((n) => n.advisories.length > 0);

  const byId = new Map<string, Finding>();
  for (const pkg of vulnerablePackages) {
    const risk = riskFor(pkg);
    for (const advisory of pkg.advisories) {
      const finding = byId.get(advisory.id) ?? {
        advisory,
        severity: severityOf(advisory),
        packages: [],
        services: [],
      };
      finding.packages.push(pkg);
      for (const s of risk?.services ?? [])
        if (!finding.services.includes(s)) finding.services.push(s);
      if (risk && (!finding.topRisk || risk.score > finding.topRisk.score)) finding.topRisk = risk;
      byId.set(advisory.id, finding);
    }
  }
  const findings = [...byId.values()].sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      (b.topRisk?.score ?? 0) - (a.topRisk?.score ?? 0),
  );

  const findingRows = findings.flatMap((f) =>
    f.packages.map((pkg) => ({
      key: findingKey(f.advisory.id, pkg.id),
      advisory: f.advisory,
      severity: f.severity,
      pkg,
      risk: riskFor(pkg),
    })),
  );

  const children = new Map<string, string[]>();
  for (const e of graph.edges) children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
  const applications = services.map((node) => {
    const seen = new Set<string>();
    const queue = [...(children.get(node.id) ?? [])];
    const direct = new Set(queue);
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...(children.get(id) ?? []));
    }
    const dependencies = [
      ...new Map(
        [...seen]
          .map((id) => nodeById.get(id))
          .filter((n): n is PackageNode => n?.kind === "package")
          .map((n) => [n.versionStatus === "unresolved" ? n.id : n.purl, n]),
      ).values(),
    ];
    const vulnerable = dependencies.filter((n) => n.advisories.length > 0);
    return {
      node,
      project: scan.repositoryMap?.projects.find((p) => p.id === node.projectId),
      dependencies,
      direct: dependencies.filter((n) => direct.has(n.id)).length,
      vulnerable,
      findings: new Set(vulnerable.flatMap((n) => n.advisories.map((a) => a.id))).size,
    };
  });

  return {
    services,
    packages,
    checked,
    unresolved,
    exact,
    unchecked: packages.length - checked,
    findings,
    findingRows,
    vulnerablePackages,
    applications,
    riskFor,
    nodeById,
  };
}
