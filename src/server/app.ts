import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { metrics } from '@opentelemetry/api';
import { Store } from './store.js';
import { Jobs, connectors } from './jobs.js';
import { canonicalRepository } from './connectors.js';
import { simulate } from './graph.js';
import { sbom } from './sbom.js';
const inputSchema=z.discriminatedUnion('mode',[
  z.object({mode:z.literal('demo')}),
  z.object({mode:z.literal('github'),repository:z.string().max(250),ref:z.string().min(1).max(200).regex(/^[A-Za-z0-9_./-]+$/).default('HEAD'),installationId:z.number().int().positive().optional()}),
  z.object({mode:z.literal('manifest'),filename:z.string().max(250),content:z.string().min(1).max(2_000_000)})
]);
export function verifySignature(body:Buffer,signature:string,secret:string) {
  if(!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
  const expected=createHmac('sha256',secret).update(body).digest();const actual=Buffer.from(signature.slice(7),'hex');
  return actual.length===expected.length && timingSafeEqual(expected,actual);
}
export async function createApp(store=new Store(),startJobs=true) {
  if(process.env.NODE_ENV==='production' && (!process.env.API_TOKEN || process.env.API_TOKEN.length<32))throw new Error('Production requires API_TOKEN of at least 32 characters.');
  const app=Fastify({logger:process.env.NODE_ENV!=='test'?{redact:['req.headers.authorization','req.headers.cookie'],level:process.env.LOG_LEVEL||'info'}:false,bodyLimit:2_100_000,requestTimeout:15_000});
  const jobs=new Jobs(store);if(startJobs)jobs.kick();
  await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],fontSrc:["'self'"],imgSrc:["'self'",'data:'],connectSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:process.env.NODE_ENV==='production'?[]:null}}});
  await app.register(rateLimit,{max:120,timeWindow:'1 minute'});
  app.addHook('onRequest',async(req,reply)=>{
    if(!req.url.startsWith('/api/v1/') || req.url.startsWith('/api/v1/health') || req.url==='/api/v1/webhooks/github')return;
    const origin=req.headers.origin;
    if(origin && origin!==`${req.protocol}://${req.host}` && origin!==process.env.PUBLIC_ORIGIN)return reply.code(403).send({error:'Cross-origin requests are not allowed.'});
    const secret=process.env.API_TOKEN;
    if(secret){const supplied=Buffer.from(req.headers.authorization?.replace(/^Bearer /,'')||'');const expected=Buffer.from(secret);if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))return reply.code(401).send({error:'Enter the server access token to continue.'});}
  });
  app.setErrorHandler((error,req,reply)=>{
    const err=error as Error & {statusCode?:number};
    const validation=error instanceof z.ZodError;
    const status=validation?400:err.statusCode||500;
    if(status>=500)req.log.error({err},'Request failed');
    reply.code(status).send({error:validation?'Invalid request. Check the repository, ref or manifest fields.':status>=500?'Request failed. Check server logs and try again.':err.message});
  });
  app.get('/api/v1/health',async()=>({status:'ok',database:store.db.prepare('SELECT 1 AS ok').get()?.ok===1?'ready':'failed',connectors:connectors(),authRequired:Boolean(process.env.API_TOKEN)}));
  app.get('/api/v1/scans',async()=>store.list().map(({graph,risks,...scan})=>({...scan,packages:graph?.nodes.filter(n=>n.kind==='package').length||0})));
  app.post('/api/v1/scans',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req,reply)=>{
    const input=inputSchema.parse(req.body);
    try {if(input.mode==='github')canonicalRepository(input.repository);return reply.code(202).send(jobs.create(input));}
    catch(error){return reply.code(400).send({error:(error as Error).message});}
  });
  function getScan(id:string,ready=false){const scan=store.get(id);if(!scan)throw Object.assign(new Error('Scan not found.'),{statusCode:404});if(ready&&scan.status!=='completed')throw Object.assign(new Error('Scan is not complete.'),{statusCode:409});return scan;}
  app.get<{Params:{scanId:string}}>('/api/v1/scans/:scanId',async req=>getScan(req.params.scanId));
  app.get<{Params:{scanId:string}}>('/api/v1/scans/:scanId/graph',async req=>getScan(req.params.scanId,true).graph);
  app.get<{Params:{scanId:string}}>('/api/v1/scans/:scanId/risks',async req=>getScan(req.params.scanId,true).risks);
  app.post<{Params:{scanId:string}}>('/api/v1/scans/:scanId/simulate',async(req,reply)=>{const {nodeId}=z.object({nodeId:z.string().max(100)}).parse(req.body);try{return simulate(getScan(req.params.scanId,true).graph!,nodeId);}catch(error){return reply.code((error as any).statusCode||404).send({error:(error as Error).message});}});
  app.get<{Params:{scanId:string}}>('/api/v1/scans/:scanId/sbom',async(req,reply)=>reply.header('Content-Disposition',`attachment; filename="rippleguard-${req.params.scanId.replace(/[^a-zA-Z0-9-]/g,'')}.spdx.json"`).send(sbom(getScan(req.params.scanId,true))));
  await app.register(async webhook=>{
    webhook.removeAllContentTypeParsers();webhook.addContentTypeParser('application/json',{parseAs:'buffer'},(_req,body,done)=>done(null,body));
    webhook.post('/api/v1/webhooks/github',async(req,reply)=>{
      const secret=process.env.GITHUB_WEBHOOK_SECRET;if(!secret)return reply.code(503).send({error:'Webhook is not configured.'});
      const raw=req.body as Buffer;
      if(!verifySignature(raw,String(req.headers['x-hub-signature-256']||''),secret)){metrics.getMeter('rippleguard').createCounter('webhook_validation_failures').add(1);return reply.code(401).send({error:'Invalid webhook signature.'});}
      const id=z.string().min(1).max(100).parse(req.headers['x-github-delivery']);
      const event=req.headers['x-github-event'];if(event==='ping')return {received:true};if(event!=='push')return reply.code(202).send({ignored:true});
      let body:any;try{body=JSON.parse(raw.toString('utf8'));}catch{return reply.code(400).send({error:'Invalid JSON.'});}
      const repo=canonicalRepository(z.string().parse(body.repository?.full_name));
      if(!(process.env.GITHUB_ALLOWED_REPOS||'').split(',').map(s=>s.trim().toLowerCase()).includes(repo.toLowerCase()))return reply.code(403).send({error:'Repository is not enabled for webhook scans.'});
      if(body.deleted)return reply.code(202).send({ignored:true});
      const sha=z.string().regex(/^[a-f0-9]{40}$/).parse(body.after);
      const installationId=z.number().int().positive().parse(body.installation?.id);
      if(!(process.env.GITHUB_INSTALLATION_IDS||'').split(',').map(Number).includes(installationId))return reply.code(403).send({error:'Installation is not allowed.'});
      // Delivery insertion and durable scan enqueue are one transaction.
      store.db.exec('BEGIN IMMEDIATE');
      try{if(!store.dedupe(id)){store.db.exec('COMMIT');return {duplicate:true};}
        const scan=jobs.create({mode:'github',repository:repo,ref:sha,installationId});store.db.exec('COMMIT');return reply.code(202).send({scanId:scan.id});
      }catch(error){store.db.exec('ROLLBACK');throw error;}
    });
  });
  if(existsSync(resolve('dist/web/index.html'))){await app.register(staticPlugin,{root:resolve('dist/web')});app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({error:'Endpoint not found.'}):reply.sendFile('index.html'));}
  app.addHook('onClose',async()=>{await jobs.close();store.close();});
  return {app,jobs,store};
}
