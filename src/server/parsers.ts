import { XMLParser } from 'fast-xml-parser';
import { node, finalize } from './graph.js';
import type { Ecosystem, Graph, PackageNode, Provenance } from '../shared/types.js';
const MAX_FILE = 2_000_000;
const exact = (v: unknown): v is string => typeof v === 'string' && /^[0-9][0-9A-Za-z.!+_\-]*$/.test(v);
export const supportedFiles = ['npm-shrinkwrap.json','package-lock.json','Pipfile.lock','requirements.txt','dependency-tree.json','pom.xml'];
export function parseManifest(filename: string, content: string, source?: Provenance): Graph {
  if(Buffer.byteLength(content) > MAX_FILE) throw new Error('Manifest exceeds 2 MB.');
  const file = filename.split('/').pop()!;
  const graph: Graph = {nodes:[], edges:[], warnings:[]};
  const origin = source || {source:filename,url:'',retrievedAt:new Date().toISOString()};
  function add(eco:Ecosystem,name:string,version:string,kind:PackageNode['kind']='package') {
    if(!exact(version)) throw new Error(`Unresolved version for ${name}. Supply an exact lockfile or resolved dependency tree.`);
    const n=node(eco,name,version,kind); n.provenance=[origin]; graph.nodes.push(n); return n;
  }
  if(file === 'package-lock.json' || file === 'npm-shrinkwrap.json') {
    const data = JSON.parse(content);
    if(![2,3].includes(data.lockfileVersion) || !data.packages?.['']) throw new Error('Use npm package-lock v2 or v3 with a packages map.');
    const entries = data.packages as Record<string, {name?:string;version?:string;link?:boolean;dev?:boolean;license?:string;dependencies?:Record<string,string>;devDependencies?:Record<string,string>;optionalDependencies?:Record<string,string>;peerDependencies?:Record<string,string>}>;
    const byPath=new Map<string,PackageNode>();
    for(const [path,info] of Object.entries(entries)) {
      if(info.link) {graph.warnings.push(`Workspace link ${path} was not resolved; graph coverage is partial.`);continue;}
      const name=info.name || (path ? path.split('node_modules/').pop()! : data.name || 'application');
      if(!info.version && path) {graph.warnings.push(`Unresolved dependency ${name} omitted.`);continue;}
      const n=add('npm',name,info.version || data.version || '0.0.0',path ? 'package':'service');
      n.scope=info.dev ? 'development':'runtime';n.license=info.license;byPath.set(path,n);
    }
    function resolve(from:string,name:string) {
      let path=from;
      while(true) {
        const found=byPath.get((path ? path+'/':'')+'node_modules/'+name);
        if(found) return found;
        if(!path) return undefined;
        const index=path.lastIndexOf('/node_modules/'); path=index<0 ? '' : path.slice(0,index);
      }
    }
    for(const [path,info] of Object.entries(entries)) {
      const parent=byPath.get(path);if(!parent) continue;
      const dependencies={...info.dependencies,...info.optionalDependencies,...info.peerDependencies,...(!path ? info.devDependencies : {})};
      for(const name of Object.keys(dependencies)) {
        const child=resolve(path,name);
        if(child) graph.edges.push({from:parent.id,to:child.id});
        else graph.warnings.push(`Unresolved or platform-optional edge: ${parent.name} → ${name}.`);
      }
    }
  } else if(file==='requirements.txt') {
    const root=add('pypi','python-application','0.0.0','service');
    for(const line of content.split('\n')) {
      const value=line.split('#')[0].trim();if(!value || value.startsWith('--hash')) continue;
      const match=value.match(/^([A-Za-z0-9_.-]+)(?:\[[A-Za-z0-9_,.-]+\])?==([0-9][A-Za-z0-9.!+_-]*)(?:\s*(?:;.*|--hash=.*|\\))?$/);
      if(!match) throw new Error('requirements.txt must contain exact name==version pins; URLs, includes and ranges are not supported.');
      const child=add('pypi',match[1],match[2]);graph.edges.push({from:root.id,to:child.id});
    }
    graph.warnings.push('Flat requirements snapshot: all pins are attached to the application. Transitive ancestry and environment markers are not resolved.');
  } else if(file==='Pipfile.lock') {
    const data=JSON.parse(content);const root=add('pypi','python-application','0.0.0','service');
    for(const group of ['default','develop']) for(const [name,raw] of Object.entries(data[group] || {})) {
      const info=raw as {version?:string};if(!info.version?.startsWith('==')) throw new Error(`Pipfile.lock requires an exact version for ${name}.`);
      const child=add('pypi',name,info.version.slice(2));child.scope=group==='develop'?'development':'runtime';graph.edges.push({from:root.id,to:child.id});
    }
    graph.warnings.push('Pipfile.lock is a flat snapshot; direct/transitive ancestry and environment markers are not resolved.');
  } else if(file==='dependency-tree.json') {
    const tree=JSON.parse(content);
    function walk(raw:any, parent?:PackageNode,depth=0) {
      if(depth>100 || graph.nodes.length>2000) throw new Error('Maven tree exceeds graph limits.');
      if(!raw.groupId || !raw.artifactId) throw new Error('Expected Maven dependency:tree JSON coordinates.');
      const n=add('maven',raw.groupId+':'+raw.artifactId,raw.version,parent?'package':'service');n.scope=raw.scope==='test'?'development':'runtime';
      if(parent) graph.edges.push({from:parent.id,to:n.id});
      for(const child of raw.children || []) walk(child,n,depth+1);
    }walk(tree);
  } else if(file==='pom.xml') {
    if(/<!DOCTYPE|<!ENTITY/i.test(content)) throw new Error('XML declarations with entities or DTDs are not accepted.');
    const doc=new XMLParser({ignoreAttributes:false,processEntities:false,parseTagValue:false,removeNSPrefix:true}).parse(content).project;
    if(!doc) throw new Error('Invalid Maven POM.');
    const root=add('maven',(doc.groupId||doc.parent?.groupId||'local')+':'+(doc.artifactId||'application'),doc.version||doc.parent?.version||'0.0.0','service');
    const deps=doc.dependencies?.dependency; const list=deps ? Array.isArray(deps)?deps:[deps] : [];
    for(const dep of list) {
      let version=dep.version;
      if(typeof version==='string') version=version.replace(/\$\{([^}]+)\}/g,(_:string,key:string)=>doc.properties?.[key]||'');
      if(!exact(version)) {graph.warnings.push(`Unresolved managed version: ${dep.groupId}:${dep.artifactId}. Export dependency-tree.json for full resolution.`);continue;}
      const child=add('maven',dep.groupId+':'+dep.artifactId,version);child.scope=dep.scope==='test'?'development':'runtime';graph.edges.push({from:root.id,to:child.id});
    }
    graph.warnings.push('POM import includes exact direct dependencies only. Parent/BOM mediation, profiles and transitives require dependency-tree.json.');
  } else throw new Error(`Unsupported file. Supported: ${supportedFiles.join(', ')}.`);
  if(!graph.nodes.some(n=>n.kind==='package')) throw new Error('No resolved packages were found in this manifest.');
  return finalize(graph);
}
