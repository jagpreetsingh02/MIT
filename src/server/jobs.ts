import { randomUUID } from 'node:crypto';
import { metrics, trace } from '@opentelemetry/api';
import { Store } from './store.js';
import { Transport } from './transport.js';
import { GitHub, canonicalRepository, enrichGraph } from './connectors.js';
import { parseManifest } from './parsers.js';
import { demoGraph } from './demo.js';
import { finalize, risks } from './graph.js';
import type { Scan, ScanInput, ConnectorHealth } from '../shared/types.js';
const meter=metrics.getMeter('rippleguard');const duration=meter.createHistogram('scan_duration',{unit:'ms'});const errors=meter.createCounter('scan_failures');
export const connectors=():ConnectorHealth[]=>[
  ...['GitHub','npm','PyPI','Maven Central','OSV','NVD','CVE Program'].map(name=>({name,status:'ready' as const,message:'Not queried in this scan'})),
  {name:'OSS Index',status:process.env.OSS_INDEX_EMAIL && process.env.OSS_INDEX_TOKEN?'ready':'disabled',message:'Optional; requires server credentials'}
];
export class Jobs {
  private running=false;private stopped=false;private current?:Promise<void>;
  constructor(readonly store:Store) {}
  create(input:ScanInput):Scan {
    if(this.store.pending().length>=20)throw new Error('Scan queue is full. Try again after pending scans finish.');
    const scan:Scan={id:randomUUID(),status:'queued',name:input.mode==='demo'?'acme / commerce-platform':input.mode==='github'?canonicalRepository(input.repository!):input.filename!,ref:input.ref||'HEAD',mode:input.mode,createdAt:new Date().toISOString(),connectors:connectors()};
    this.store.save(scan,input);this.kick();return scan;
  }
  kick(){if(!this.running&&!this.stopped){this.current=this.drain();}}
  async close(){this.stopped=true;await this.current;}
  async drain(){
    this.running=true;
    try{while(!this.stopped){const scan=this.store.pending().at(-1);if(!scan)break;await this.run(scan);}}
    finally{this.running=false;}
  }
  private async run(scan:Scan){
    const started=Date.now();const span=trace.getTracer('rippleguard').startSpan('scan');const http=new Transport(this.store);
    const persist=()=>{scan.connectors=connectors().map(c=>http.health.get(c.name)||c);this.store.save(scan);};
    try {
      const input=this.store.input(scan.id);scan.status='scanning';persist();
      if(input.mode==='demo') {
        scan.graph=demoGraph();scan.connectors=connectors().map(c=>({...c,status:'fixture',message:'Demo is offline; connector not queried'}));
      } else if(input.mode==='manifest') scan.graph=parseManifest(input.filename!,input.content!);
      else {
        const result=await new GitHub(http).manifests(input.repository!,input.ref||'HEAD',input.installationId);scan.commit=result.commit;
        const graphs=result.files.map(f=>parseManifest(f.filename,f.content,f.provenance));
        scan.graph=finalize({nodes:graphs.flatMap(g=>g.nodes),edges:graphs.flatMap(g=>g.edges),warnings:graphs.flatMap(g=>g.warnings)});
      }
      if(input.mode!=='demo'){scan.status='enriching';persist();await enrichGraph(scan.graph,http,persist);persist();}
      scan.risks=risks(scan.graph);scan.status='completed';scan.completedAt=new Date().toISOString();
      meter.createHistogram('graph_nodes').record(scan.graph.nodes.length);meter.createHistogram('graph_edges').record(scan.graph.edges.length);
    } catch(error){scan.status='failed';scan.error=error instanceof Error?error.message:'Scan failed.';errors.add(1);}
    finally{this.store.save(scan);duration.record(Date.now()-started,{mode:scan.mode,status:scan.status});span.end();}
  }
}
