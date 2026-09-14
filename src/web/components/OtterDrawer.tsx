import {useEffect,useRef,useState} from "react";
import {X,Waves,ArrowLeft,ExternalLink} from "lucide-react";
import {PromptInput} from "./ui/ai-chat-input";
import {Button} from "./ui/Button";
import type {Scan} from "../../shared/types";
import type {Section} from "../../shared/workspace";
import type {OtterAction} from "../../server/otter";
export interface Focus {nodeId:string;advisoryId:string;}
interface Message {role:"user"|"assistant";content:string;notice?:string;actions?:OtterAction[];sources?:string[];}
const suggestions:Record<Section,string[]>={
 Overview:["Explain this scan simply","What should I investigate first?","How complete was this analysis?"],
 Risks:["Why is this ranked first?","Which risks affect production?","Which dependency has the largest ripple?"],
 Applications:["Why is this application exposed?","What should I investigate first?","Which applications are affected?"],
 Dependencies:["Why is this package here?","Is this direct or indirect?","Which applications are affected?"],
 Vulnerabilities:["Why is this vulnerability dangerous?","What fixed version is supported by the evidence?","Where did this evidence come from?"],
 "Ripple Graph":["Explain this path","What does this ripple mean?","Which applications are affected?"],
 Coverage:["Why couldn't these packages be checked?","Can I trust this scan?","What information is missing?"],
 Evidence:["Where did this evidence come from?","Where did this severity come from?","What fixed version is supported by the evidence?"]
};
export function OtterDrawer({scan,section,applicationId,nodeId,focus,onClearFocus,onClose,onNavigate,api}:{scan:Scan;section:Section;applicationId?:string;nodeId?:string;focus:Focus|null;onClearFocus:()=>void;onClose:()=>void;onNavigate:(action:OtterAction)=>void;api:<T>(path:string,body?:unknown)=>Promise<T>}){
 const effectiveNode=focus?.nodeId||nodeId;
 const key=scan.id+":"+(focus?focus.nodeId+":"+focus.advisoryId:applicationId||effectiveNode||"global");
 const [threads,setThreads]=useState<Record<string,Message[]>>(()=>{try{return JSON.parse(sessionStorage.getItem("rootline-otter-"+scan.id)||"{}");}catch{return {};}});
 const [busy,setBusy]=useState<string|null>(null);const [draft,setDraft]=useState("");
 const [config,setConfig]=useState({configured:false,model:"Groq"});
 const log=useRef<HTMLDivElement>(null);
 const messages=threads[key]||[];
 useEffect(()=>{api<typeof config>("/otter/config").then(setConfig).catch(()=>{});},[]);
 useEffect(()=>{sessionStorage.setItem("rootline-otter-"+scan.id,JSON.stringify(threads));log.current?.scrollTo({top:log.current.scrollHeight,behavior:"smooth"});},[threads]);
 useEffect(()=>{setDraft("");},[key]);
 useEffect(()=>{const listener=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};window.addEventListener("keydown",listener);return()=>window.removeEventListener("keydown",listener);},[onClose]);
 async function send(question:string,detail="Balanced"){
  if(!question.trim()||busy===key)return;
  const target=key;const prior=messages.slice(-6);
  setThreads(t=>({...t,[target]:[...(t[target]||[]),{role:"user",content:question}]}));setBusy(target);
  try{
   const answer=await api<{answer:string;notice:string;actions:OtterAction[];facts:{sourceUrls:string[]}[]}>("/scans/"+scan.id+"/otter",{question,detail,context:{section,applicationId,nodeId:effectiveNode,advisoryId:focus?.advisoryId},history:prior.map(({role,content})=>({role,content:content.slice(0,4000)}))});
   setThreads(t=>({...t,[target]:[...(t[target]||[]),{role:"assistant",content:answer.answer,notice:answer.notice,actions:answer.actions,sources:[...new Set(answer.facts.flatMap(f=>f.sourceUrls))]}]}));
  }catch(error){setThreads(t=>({...t,[target]:[...(t[target]||[]),{role:"assistant",content:"The request could not finish. Your question is preserved above; please try again.",notice:(error as Error).message}]}));}finally{setBusy(current=>current===target?null:current);}
 }
 const node=scan.graph?.nodes.find(n=>n.id===effectiveNode);
 return <aside className="otter-drawer" aria-label="OTTER conversation">
  <header className="otter-header"><Waves/><div><h2>OTTER</h2><p>{scan.mode==="demo"?"Offline demo guide":config.configured?"Groq · evidence grounded":"Evidence guide · Groq not configured"}</p></div><Button aria-label="Close OTTER" onClick={onClose}><X size={18}/></Button></header>
  <div className={"otter-context "+(focus?"focused":"")}><strong>{focus?"Focused investigation":section+" context"}</strong><span>{focus?.advisoryId||applicationId&&scan.graph?.nodes.find(n=>n.id===applicationId)?.name||scan.name}</span>{node&&<small>{node.name}@{node.version||"unresolved"}</small>}{focus&&<button onClick={onClearFocus}><ArrowLeft size={13}/> Return to scan context</button>}</div>
  <div className="otter-log" role="log" aria-live="polite" ref={log}>
   {!messages.length&&<div className="otter-welcome"><Waves size={32}/><h3>{focus?"Understand this vulnerability.":"Find a clear next step."}</h3><p>I can explain the findings, paths and coverage in this snapshot. Security facts stay tied to RootLine evidence.</p></div>}
   {messages.map((m,i)=><article className={"otter-message "+m.role} key={i}><strong>{m.role==="user"?"You":"OTTER"}</strong>{m.content.split("\n\n").map((p,j)=><p key={j}>{p}</p>)}{m.notice&&<small>{m.notice}</small>}{m.sources?.slice(0,4).map(url=><a key={url} href={url} target="_blank" rel="noreferrer">Source evidence <ExternalLink size={12}/></a>)}{m.actions&&<div className="otter-actions">{m.actions.map(a=><Button key={a.label} onClick={()=>{if(a.clearFocus)onClearFocus();else onNavigate(a);}}>{a.label}</Button>)}</div>}</article>)}
   {busy===key&&<p className="otter-thinking"><Waves size={18}/> Reading this investigation’s evidence…</p>}
  </div>
  <div className="otter-suggestions">{(focus?suggestions.Vulnerabilities:suggestions[section]).map(question=><button key={question} disabled={busy===key} onClick={()=>void send(question)}>{question}</button>)}</div>
  <div className="otter-composer"><PromptInput value={draft} onChange={setDraft} placeholder={focus?"Ask about "+focus.advisoryId+"…":"Ask OTTER about this view…"} models={[config.configured?"Groq":"Evidence guide"]} maxAttachments={0} voiceEnabled={false} disabled={busy===key} onSubmit={(q,meta)=>void send(q,meta.effort)}/><p>Answers explain recorded evidence. Dependency paths do not prove code execution.</p></div>
 </aside>;
}
