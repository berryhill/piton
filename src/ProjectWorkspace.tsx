import { useEffect, useRef, useState } from "react";
import Viewport from "./components/Viewport";
import { CadApplication } from "./application";
import { openProjectRepository } from "./storage/repository";
import { WorkspaceApplication, parseWorkspaceRoute, resolvePart, type PartProposal, type WorkspaceState, type PartDocument } from "./workspace";
import type { DesignRevision, LBracketParameters } from "./domain";
import "./styles.css";
import "./workspace.css";
import type { GeometryResult } from "./geometry/gate";
import { downloadPartFile, reviewPartStl } from "./partExport";

declare global { interface Window { pitonWorkspace: WorkspaceApplication; } }
export default function ProjectWorkspace({application}: {application: WorkspaceApplication}) {
  const [state,setState]=useState<WorkspaceState>(); const [path,setPath]=useState(location.pathname); const [error,setError]=useState(""); const [label,setLabel]=useState("");
  const mounted=useRef(false), readGeneration=useRef(0), pageGeneration=useRef(0), actionPending=useRef(false);
  const [pending,setPending]=useState(false);
  const refresh=async()=>{
    const generation=++readGeneration.current;
    try { const next=await application.read(); if(mounted.current && generation===readGeneration.current) {setState(next);setError("");} }
    catch(e) { if(mounted.current && generation===readGeneration.current) setError(String(e)); }
  };
  const navigate=(url:string)=>{if(!mounted.current)return;pageGeneration.current++;history.pushState(null,"",url);setPath(url);setError("");setLabel("");};
  useEffect(()=>{
    mounted.current=true; window.pitonWorkspace=application;
    const unsubscribe=application.subscribe(()=>{void refresh();});
    const back=()=>{pageGeneration.current++;setPath(location.pathname);setError("");setLabel("");void refresh();};
    window.addEventListener("popstate",back); void refresh();
    return()=>{mounted.current=false;readGeneration.current++;pageGeneration.current++;unsubscribe();window.removeEventListener("popstate",back);};
  },[application]);
  const act=async(fn:(go:(url:string)=>void)=>Promise<unknown>)=>{
    if(actionPending.current)return;
    actionPending.current=true;setPending(true);
    const page=pageGeneration.current;
    const current=()=>mounted.current && page===pageGeneration.current;
    try {setError("");await fn(url=>{if(current())navigate(url);});}
    catch(e){if(current())setError(e instanceof Error?e.message:String(e));}
    finally {actionPending.current=false;if(mounted.current)setPending(false);}
  };
  let route: ReturnType<typeof parseWorkspaceRoute> | undefined; let routeError=""; try {route=parseWorkspaceRoute(path);} catch(e){routeError=String(e);}
  const project=state?.projects.find(p=>p.id===route?.projectId);
  if(state && route?.projectId && !project) routeError="Project not found in this browser. Import a saved custody file to recover; links do not synchronize devices.";
  let document:PartDocument|undefined;
  if(state && route?.documentId) try {document=resolvePart(state,route.projectId!,route.documentId).document;}catch(e){routeError=String(e);}
  if(route?.revisionId && document && !document.revisionIds[route.revisionId]) routeError="Revision not found in this document";
  const recover=async(namespace:string,go:(url:string)=>void)=>{const repository=await openProjectRepository(namespace);const legacy=new CadApplication(repository);await legacy.open("reopen-existing"); const id=await application.importCustody(await legacy.exportPortableCustody());go(`/projects/${id}`);};
  const importFile=async(file:File,go:(url:string)=>void)=>{
    if(file.size>20*1024*1024)throw new Error("Custody file exceeds 20 MiB");
    const packet=JSON.parse(await file.text());
    const id=packet?.format==="piton-workspace-project/v1" ? await application.importProject(packet) : await application.importCustody(packet);
    if(route?.projectId!==id)go(`/projects/${id}`);
  };
  return <main className="project-workspace"><header><div><span className="eyebrow">PITON · BROWSER-LOCAL CAD</span><h1>{document?.name??project?.name??"Projects"}</h1></div><button onClick={()=>navigate("/projects")}>All projects</button></header>
    <p>Saved in this browser’s SQLite / OPFS storage. No account or cross-device sync. Keep custody backups before clearing browser data.</p>
    <p className="safety">needs_human_review · fabrication_release=false · machine_actuation=false · Review mesh, not exact geometry</p>
    {(error||routeError)&&<p role="alert">{error||routeError}</p>}
    {routeError&&state&&<label>Recover project backup<input type="file" accept="application/json,.json" onChange={e=>{const file=e.target.files?.[0];if(file)void act(go=>importFile(file,go));}}/></label>}
    {state&&!routeError&&route?.projectId&&<p>Local bookmark: <a href={path}>{location.origin}{path}</a> <button onClick={()=>void act(()=>navigator.clipboard.writeText(location.origin+path))}>Copy link</button></p>}
    {!state && <p>Opening local storage…</p>}
    {state&&!routeError&&!route?.projectId&&<><h2>Recent projects</h2><form onSubmit={e=>{e.preventDefault();void act(async go=>go(`/projects/${await application.createProject(label)}`));}}><label>Project name <input value={label} onChange={e=>setLabel(e.target.value)} required maxLength={100}/></label><button disabled={pending}>Create project</button></form>
      {[...state.projects].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(p=><article key={p.id}><button onClick={()=>navigate(`/projects/${p.id}`)}>{p.name}</button><span>{p.archived?"Archived":"Active"} · {p.documents.length} Parts</span></article>)}
      {!state.projects.length&&<p>No projects yet. Create your first project, or recover existing work below.</p>}
      <h2>Recover / import existing work</h2><button onClick={()=>void act(go=>recover("piton",go))}>Discover legacy default project</button>
      <label>Legacy import namespace UUID <input id="legacy-namespace"/></label><button onClick={()=>void act(go=>recover(`piton-import-${(globalThis.document.getElementById("legacy-namespace") as HTMLInputElement).value}`,go))}>Recover legacy namespace</button>
      <label>Import custody JSON <input type="file" accept="application/json,.json" onChange={e=>{const file=e.target.files?.[0];if(file)void act(go=>importFile(file,go));}}/></label>
      <a href="/demo">Open optional R14 review fixture / legacy workspace</a></>}
    {state&&project&&!routeError&&!document&&<><form onSubmit={e=>{e.preventDefault();void act(()=>application.renameProject(project.id,label));}}><label>Project name <input value={label} placeholder={project.name} onChange={e=>setLabel(e.target.value)} required/></label><button disabled={pending}>Rename project</button></form>
      <button onClick={()=>void act(()=>application.archiveProject(project.id,!project.archived))}>{project.archived?"Restore project":"Archive project"}</button>
      <button onClick={()=>void act(async()=>downloadPartFile(`${project.id}-project.json`,JSON.stringify(await application.exportProject(project.id),null,2),"application/json"))}>Export project backup</button>
      {!project.archived&&<form onSubmit={e=>{e.preventDefault();void act(async go=>go(`/projects/${project.id}/documents/${await application.createPart(project.id,label)}`));}}><label>Part name <input value={label} onChange={e=>setLabel(e.target.value)} required/></label><button disabled={pending}>Create Part</button></form>}
      <h2>Part documents</h2>{project.documents.map(d=><article key={d.id}><button onClick={()=>navigate(`/projects/${project.id}/documents/${d.id}`)}>{d.name}</button></article>)}</>}
    {project&&document&&!routeError&&<PartEditor key={`${document.id}:${route?.revisionId??"current"}`} application={application} projectId={project.id} document={document} revisionId={route?.revisionId} archived={project.archived} refresh={refresh} navigate={navigate}/>}
  </main>;
}
function PartEditor({application,projectId,document,revisionId,archived,refresh,navigate}:{application:WorkspaceApplication;projectId:string;document:PartDocument;revisionId?:string;archived:boolean;refresh:()=>Promise<void>;navigate:(url:string)=>void}) {
  const selected=revisionId?document.revisionIds[revisionId]:document.part.currentRevisionId;
  const revision=document.part.revisions.find(r=>r.id===selected)!;
  const [parameters,setParameters]=useState<LBracketParameters>({...revision.parameters}); const [preview,setPreview]=useState<{proposal:PartProposal;candidate:DesignRevision}|null>(null); const [message,setMessage]=useState(""); const [json,setJson]=useState(""); const [ready,setReady]=useState(false); const [newName,setNewName]=useState(document.name);
  const [mesh,setMesh]=useState<GeometryResult|null>(null);
  const proposalGeneration = useRef(0);
  const mounted=useRef(false), operationPending=useRef(false), ownCommit=useRef<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [base,setBase]=useState({revision,name:document.name,archived});
  const [conflict,setConflict]=useState(false);
  const dirty=!!preview || !!json || newName!==base.name || Object.entries(parameters).some(([key,value])=>value!==base.revision.parameters[key as keyof LBracketParameters]);
  const changed=base.revision.id!==revision.id || base.name!==document.name || base.archived!==archived;
  const blocked=conflict || (changed && dirty && ownCommit.current!==revision.id);
  const reload=()=>{
    proposalGeneration.current++;setBase({revision,name:document.name,archived});
    setParameters({...revision.parameters});setNewName(document.name);setJson("");
    setPreview(null);setReady(false);setMesh(null);setConflict(false);ownCommit.current=null;
  };
  useEffect(()=>{
    if(!changed)return;
    if(dirty && ownCommit.current!==revision.id) {
      proposalGeneration.current++;setPreview(null);setReady(false);setMesh(null);setConflict(true);
    } else if(!conflict) reload();
  },[document,archived]);
  useEffect(() => {mounted.current=true;return () => { mounted.current=false;proposalGeneration.current += 1; };}, []);
  const readonly=!!revisionId||archived; const url=`/projects/${projectId}/documents/${document.id}`;
  const run=async(fn:()=>Promise<void>)=>{
    if(operationPending.current || !mounted.current)return;
    operationPending.current=true;setBusy(true);
    try{setMessage("");await fn();}catch(e){if(mounted.current)setMessage(String(e));}
    finally{operationPending.current=false;if(mounted.current)setBusy(false);}
  };
  const proposal=():PartProposal=>({projectId,documentId:document.id,expectedRevisionId:Object.keys(document.revisionIds).find(id=>document.revisionIds[id]===base.revision.id)!,idempotencyKey:crypto.randomUUID(),parameters});
  const propose=async(input:unknown)=>{
    if(blocked||readonly)return;
    const generation = ++proposalGeneration.current;
    setPreview(null); setReady(false);
    const p=await application.propose(input);
    if (generation !== proposalGeneration.current || !mounted.current) return;
    if(p.proposal.projectId!==projectId||p.proposal.documentId!==document.id)throw new Error("Proposal scope mismatch");
    setPreview(p);setParameters(p.proposal.parameters);
  };
  const shown=preview?.candidate??revision;
  return <><nav><button onClick={()=>navigate(`/projects/${projectId}`)}>Project overview</button>{readonly&&<button onClick={()=>navigate(url)}>Open current revision</button>}</nav><p>{readonly?"Historical / archived document — read-only":"Editable Part · L-bracket"}</p><div className="part-layout"><section><h2>Parameters (mm)</h2>
    {blocked&&<p role="alert">Document changed outside this draft. Reload the latest revision before authoring; your unsaved draft has been preserved.</p>}{blocked&&<button disabled={busy} onClick={reload}>Reload latest revision</button>}
    <fieldset disabled={readonly || busy || blocked}>{Object.entries(parameters).map(([key,value])=><label key={key}>{key}<input aria-label={key} type="number" step="0.1" value={Number.isFinite(value) ? value : ""} onChange={e=>{proposalGeneration.current += 1;setParameters({...parameters,[key]:e.target.valueAsNumber});setPreview(null);setReady(false);}}/></label>)}
      <button onClick={()=>void run(()=>propose(proposal()))}>Propose and preview</button><button disabled={!preview||!ready||mesh?.sourceRevisionId!==preview.candidate.id} onClick={()=>void run(async()=>{if(blocked||readonly||!preview||!ready||mesh?.sourceRevisionId!==preview.candidate.id)return;ownCommit.current=preview.candidate.id;try {await application.commit(preview.proposal);if(!mounted.current)return;await refresh();if(mounted.current)setMessage("Revision committed; engineering approval not granted.");} catch(e) {ownCommit.current=null;throw e;}})}>Commit revision</button>
      {preview && <section aria-label="Proposed parameter changes"><h2>Preview only · not committed</h2><ul>{Object.entries(preview.proposal.parameters).filter(([key, value]) => value !== revision.parameters[key as keyof LBracketParameters]).map(([key, value]) => <li key={key}>{key}: {revision.parameters[key as keyof LBracketParameters]} → {value} mm</li>)}</ul><button onClick={() => {proposalGeneration.current += 1;setPreview(null);setParameters({...revision.parameters});setReady(false);}}>Discard preview</button></section>}
      <h2>Structured change request</h2><p>Local typed proposal, no LLM backend. Supply the six parameter values as JSON; project, document and base revision are attached automatically.</p><textarea aria-label="Structured change request" value={json} onChange={e=>{proposalGeneration.current+=1;setJson(e.target.value);setPreview(null);setReady(false);}} placeholder={JSON.stringify(parameters,null,2)}/><button onClick={()=>void run(async()=>{setPreview(null);setReady(false);await propose({...proposal(),parameters:JSON.parse(json)});})}>Prepare change proposal</button>
      <label>Part name<input value={newName} onChange={e=>setNewName(e.target.value)}/></label><button onClick={()=>void run(async()=>{if(blocked||readonly)return;await application.renamePart(projectId,document.id,newName);if(!mounted.current)return;setBase(previous=>({...previous,name:newName}));await refresh();})}>Rename Part</button>
    </fieldset><button disabled={!!revisionId} onClick={()=>void run(async()=>downloadPartFile(`${document.id}-custody.json`,JSON.stringify(await application.exportPart(projectId,document.id),null,2),"application/json"))}>Export Part custody</button><button disabled={!mesh||mesh.sourceRevisionId!==shown.id} onClick={()=>void run(async()=>downloadPartFile(`${document.id}-review-unreleased.stl`,reviewPartStl(mesh!,shown.id),"model/stl"))}>Download Part review STL (unreleased)</button><p role="status">{message}</p><h2>Revision history</h2>{Object.entries(document.revisionIds).reverse().map(([id,content],index)=><button key={id} onClick={()=>navigate(`${url}/revisions/${id}`)}>Revision {document.part.revisions.length-index}{content===document.part.currentRevisionId?" · current":""}</button>)}
    </section><section className="canvas part-canvas" data-document-id={document.id} data-revision-id={shown.id}><Viewport onReviewMesh={setMesh} parameters={shown.parameters} authoritativeBase={shown} onBuildStatus={status=>setReady(status.state==="ready")} /></section></div></>;
}
