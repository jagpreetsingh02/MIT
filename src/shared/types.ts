export type Ecosystem = 'npm' | 'pypi' | 'maven';
export interface Provenance { source: string; url: string; retrievedAt: string; fixture?: boolean }
export interface Advisory { id: string; aliases: string[]; summary: string; cvss?: number; exploited?: boolean; fixed?: string; provenance: Provenance[] }
export interface PackageNode { id: string; name: string; version: string; ecosystem: Ecosystem; purl: string; kind: 'package' | 'service'; scope: 'runtime' | 'development'; license?: string; depth: number | null; advisories: Advisory[]; provenance: Provenance[]; coverage: 'unchecked' | 'checked' | 'partial' | 'fixture' }
export interface Edge { from: string; to: string }
export interface Graph { nodes: PackageNode[]; edges: Edge[]; warnings: string[] }
export interface Risk { nodeId: string; score: number; level: 'critical' | 'high' | 'medium' | 'low'; factors: {severity: number; exploit: number; exposure: number; blastRadius: number}; ancestors: number; services: string[]; advisories: number; coverage: PackageNode['coverage'] }
export interface Simulation { nodeId: string; affected: string[]; services: string[]; edges: Edge[]; impact: number; paths: string[][] }
export interface ConnectorHealth { name: string; status: 'ready' | 'ok' | 'degraded' | 'disabled' | 'fixture'; message: string; checkedAt?: string }
export interface Scan { id: string; status: 'queued' | 'scanning' | 'enriching' | 'completed' | 'failed'; name: string; ref: string; commit?: string; mode: 'demo' | 'github' | 'manifest'; createdAt: string; completedAt?: string; error?: string; graph?: Graph; risks?: Risk[]; connectors: ConnectorHealth[] }
export interface ScanInput { mode: 'demo' | 'github' | 'manifest'; repository?: string; ref?: string; filename?: string; content?: string; installationId?: number }
