export type Ecosystem = "npm" | "pypi" | "maven";
export interface Provenance {
  source: string;
  url: string;
  retrievedAt: string;
  fixture?: boolean;
}
export interface Advisory {
  id: string;
  aliases: string[];
  summary: string;
  cvss?: number;
  exploited?: boolean;
  fixed?: string;
  severity?: "critical" | "high" | "medium" | "low";
  cvssVector?: string;
  affected?: string[];
  provenance: Provenance[];
}
export interface PackageNode {
  id: string;
  name: string;
  version: string;
  ecosystem: Ecosystem;
  purl: string;
  kind: "package" | "service";
  scope: "runtime" | "development" | "unknown";
  projectId?: string;
  path?: string;
  relationship?: "known" | "listed";
  license?: string;
  depth: number | null;
  advisories: Advisory[];
  provenance: Provenance[];
  coverage: "unchecked" | "checked" | "partial" | "fixture";
}
export interface Edge {
  from: string;
  to: string;
  projectId?: string;
  scope?: "runtime" | "development" | "unknown";
  relationship?: "known" | "listed";
}
export interface Graph {
  nodes: PackageNode[];
  edges: Edge[];
  warnings: string[];
}
export interface Risk {
  nodeId: string;
  score: number;
  level: "critical" | "high" | "medium" | "low";
  factors: { severity: number; exploit: number; exposure: number; blastRadius: number };
  ancestors: number;
  services: string[];
  advisories: number;
  coverage: PackageNode["coverage"];
  reasons?: string[];
  pathCount?: number;
  pathsTruncated?: boolean;
}
export interface Simulation {
  nodeId: string;
  affected: string[];
  services: string[];
  edges: Edge[];
  impact: number;
  paths: string[][];
  pathCount?: number;
  pathsTruncated?: boolean;
  totalServices?: number;
  serviceImpact?: number;
  distances?: Record<string, number>;
  hypothetical?: boolean;
  seedIds?: string[];
  relationshipUncertain?: boolean;
}
export interface ConnectorHealth {
  name: string;
  status: "ready" | "ok" | "degraded" | "disabled" | "fixture";
  message: string;
  checkedAt?: string;
}
export interface Scan {
  id: string;
  status: "queued" | "discovering" | "mapped" | "scanning" | "enriching" | "completed" | "failed";
  name: string;
  ref: string;
  commit?: string;
  mode: "demo" | "github" | "manifest";
  createdAt: string;
  completedAt?: string;
  error?: string;
  graph?: Graph;
  risks?: Risk[];
  connectors: ConnectorHealth[];
  repositoryMap?: RepositoryMap;
  progress?: ScanProgress;
  analysisRequested?: boolean;
}
export interface ScanInput {
  mode: "demo" | "github" | "manifest";
  repository?: string;
  ref?: string;
  filename?: string;
  content?: string;
  installationId?: number;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  ecosystem: Ecosystem;
  manifest?: string;
  lockfile?: string;
  files: string[];
  selected: boolean;
  role: "application" | "workspace" | "tooling" | "project";
  resolution: "resolved" | "partial" | "unsupported" | "failed";
  notes: string[];
  packageCount?: number;
  analyzed?: boolean;
}
export interface RepositoryMap {
  repository: string;
  ref: string;
  commit: string;
  projects: Project[];
  warnings: string[];
  fileCount: number;
}
export interface ProjectSelection {
  id: string;
  name: string;
}
export interface ScanProgress {
  stage:
    | "discover"
    | "map"
    | "extract"
    | "resolve"
    | "vulnerabilities"
    | "risk"
    | "ripple"
    | "done";
  message: string;
  current?: number;
  total?: number;
  completed: string[];
}
