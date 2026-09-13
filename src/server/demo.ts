import { node, finalize } from './graph.js';
import type { Graph } from '../shared/types.js';
export function demoGraph(): Graph {
  const origin={source:'RippleGuard demo fixture',url:'',retrievedAt:'2026-09-10T00:00:00.000Z',fixture:true};
  const definitions = [
    ['npm','storefront','1.0.0','service'],['npm','checkout-api','1.0.0','service'],['pypi','recommendations','1.0.0','service'],['maven','demo:fulfillment','1.0.0','service'],
    ['npm','express','4.17.1'],['npm','axios','0.21.1'],['npm','lodash','4.17.20'],['npm','body-parser','1.19.0'],['npm','qs','6.7.0'],['npm','follow-redirects','1.14.0'],['npm','debug','2.6.9'],['npm','ms','2.0.0'],['npm','cookie','0.4.0'],['npm','react','18.2.0'],['npm','zod','3.22.4'],['pypi','requests','2.28.0'],['pypi','urllib3','1.26.5'],['pypi','certifi','2022.12.7'],['maven','org.apache.logging.log4j:log4j-core','2.14.1'],['maven','org.apache.logging.log4j:log4j-api','2.14.1'],['npm','mime-types','2.1.35'],['npm','mime-db','1.52.0'],['pypi','charset-normalizer','2.0.12'],['pypi','idna','3.3']
  ];
  const nodes=definitions.map(([eco,name,version,kind])=>{const n=node(eco as 'npm'|'pypi'|'maven',name,version,(kind||'package') as 'service'|'package');n.coverage='fixture';n.provenance=[origin];return n;});
  const pairs=[[0,4],[0,5],[0,6],[0,13],[0,14],[1,4],[1,5],[1,6],[1,18],[2,15],[2,6],[3,18],[3,19],[4,7],[4,8],[4,10],[4,12],[4,20],[5,9],[7,8],[7,10],[7,20],[10,11],[15,16],[15,17],[15,22],[15,23],[18,19],[20,21]];
  const fixtures:[[number,number,string,string],...[number,number,string,string][]]=[[6,7.4,'DEMO-001','Prototype pollution in a shared utility'],[5,7.5,'DEMO-002','Server-side request forgery'],[8,7.5,'DEMO-003','Unbounded parsing can exhaust resources'],[16,6.5,'DEMO-004','Sensitive headers exposed across redirects'],[18,10,'DEMO-005','Remote code execution in a logging component']];
  fixtures.forEach(([i,cvss,id,summary])=>nodes[i].advisories=[{id,aliases:[],summary,cvss,exploited:i===18,fixed:undefined,provenance:[origin]}]);
  return finalize({nodes,edges:pairs.map(([a,b])=>({from:nodes[a].id,to:nodes[b].id})),warnings:['Illustrative multi-service graph. DEMO advisories and scores are synthetic fixtures, not a current security assessment.']});
}
