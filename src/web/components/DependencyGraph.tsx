import { useMemo, useState } from 'react';
import { Minus, Plus, Maximize2, MousePointer2 } from 'lucide-react';
import type { Graph, Risk, Simulation } from '../../shared/types';
import { Button } from './ui/Button';
export function DependencyGraph({graph,risks,selected,onSelect,simulation}:{graph:Graph;risks:Risk[];selected:string;onSelect:(id:string)=>void;simulation:Simulation|null}) {
  const [zoom,setZoom]=useState(1);const [focus,setFocus]=useState(false);
  const positions=useMemo(()=>{
    const groups=new Map<number,typeof graph.nodes>();
    graph.nodes.forEach(n=>{const col=n.kind==='service'?0:Math.min(n.depth??4,4);groups.set(col,[...(groups.get(col)||[]),n]);});
    const width=Math.max(930,(Math.max(...groups.keys())+1)*215);
    const height=Math.max(570,Math.max(...[...groups.values()].map(g=>g.length))*69+95);
    const pos=new Map<string,{x:number;y:number}>();
    groups.forEach((nodes,col)=>nodes.forEach((n,i)=>pos.set(n.id,{x:40+col*215,y:88+(i+0.5)*(height-130)/nodes.length})));
    return {pos,width,height};
  },[graph]);
  const riskMap=new Map(risks.map(r=>[r.nodeId,r]));
  const affected=new Set(simulation?[simulation.nodeId,...simulation.affected]:[]);
  const neighbors=new Set([selected,...graph.edges.filter(e=>e.from===selected||e.to===selected).flatMap(e=>[e.from,e.to])]);
  return <div className="graph-shell">
    <div className="graph-title"><div><h2>Dependency map <span>{graph.nodes.length} nodes</span></h2><p>{simulation?'Following risk back to the services that depend on it.':'Select a package to explore its connections.'}</p></div><label className="toggle"><input type="checkbox" checked={focus} onChange={e=>setFocus(e.target.checked)}/> Focus selection</label></div>
    <div className="graph-scroll" aria-label="Interactive dependency graph">
      <svg className="dependency-svg" viewBox={`0 0 ${positions.width} ${positions.height}`} style={{width:`${zoom*100}%`,minWidth:zoom>1?`${zoom*700}px`:'650px'}} role="group" aria-label="Dependency map. Arrows point from a service or package to its dependency.">
        <defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#dce2e8"/></pattern><marker id="arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6" fill="#b1beca"/></marker><marker id="ripple-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6" fill="#c04c22"/></marker></defs>
        <rect width="100%" height="100%" fill="url(#dots)"/>
        {['APPLICATIONS','DIRECT DEPENDENCIES','TRANSITIVE · DEPTH 2','TRANSITIVE · DEPTH 3','DEPTH 4+'].map((s,i)=>i*215+40<positions.width&&<text key={s} x={40+i*215} y={37} className="column-label">{s}</text>)}
        {graph.edges.map(e=>{const a=positions.pos.get(e.from)!,b=positions.pos.get(e.to)!;const active=simulation?affected.has(e.from)&&affected.has(e.to):e.from===selected||e.to===selected;const muted=(simulation&&!active)||(focus&&(!neighbors.has(e.from)||!neighbors.has(e.to)));const start=a.x+155,end=b.x-5;return <path key={e.from+e.to} d={`M${start} ${a.y} C${start+55} ${a.y},${end-65} ${b.y},${end} ${b.y}`} fill="none" stroke={active?(simulation?'#c04c22':'#778b9b'):'#ced7df'} strokeWidth={active?2:1.2} markerEnd={`url(#${active&&simulation?'ripple-arrow':'arrow'})`} opacity={muted?0.12:1} className={active&&simulation?'ripple-edge':''}/>;})}
        {graph.nodes.map(n=>{const p=positions.pos.get(n.id)!,risk=riskMap.get(n.id);const active=selected===n.id;const service=n.kind==='service';const muted=(simulation&&!affected.has(n.id))||(focus&&!neighbors.has(n.id));const color=risk?.level==='critical'?'#b5372e':risk?.level==='high'?'#c35b22':risk?.level==='medium'?'#9d780e':'#489684';const label=n.name.includes(':')?n.name.split(':').pop()!:n.name;return <g key={n.id} className={`graph-node ${active?'selected':''}`} role="button" tabIndex={0} aria-label={`${n.name} ${n.version}${risk?`, risk ${risk.score}`:', application'}`} aria-pressed={active} onClick={()=>onSelect(n.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(n.id);}}} transform={`translate(${p.x},${p.y-22})`} opacity={muted?0.25:1}>
          {active&&<rect x="-5" y="-5" width="165" height="54" rx="10" fill="none" stroke="#c04c22" strokeWidth="1.5"/>}
          <rect width="155" height="44" rx="6" fill={service?'#263c3e':'#fff'} stroke={service?'#263c3e':active?'#c04c22':'#d3dce3'}/>
          <circle cx="13" cy="15" r="3" fill={service?'#8ad4bc':color}/><text x="24" y="19" className="node-name" fill={service?'#fff':'#243440'}>{label.length>19?label.slice(0,17)+'…':label}</text><text x="24" y="33" className="node-version" fill={service?'#bdcec8':'#687785'}>{service?'APPLICATION':n.version}</text>
        </g>;})}
      </svg>
    </div>
    <div className="graph-footer"><div className="legend"><span><i className="dot critical"/>Critical</span><span><i className="dot high"/>High</span><span><i className="dot medium"/>Medium</span><span><i className="dot low"/>Low</span></div><div className="graph-tools"><span><MousePointer2 size={13}/> Select to inspect</span><Button aria-label="Zoom out" onClick={()=>setZoom(v=>Math.max(0.7,v-0.15))}><Minus size={15}/></Button><span className="zoom-value">{Math.round(zoom*100)}%</span><Button aria-label="Zoom in" onClick={()=>setZoom(v=>Math.min(2,v+0.15))}><Plus size={15}/></Button><Button aria-label="Fit graph" onClick={()=>setZoom(1)}><Maximize2 size={15}/></Button></div></div>
  </div>;
}
