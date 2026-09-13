import { PackageURL } from 'packageurl-js';
import { createHash } from 'node:crypto';
import type { Ecosystem, Graph, PackageNode, Risk, Simulation } from '../shared/types.js';
export function purl(ecosystem: Ecosystem, name: string, version: string) {
  if (ecosystem === 'pypi') name = name.toLowerCase().replace(/[-_.]+/g, '-');
  const split = ecosystem === 'maven' ? name.lastIndexOf(':') : name.startsWith('@') ? name.indexOf('/') : -1;
  return new PackageURL(ecosystem, split < 0 ? undefined : name.slice(0, split), split < 0 ? name : name.slice(split + 1), version, undefined, undefined).toString();
}
export function node(ecosystem: Ecosystem, name: string, version: string, kind: PackageNode['kind'] = 'package'): PackageNode {
  const identity = purl(ecosystem, name, version);
  return { id: createHash('sha256').update(identity).digest('hex').slice(0, 20), purl: identity, ecosystem, name, version, kind, scope: 'runtime', depth: null, advisories: [], provenance: [], coverage: 'unchecked' };
}
export function finalize(graph: Graph): Graph {
  if (graph.nodes.length > 2000 || graph.edges.length > 12000) throw new Error('Graph exceeds V1 limit (2,000 nodes / 12,000 edges).');
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  graph.nodes = [...nodes.values()];
  graph.edges = [...new Map(graph.edges.filter(e => nodes.has(e.from) && nodes.has(e.to) && e.from !== e.to).map(e => [e.from + ':' + e.to, e])).values()];
  const children = new Map<string, string[]>();
  for (const e of graph.edges) children.set(e.from, [...(children.get(e.from) || []), e.to]);
  graph.nodes.forEach(n => { n.depth = null; });
  const queue = graph.nodes.filter(n => n.kind === 'service'); queue.forEach(n => { n.depth = 0; });
  for (let i = 0; i < queue.length; i++) for (const id of children.get(queue[i].id) || []) {
    const child = nodes.get(id)!;
    if (child.depth === null) { child.depth = queue[i].depth! + 1; queue.push(child); }
  }
  return graph;
}
export function simulate(graph: Graph, nodeId: string): Simulation {
  if (!graph.nodes.some(n => n.id === nodeId)) throw new Error('Package not found in this scan.');
  const parents = new Map<string, string[]>();
  graph.edges.forEach(e => parents.set(e.to, [...(parents.get(e.to) || []), e.from]));
  const seen = new Set([nodeId]); const queue = [nodeId]; const paths = new Map([[nodeId, [nodeId]]]);
  for (let i = 0; i < queue.length; i++) for (const id of parents.get(queue[i]) || []) {
    if (!seen.has(id)) { seen.add(id); queue.push(id); paths.set(id, [id, ...paths.get(queue[i])!]); }
  }
  const services = graph.nodes.filter(n => n.kind === 'service' && n.id !== nodeId && seen.has(n.id)).map(n => n.id);
  const affected = queue.slice(1).sort();
  return {nodeId, affected, services, edges: graph.edges.filter(e => seen.has(e.from) && seen.has(e.to)), impact: Math.round(100 * affected.length / Math.max(1, graph.nodes.length - 1)), paths: services.map(id => paths.get(id)!)};
}
export function risks(graph: Graph): Risk[] {
  return graph.nodes.filter(n => n.kind === 'package').map(n => {
    const ripple = simulate(graph, n.id);
    const severity = Math.max(0, ...n.advisories.map(a => a.cvss || 0)) * 6;
    const exploit = n.advisories.some(a => a.exploited === true) ? 15 : 0;
    const exposure = n.depth === null ? 0 : Math.round(10 / Math.max(1, n.depth) * (n.scope === 'development' ? 0.5 : 1));
    const blastRadius = Math.round(15 * ripple.affected.length / Math.max(1, graph.nodes.length - 1));
    const score = Math.min(100, Math.round(severity + exploit + exposure + blastRadius));
    return {nodeId:n.id, score, level: score >= 80 ? 'critical' as const : score >= 60 ? 'high' as const : score >= 35 ? 'medium' as const : 'low' as const, factors:{severity:Math.round(severity * 10) / 10, exploit, exposure, blastRadius}, ancestors:ripple.affected.length, services:ripple.services, advisories:n.advisories.length, coverage:n.coverage};
  }).sort((a,b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
}
