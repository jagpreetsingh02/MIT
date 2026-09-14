import type {Scan,PackageNode,Advisory} from "./types";
export const sections=["Overview","Risks","Applications","Dependencies","Vulnerabilities","Ripple Graph","Coverage","Evidence"] as const;
export type Section=typeof sections[number];
export interface Finding {key:string;node:PackageNode;advisory:Advisory;applications:string[];}
export function scanFacts(scan:Scan){
 const graph=scan.graph!;
 const roots=graph.nodes.filter(n=>n.kind==="service");
 const packages=[...new Map(graph.nodes.filter(n=>n.kind==="package").map(n=>[n.versionStatus==="unresolved"?n.id:n.purl,n])).values()];
 const descendants=new Map<string,Set<string>>();
 const children=new Map<string,string[]>();
 for(const e of graph.edges)children.set(e.from,[...(children.get(e.from)||[]),e.to]);
 for(const root of roots){const set=new Set<string>();const q=[root.id];for(let i=0;i<q.length;i++)for(const id of children.get(q[i])||[])if(!set.has(id)){set.add(id);q.push(id);}descendants.set(root.id,set);}
 const appsFor=(n:PackageNode)=>roots.filter(r=>graph.nodes.some(instance=>instance.kind==="package"&&(n.versionStatus==="unresolved"?instance.id===n.id:instance.purl===n.purl)&&descendants.get(r.id)!.has(instance.id))).map(r=>r.id);
 const findings:Finding[]=packages.flatMap(node=>node.advisories.map(advisory=>({key:node.id+":"+advisory.id,node,advisory,applications:appsFor(node)})));
 const applications=roots.map(root=>{const nodes=graph.nodes.filter(n=>n.kind==="package"&&descendants.get(root.id)!.has(n.id));return {root,nodes,findings:findings.filter(f=>f.applications.includes(root.id)),priorities:(scan.risks||[]).filter(r=>r.advisories>0&&r.score>=60&&r.services.includes(root.id))};});
 return {roots,packages,findings,applications,appsFor};
}
export function severity(a:Advisory){return a.cvss!==undefined ? a.cvss>=9?"critical":a.cvss>=7?"high":a.cvss>=4?"medium":"low" : a.severity || "unknown";}
export function versionLabel(n:PackageNode){return n.versionStatus==="unresolved"?(n.declaredSpecifier||"No version declared")+" · unresolved":n.version;}
