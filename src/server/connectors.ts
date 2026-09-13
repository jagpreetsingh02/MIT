import { XMLParser } from 'fast-xml-parser';
import { importPKCS8, SignJWT } from 'jose';
import { readFile } from 'node:fs/promises';
import type { Advisory, Graph, PackageNode, Provenance } from '../shared/types.js';
import type { HttpSource } from './transport.js';
const encode=encodeURIComponent;
export class Registries {
  constructor(private http:HttpSource) {}
  async enrich(n:PackageNode) {
    if(n.ecosystem==='npm') {
      const {data,provenance}=await this.http.get<any>('npm',`https://registry.npmjs.org/${encode(n.name)}/${encode(n.version)}`);
      if(data.name!==n.name || data.version!==n.version) throw new Error('Registry identity mismatch.');
      n.license=typeof data.license==='string'?data.license:undefined;n.provenance.push(provenance);
    } else if(n.ecosystem==='pypi') {
      const {data,provenance}=await this.http.get<any>('PyPI',`https://pypi.org/pypi/${encode(n.name)}/${encode(n.version)}/json`);
      n.license=data.info?.license_expression||undefined;n.provenance.push(provenance);
      for(const v of data.vulnerabilities||[]) if(!v.withdrawn) n.advisories.push({id:v.id,aliases:v.aliases||[],summary:v.summary||'PyPI reported advisory',fixed:v.fixed_in?.join(', '),provenance:[provenance,...(v.link?[{...provenance,url:v.link}]:[])]});
    } else {
      const [group,artifact]=n.name.split(':');
      const path=group.split('.').map(encode).join('/')+'/'+encode(artifact)+'/'+encode(n.version)+'/'+encode(artifact)+'-'+encode(n.version)+'.pom';
      const {data,provenance}=await this.http.get<string>('Maven Central',`https://repo.maven.apache.org/maven2/${path}`);
      if(/<!DOCTYPE|<!ENTITY/i.test(data)) throw new Error('Unexpected XML entity declaration.');
      const doc=new XMLParser({processEntities:false,parseTagValue:false}).parse(data).project;
      n.provenance.push(provenance);
      // License names are not assumed to be valid SPDX expressions.
      if(doc?.licenses) n.provenance.push({...provenance,source:'Maven license metadata (see POM)'});
    }
  }
}
export class Vulnerabilities {
  constructor(private http:HttpSource) {}
  async osv(n:PackageNode) {
    let pageToken:string|undefined;let pages=0;
    do {
      const {data,provenance}=await this.http.get<any>('OSV','https://api.osv.dev/v1/query',{method:'POST',body:{package:{purl:n.purl},...(pageToken?{page_token:pageToken}:{})}});
      for(const v of data.vulns||[]) {
        if(v.withdrawn) continue;
        const fixed=(v.affected||[]).flatMap((a:any)=>(a.ranges||[]).flatMap((r:any)=>(r.events||[]).filter((e:any)=>e.fixed).map((e:any)=>e.fixed)));
        n.advisories.push({id:v.id,aliases:v.aliases||[],summary:v.summary||v.details?.slice(0,350)||'Source-reported advisory',fixed:[...new Set<string>(fixed)].join(', ')||undefined,provenance:[{...provenance,url:`https://osv.dev/vulnerability/${encode(v.id)}`} ]});
      }
      pageToken=data.next_page_token;if(++pages>=5 && pageToken) throw new Error('OSV pagination limit reached.');
    } while(pageToken);
  }
  async nvd(id:string):Promise<{cvss?:number;provenance:Provenance}> {
    if(!/^CVE-\d{4}-\d{4,}$/.test(id)) throw new Error('Invalid CVE identifier.');
    const {data,provenance}=await this.http.get<any>('NVD',`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encode(id)}`,{headers:process.env.NVD_API_KEY?{apiKey:process.env.NVD_API_KEY}:undefined,interval:process.env.NVD_API_KEY?700:6500,ttl:86400000});
    const cve=data.vulnerabilities?.find((v:any)=>v.cve?.id===id)?.cve;
    const scores=[...(cve?.metrics?.cvssMetricV40||[]),...(cve?.metrics?.cvssMetricV31||[]),...(cve?.metrics?.cvssMetricV30||[]),...(cve?.metrics?.cvssMetricV2||[])];
    const primary=scores.find((m:any)=>m.type==='Primary')||scores[0];
    const score=primary?.cvssData?.baseScore;
    return {cvss:typeof score==='number' && score>=0 && score<=10?score:undefined,provenance};
  }
  async cve(id:string) {
    if(!/^CVE-\d{4}-\d{4,}$/.test(id)) throw new Error('Invalid CVE identifier.');
    return this.http.get<any>('CVE Program',`https://cveawg.mitre.org/api/cve/${encode(id)}`,{ttl:86400000});
  }
  async oss(nodes:PackageNode[]) {
    if(!process.env.OSS_INDEX_EMAIL || !process.env.OSS_INDEX_TOKEN) return;
    for(let i=0;i<nodes.length;i+=128) {
      const batch=nodes.slice(i,i+128);
      const {data,provenance}=await this.http.get<any[]>('OSS Index','https://ossindex.sonatype.org/api/v3/component-report',{method:'POST',body:{coordinates:batch.map(n=>n.purl)},headers:{Authorization:'Basic '+Buffer.from(process.env.OSS_INDEX_EMAIL+':'+process.env.OSS_INDEX_TOKEN).toString('base64')}});
      for(const record of data) {
        const n=batch.find(n=>n.purl===record.coordinates);if(!n)continue;
        for(const v of record.vulnerabilities||[]) n.advisories.push({id:v.cve||v.id,aliases:v.cve?[v.cve]:[],summary:v.title||'OSS Index advisory',cvss:typeof v.cvssScore==='number'?Math.max(0,Math.min(10,v.cvssScore)):undefined,provenance:[{...provenance,url:v.reference||provenance.url}]});
      }
    }
  }
  /** Paginated incremental feed; consumers must map applicability independently. */
  async *nvdSince(start:string,end:string) {
    const delta=Date.parse(end)-Date.parse(start);
    if(!Number.isFinite(delta)||delta<0||delta>120*86400000)throw new Error('NVD sync window must be 0–120 days.');
    let index=0,total=1;
    while(index<total) {
      const query=new URLSearchParams({lastModStartDate:start,lastModEndDate:end,startIndex:String(index),resultsPerPage:'100'});
      const result=await this.http.get<any>('NVD',`https://services.nvd.nist.gov/rest/json/cves/2.0?${query}`,{headers:process.env.NVD_API_KEY?{apiKey:process.env.NVD_API_KEY}:undefined,interval:process.env.NVD_API_KEY?700:6500});
      yield result;total=result.data.totalResults||0;index+=result.data.resultsPerPage||100;
    }
  }
}
export function mergeAdvisories(advisories:Advisory[]):Advisory[] {
  const groups:Advisory[]=[];
  for(const a of advisories) {
    const ids=new Set([a.id,...a.aliases]);
    const matches=groups.filter(b=>[b.id,...b.aliases].some(id=>ids.has(id)));
    if(!matches.length){groups.push({...a,aliases:[...a.aliases],provenance:[...a.provenance]});continue;}
    const target=matches[0];
    for(const item of [a,...matches.slice(1)]) {
      target.aliases=[...new Set([...target.aliases,item.id,...item.aliases])].filter(id=>id!==target.id);
      if(item.cvss!==undefined)target.cvss=Math.max(target.cvss||0,item.cvss);
      target.fixed ||= item.fixed;target.exploited ||= item.exploited;target.provenance.push(...item.provenance);
    }
    for(const duplicate of matches.slice(1)) groups.splice(groups.indexOf(duplicate),1);
  }
  return groups;
}
export async function enrichGraph(graph:Graph,http:HttpSource,progress:()=>void) {
  const registries=new Registries(http);const vulnerabilities=new Vulnerabilities(http);
  const packages=graph.nodes.filter(n=>n.kind==='package');const limit=Number(process.env.MAX_ENRICH_PACKAGES||100);
  const selected=packages.slice(0,Math.min(500,limit));
  if(selected.length<packages.length)graph.warnings.push(`Enrichment limited to ${selected.length} of ${packages.length} packages. Remaining coverage is unchecked.`);
  // Bounded concurrency; transport independently serializes source rate slots.
  let cursor=0;
  await Promise.all(Array.from({length:3},async()=>{
    while(cursor<selected.length) {
      const n=selected[cursor++];
      try {await registries.enrich(n);}catch{graph.warnings.push(`Registry metadata unavailable for ${n.name}.`);}
      try {await vulnerabilities.osv(n);n.coverage='checked';}catch{n.coverage='partial';graph.warnings.push(`Vulnerability lookup incomplete for ${n.name}.`);}
      n.advisories=mergeAdvisories(n.advisories);progress();
    }
  }));
  try{await vulnerabilities.oss(selected);}catch{graph.warnings.push('Optional OSS Index lookup failed.');}
  const cveIds=[...new Set(selected.flatMap(n=>n.advisories.flatMap(a=>[a.id,...a.aliases])).filter(id=>/^CVE-\d{4}-\d{4,}$/.test(id)))];
  const cveLimit=Number(process.env.MAX_NVD_CVES||20);
  if(cveIds.length>cveLimit)graph.warnings.push(`NVD enrichment capped at ${cveLimit} CVEs; some severities remain unknown.`);
  for(const id of cveIds.slice(0,cveLimit)) {
    const relevant=selected.flatMap(n=>n.advisories).filter(a=>a.id===id||a.aliases.includes(id));
    try{const result=await vulnerabilities.nvd(id);for(const a of relevant){if(result.cvss!==undefined)a.cvss=Math.max(a.cvss||0,result.cvss);a.provenance.push(result.provenance);}}catch{graph.warnings.push(`NVD enrichment unavailable for ${id}.`);}
    try{const result=await vulnerabilities.cve(id);for(const a of relevant)a.provenance.push(result.provenance);}catch{graph.warnings.push(`Canonical CVE record unavailable for ${id}.`);}
    progress();
  }
  selected.forEach(n=>{n.advisories=mergeAdvisories(n.advisories);if(n.advisories.some(a=>a.cvss===undefined))n.coverage='partial';});
}
export function canonicalRepository(value:string) {
  const match=value.match(/^(?:https:\/\/github\.com\/)?([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/);
  if(!match || ['.','..'].includes(match[2]))throw new Error('Use a canonical GitHub owner/repository or https://github.com/owner/repository URL.');
  return match[1]+'/'+match[2];
}
export class GitHub {
  constructor(private http:HttpSource) {}
  async headers(installationId?:number):Promise<Record<string,string>> {
    const headers:Record<string,string>={'X-GitHub-Api-Version':'2022-11-28','Accept':'application/vnd.github+json'};
    if(installationId) {
      const allowed=(process.env.GITHUB_INSTALLATION_IDS||'').split(',').map(Number);
      if(!allowed.includes(installationId))throw new Error('GitHub installation is not allowed.');
      if(!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY_PATH)throw new Error('GitHub App credentials are not configured.');
      const key=await importPKCS8(await readFile(process.env.GITHUB_APP_PRIVATE_KEY_PATH,'utf8'),'RS256');
      const jwt=await new SignJWT({}).setProtectedHeader({alg:'RS256'}).setIssuedAt(Math.floor(Date.now()/1000)-60).setExpirationTime('9m').setIssuer(process.env.GITHUB_APP_ID).sign(key);
      const {data}=await this.http.get<any>('GitHub',`https://api.github.com/app/installations/${installationId}/access_tokens`,{method:'POST',headers:{...headers,Authorization:'Bearer '+jwt},body:{permissions:{contents:'read'}},ttl:0});
      headers.Authorization='Bearer '+data.token;
    }
    return headers;
  }
  async manifests(repository:string,ref:string,installationId?:number) {
    const repo=canonicalRepository(repository);const headers=await this.headers(installationId);
    const {data:commit}=await this.http.get<any>('GitHub',`https://api.github.com/repos/${repo}/commits/${encode(ref)}`,{headers,ttl:60_000});
    if(!/^[a-f0-9]{40}$/.test(commit.sha))throw new Error('GitHub did not return a valid commit.');
    const {data:tree}=await this.http.get<any>('GitHub',`https://api.github.com/repos/${repo}/git/trees/${commit.sha}?recursive=1`,{headers});
    if(tree.truncated)throw new Error('Repository tree exceeds GitHub API limits. Submit a manifest instead.');
    const {supportedFiles}=await import('./parsers.js');
    let paths=(tree.tree||[]).filter((f:any)=>f.type==='blob' && supportedFiles.includes(f.path.split('/').pop()) && !/(^|\/)(node_modules|vendor|\.git)\//.test(f.path));
    // Prefer one complete snapshot per directory and ecosystem.
    paths=paths.filter((f:any)=>!paths.some((other:any)=>other!==f && other.path.slice(0,other.path.lastIndexOf('/')+1)===f.path.slice(0,f.path.lastIndexOf('/')+1) && ((f.path.endsWith('package-lock.json') && other.path.endsWith('npm-shrinkwrap.json'))||(f.path.endsWith('pom.xml')&&other.path.endsWith('dependency-tree.json'))||(f.path.endsWith('requirements.txt')&&other.path.endsWith('Pipfile.lock')))));
    if(!paths.length)throw new Error('No supported resolved manifests found. Commit a lockfile or upload a supported manifest.');
    if(paths.length>12)throw new Error('More than 12 manifests found. Submit a scoped manifest for this V1 scan.');
    const files=[];
    for(const path of paths) {
      if(path.size>2_000_000)throw new Error('Repository manifest exceeds 2 MB.');
      const {data,provenance}=await this.http.get<any>('GitHub',`https://api.github.com/repos/${repo}/git/blobs/${path.sha}`,{headers});
      if(data.encoding!=='base64')throw new Error('Unexpected GitHub blob encoding.');
      files.push({filename:path.path,content:Buffer.from(data.content,'base64').toString('utf8'),provenance:{...provenance,url:`https://github.com/${repo}/blob/${commit.sha}/${path.path}`}});
    }
    return {files,commit:commit.sha};
  }
}
