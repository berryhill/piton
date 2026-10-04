import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Viewport from "./components/Viewport";
import { CadApplication } from "./application";
import { openProjectRepository } from "./storage/repository";
import { WorkspaceApplication, isAuthoredPart, isFeaturePart, parseWorkspaceRoute, resolvePart, type FeatureProposal, type WorkspaceProject, type PartProposal, type WorkspaceState, type PartDocument } from "./workspace";
import type { BrowserProject, DesignRevision, LBracketParameters } from "./domain";
import "./styles.css";
import "./workspace.css";
import type { GeometryResult } from "./geometry/gate";
import { downloadPartFile, reviewPartStl } from "./partExport";
import { ConversationPanel } from "./chat/ConversationPanel";
import type { SelectionReference } from "./chat/context";
import { readFeatures, type PartFeature } from "./modeling/source";
import type { FeatureEvaluation } from "./modeling/evaluator";
import FeatureMeshViewport from "./modeling/FeatureMeshViewport";
import { evaluateFeatureSourceInWorker } from "./modeling/client";
import { PartCommandUI } from "./modeling/PartCommandUI";
import { emptyFeatureSource } from "./modeling/source";
import type { FixtureReviewMeasurement, FixtureReviewPoint } from "./fixture";

declare global { interface Window { pitonWorkspace: WorkspaceApplication; } }
export default function ProjectWorkspace({application}: {application: WorkspaceApplication}) {
  const [state,setState]=useState<WorkspaceState>(); const [path,setPath]=useState(location.pathname); const [error,setError]=useState(""); const [label,setLabel]=useState("");
  const mounted=useRef(false), readGeneration=useRef(0), pageGeneration=useRef(0), actionPending=useRef(false);
  const [pending,setPending]=useState(false);
  const [createOpen,setCreateOpen]=useState(false), [createError,setCreateError]=useState("");
  const createDialog=useRef<HTMLDialogElement>(null), createOpener=useRef<HTMLButtonElement>(null);
  const closeCreate=()=>{
    pageGeneration.current++;
    createDialog.current?.close();setCreateOpen(false);setLabel("");setCreateError("");
    createOpener.current?.focus();
  };
  const openCreate=()=>{
    setLabel("");setCreateError("");setCreateOpen(true);createDialog.current?.showModal();
  };
  const refresh=async()=>{
    const generation=++readGeneration.current;
    try { const next=await application.read(); if(mounted.current && generation===readGeneration.current) {setState(next);setError("");} }
    catch(e) { if(mounted.current && generation===readGeneration.current) setError(String(e)); }
  };
  const navigate=(url:string)=>{if(!mounted.current)return;createDialog.current?.close();setCreateOpen(false);pageGeneration.current++;history.pushState(null,"",url);setPath(url);setError("");setLabel("");};
  useEffect(()=>{
    mounted.current=true; window.pitonWorkspace=application;
    const unsubscribe=application.subscribe(()=>{void refresh();});
    const back=()=>{createDialog.current?.close();setCreateOpen(false);pageGeneration.current++;setPath(location.pathname);setError("");setLabel("");void refresh();};
    window.addEventListener("popstate",back); void refresh();
    return()=>{mounted.current=false;readGeneration.current++;pageGeneration.current++;unsubscribe();window.removeEventListener("popstate",back);};
  },[application]);
  const act=async(fn:(go:(url:string)=>void)=>Promise<unknown>, onError=setError)=>{
    if(actionPending.current)return;
    actionPending.current=true;setPending(true);
    const page=pageGeneration.current;
    const current=()=>mounted.current && page===pageGeneration.current;
    try {setError("");await fn(url=>{if(current())navigate(url);});}
    catch(e){if(current())onError(e instanceof Error?e.message:String(e));}
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
  if(state && project && !routeError) return <ProjectWorkbench key={project.id} application={application} project={project} document={document} revisionId={route?.revisionId} path={path} navigate={navigate} refresh={refresh} act={act} pending={pending} error={error}/>;
  if(state&&!routeError&&!route?.projectId) return <main className="project-workspace projects-home">
    <div className="projects-brand">PITON <span>Design workspace</span></div>
    <div className="projects-content"><header className="projects-heading"><div><h1>Projects</h1><p>Create a project or open one to continue designing.</p></div>
      <button ref={createOpener} className="workspace-primary" onClick={openCreate}>Create project</button>
    </header>
    <dialog ref={createDialog} className="project-create-dialog" aria-labelledby="create-project-title" aria-describedby="create-project-description" onCancel={e=>{e.preventDefault();closeCreate();}}>
      <h2 id="create-project-title">Create project</h2>
      <p id="create-project-description">Start with an empty workbench. Add Parts when you’re ready.</p>
      <form className="project-create" onSubmit={e=>{e.preventDefault();if(!createOpen)return;setCreateError("");void act(async go=>go(`/projects/${await application.createProject(label)}`),setCreateError);}}>
        <label>Project name<input autoFocus placeholder="Name your project" value={label} onChange={e=>setLabel(e.target.value)} required maxLength={100} disabled={pending}/></label>
        {createError&&<p role="alert">{createError}</p>}
        <div className="project-create-actions"><button type="button" onClick={closeCreate}>Cancel</button><button className="workspace-primary" disabled={pending}>{pending?"Creating…":"Create project"}</button></div>
      </form>
    </dialog>
    {error&&!createOpen&&<p role="alert">{error}</p>}
    <section className="projects-list" aria-label="Project list"><h2>Recent projects <span>{state.projects.length}</span></h2>
      <div className="projects-table-wrap"><table><thead><tr><th>Project</th><th>Documents</th><th>Status</th><th>Last updated</th></tr></thead><tbody>
        {[...state.projects].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(p=><tr key={p.id}><td><a href={`/projects/${p.id}`} onClick={e=>{if(e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){e.preventDefault();navigate(`/projects/${p.id}`);}}}>{p.name}</a></td><td>{p.documents.length}</td><td>{p.archived?"Archived":"Active"}</td><td><time dateTime={p.updatedAt}>{new Date(p.updatedAt).toLocaleDateString()}</time></td></tr>)}
      </tbody></table></div>
      {!state.projects.length&&<div className="projects-empty"><span aria-hidden="true">▱</span><h3>No projects yet.</h3><p>Choose Create project to name your first project.</p><p>You’ll start with an empty workbench. No sample Parts or assemblies.</p></div>}
    </section>
    <details className="projects-recovery"><summary>Import or recover a project</summary><p>Projects are saved in this browser. Import a backup to recover work from another browser.</p><button onClick={()=>void act(go=>recover("piton",go))}>Discover legacy default project</button><label>Legacy import namespace UUID<input id="legacy-namespace"/></label><button onClick={()=>void act(go=>recover(`piton-import-${(globalThis.document.getElementById("legacy-namespace") as HTMLInputElement).value}`,go))}>Recover legacy namespace</button><label>Import custody JSON<input type="file" accept="application/json,.json" onChange={e=>{const file=e.target.files?.[0];if(file)void act(go=>importFile(file,go));}}/></label></details>
    <footer className="projects-footer">Stored on this browser · Review-only · Not released for fabrication</footer></div>
  </main>;
  return <main className="project-workspace"><header><div><span className="eyebrow">PITON · BROWSER-LOCAL CAD</span><h1>{document?.name??project?.name??"Projects"}</h1></div><button onClick={()=>navigate("/projects")}>All projects</button></header>
    <p>Saved in this browser’s SQLite / OPFS storage. No account or cross-device sync. Keep custody backups before clearing browser data.</p>
    <p className="safety">needs_human_review · fabrication_release=false · machine_actuation=false · Review mesh, not exact geometry</p>
    {(error||routeError)&&<p role="alert">{error||routeError}</p>}
    {routeError&&state&&<label>Recover project backup<input type="file" accept="application/json,.json" onChange={e=>{const file=e.target.files?.[0];if(file)void act(go=>importFile(file,go));}}/></label>}
    {state&&!routeError&&route?.projectId&&<p>Local bookmark: <a href={path}>{location.origin}{path}</a> <button onClick={()=>void act(()=>navigator.clipboard.writeText(location.origin+path))}>Copy link</button></p>}
    {!state && <p>Opening local storage…</p>}

  </main>;
}
type WorkbenchTargets = {left:HTMLDivElement;center:HTMLDivElement;commands:HTMLDivElement;right:HTMLDivElement};
type DraftStatus = {dirty:boolean;busy:boolean;preview?:boolean};
function ProjectWorkbench({application,project,document,revisionId,path,navigate,refresh,act,pending,error}:{application: WorkspaceApplication;project: WorkspaceProject;document?:PartDocument;revisionId?:string;path:string;navigate:(url:string)=>void;refresh:()=>Promise<void>;act:(fn:(go:(url:string)=>void)=>Promise<unknown>)=>Promise<void>;pending:boolean;error:string}) {
  // Open tabs are UI state, never authored revisions or stored document membership.
  const [openIds,setOpenIds]=useState<string[]>(()=>document?[document.id]:[]);
  const [label,setLabel]=useState("");
  const [panel,setPanel]=useState<"project"|"change"|null>(null);
  const [tabError,setTabError]=useState("");
  const [leftTarget,setLeftTarget]=useState<HTMLDivElement|null>(null),[centerTarget,setCenterTarget]=useState<HTMLDivElement|null>(null),[commandTarget,setCommandTarget]=useState<HTMLDivElement|null>(null),[rightTarget,setRightTarget]=useState<HTMLDivElement|null>(null);
  const drafts=useRef(new Map<string,DraftStatus>());
  const [draftStatuses,setDraftStatuses]=useState<Record<string,DraftStatus>>({});
  const [selections,setSelections]=useState<Record<string,SelectionReference>>({});
  const reportSelection=useCallback((ref:SelectionReference)=>{setSelections(current=>({...current,[ref.documentId]:ref}));},[]);
  const reportDraft=useCallback((id:string,status:DraftStatus)=>{drafts.current.set(id,status);setDraftStatuses(current=>({...current,[id]:status}));},[]);
  // Empty Part authoring is a project-wide concern: identify the first empty Part
  // so the project-only affordance can target it without an active tab.
  const firstEmptyPart = useMemo(() => project.documents.find(d => d.part.currentRevisionId === null && !isFeaturePart(d.part)), [project.documents]);
  useEffect(()=>{if(document)setOpenIds(ids=>ids.includes(document.id)?ids:[...ids,document.id]);setLabel("");setTabError("");},[document?.id]);
  const ids=document&&!openIds.includes(document.id)?[...openIds,document.id]:openIds;
  const tabs=ids.flatMap(id=>{const d=project.documents.find(d=>d.id===id);return d?[d]:[];});
  const openDocument=(id:string)=>{setOpenIds(ids=>ids.includes(id)?ids:[...ids,id]);setPanel(null);navigate(`/projects/${project.id}/documents/${id}`);};
  const closeDocument=(id:string)=>{
    const draft=drafts.current.get(id);
    if(draft?.busy){setTabError("Wait for this Part’s operation to finish before closing its tab.");return;}
    if(draft?.dirty&&!window.confirm("Discard unsaved changes and close this Part tab? The saved document will not be deleted."))return;
    const index=tabs.findIndex(d=>d.id===id),remaining=tabs.filter(d=>d.id!==id);
    setOpenIds(remaining.map(d=>d.id));drafts.current.delete(id);setTabError("");
    if(document?.id===id){const next=remaining[Math.min(index,remaining.length-1)];navigate(next?`/projects/${project.id}/documents/${next.id}`:`/projects/${project.id}`);
      if(next)globalThis.document.getElementById(`tab-${next.id}`)?.focus();
      else globalThis.document.getElementById(`file-${id}`)?.focus();}
  };
  const targets=leftTarget&&centerTarget&&commandTarget&&rightTarget?{left:leftTarget,center:centerTarget,commands:commandTarget,right:rightTarget}:null;
  return <main className="project-workspace r7-workbench">
    <header className="r7-header"><span className="r7-dot"/><strong>Piton</strong><span className="r7-container-label">Project container</span><h1>{project.name}</h1><span className="r7-execution">Browser local · Project conversation</span><button onClick={()=>navigate("/projects")}>All projects</button></header>
    <div className="r7-workspace">
      <aside className={`r7-left ${panel==="project"?"is-open":""}`} aria-label="Project documents and model"><button className="r7-drawer-close" onClick={()=>setPanel(null)}>Close Project panel</button>
        {tabs.map(d=>d.part.currentRevisionId===null&&<div key={d.id} hidden={document?.id!==d.id}><EmptyPartModelTree document={d} onSelect={reportSelection}/></div>)}
        <h2 className="r7-panel-head">Files · Part / Assembly</h2>
        <section className="r7-section"><h3>Documents</h3><nav aria-label="Project Files" className="r7-files">{project.documents.map(d=><button id={`file-${d.id}`} aria-label={d.name} aria-current={document?.id===d.id?"page":undefined} key={d.id} onClick={()=>openDocument(d.id)}><span className="r7-file-icon" aria-hidden="true">PRT</span>{d.name}</button>)}</nav>
          {!project.documents.length&&<p>No documents yet. This project is empty.</p>}
          {!project.archived&&<form onSubmit={e=>{e.preventDefault();void act(async go=>{const id=await application.createPart(project.id,label);await refresh();go(`/projects/${project.id}/documents/${id}`);});}}><label>{document?"New Part name":"Part name"} <input value={label} onChange={e=>setLabel(e.target.value)} required maxLength={100}/></label><button disabled={pending}>Create Part</button><p>Creates an empty Part. No sample geometry or revisions are added.</p></form>}
          <button disabled title="Assembly authoring is not implemented">New Assembly</button>
        </section>
        <div ref={setLeftTarget}/>
        {(!document || document.part.currentRevisionId===null)&&<><h2 className="r7-panel-head">Outputs · active document</h2><section className="r7-section"><p>{document?"Empty Part — use Export project backup to preserve this document.":"Open a Part to access its outputs."} No exact B-rep or fabrication release.</p><button disabled>Generated source</button><button disabled>Generate STL</button></section>
        {!document&&firstEmptyPart&&<><h2 className="r7-panel-head">Empty Part authoring</h2><section className="r7-section"><p>Submit named features against <strong>{firstEmptyPart.name}</strong> to give this project its first revision.</p><button type="button" className="r7-open-empty-part" data-testid="open-first-empty-part" onClick={()=>openDocument(firstEmptyPart.id)}>Open {firstEmptyPart.name}</button></section></>}
        {!document&&!firstEmptyPart&&<><h2 className="r7-panel-head">Model tree</h2><section className="r7-section"><p>No active document. Open or create a Part to inspect its model.</p></section></>}</>}
        <details className="r7-section"><summary>Project settings &amp; recovery</summary><form onSubmit={e=>{e.preventDefault();void act(()=>application.renameProject(project.id,label));}}><label>Project name <input value={label} placeholder={project.name} onChange={e=>setLabel(e.target.value)} required maxLength={100}/></label><button disabled={pending}>Rename project</button></form>
          <button disabled={pending} onClick={()=>void act(()=>application.archiveProject(project.id,!project.archived))}>{project.archived?"Restore project":"Archive project"}</button>
          <button disabled={pending} onClick={()=>void act(async()=>downloadPartFile(`${project.id}-project.json`,JSON.stringify(await application.exportProject(project.id),null,2),"application/json"))}>Export project backup</button>
          <p>Local bookmark: <a href={path}>{location.origin}{path}</a></p><button onClick={()=>void act(()=>navigator.clipboard.writeText(location.origin+path))}>Copy link</button><p>Saved in this browser’s SQLite / OPFS storage. No account or cross-device sync. Keep custody backups before clearing browser data.</p>
        </details>
      </aside>
      <section className="r7-center" aria-label="CAD workbench">
        <div className="r7-tabstrip"><div className="r7-tabs" role="tablist" aria-label="Open documents">{tabs.map((d,index)=><button key={d.id} id={`tab-${d.id}`} role="tab" aria-selected={document?.id===d.id} aria-controls={`panel-${project.id}`} aria-keyshortcuts="Delete" tabIndex={document?.id===d.id || (!document&&index===0)?0:-1} onClick={()=>openDocument(d.id)} onKeyDown={e=>{
          if(e.key==="Delete"){e.preventDefault();closeDocument(d.id);return;}
          if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;
          e.preventDefault();const next=e.key==="Home"?0:e.key==="End"?tabs.length-1:(index+(e.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
          openDocument(tabs[next].id);globalThis.document.getElementById(`tab-${tabs[next].id}`)?.focus();
        }}>{d.name}</button>)}</div>{!tabs.length&&<span>No open document</span>}
        {document&&<button className="r7-close-tab" aria-label={`Close ${document.name}`} onClick={()=>closeDocument(document.id)}>×</button>}</div>
        <div className="r7-document-panel" id={`panel-${project.id}`} role={document?"tabpanel":undefined} aria-labelledby={document?`tab-${document.id}`:undefined} tabIndex={document?0:undefined}>
          <div className="r7-mobile-tools"><button className="r7-drawer-toggle" aria-expanded={panel==="project"} onClick={()=>setPanel(panel==="project"?null:"project")}>☰ Project</button><button className="r7-drawer-toggle" aria-expanded={panel==="change"} onClick={()=>setPanel(panel==="change"?null:"change")}>Change Request</button></div>
          <div className="r7-command-slot" data-testid="workbench-command-slot" ref={setCommandTarget}/>
          <div className="r7-editor-target" data-testid="workbench-viewport-body" ref={setCenterTarget}>
            {!document&&<EmptyProjectViewport empty={!project.documents.length}/>}
          </div>
        </div>{(error||tabError)&&<p className="r7-error" role="alert">{error||tabError}</p>}
      </section>
      <aside className={`r7-right ${panel==="change"?"is-open":""}`} aria-label="Change request"><button className="r7-drawer-close" onClick={()=>setPanel(null)}>Close Change Request</button><h2 className="r7-panel-head">Change Request</h2><ConversationPanel project={project} documentId={document?.id} revisionId={revisionId} selection={document&&selections[document.id]?[selections[document.id]]:[]} draft={!revisionId&&!!(document&&draftStatuses[document.id]?.dirty)} preview={!revisionId&&!!(document&&draftStatuses[document.id]?.preview)}/><div ref={setRightTarget}/></aside>
      {targets&&tabs.map(d=>isAuthoredPart(d.part)?<PartEditor key={d.id} application={application} projectId={project.id} document={{...d,part:d.part}} archived={project.archived} refresh={refresh} navigate={navigate} active={document?.id===d.id&&!revisionId} targets={targets} reportDraft={reportDraft}/>:null)}
      {targets&&document&&isAuthoredPart(document.part)&&revisionId&&<PartEditor key={`${document.id}:${revisionId}`} application={application} projectId={project.id} document={{...document,part:document.part}} revisionId={revisionId} archived={project.archived} refresh={refresh} navigate={navigate} active targets={targets}/>}
      {targets&&tabs.filter(d=>d.part.currentRevisionId===null||isFeaturePart(d.part)).map(d=><EmptyFeatureAuthoring key={`features-${d.id}`} active={document?.id===d.id} application={application} projectId={project.id} part={d} refresh={refresh} pending={pending} archived={project.archived} revisionId={document?.id===d.id?revisionId:undefined} navigate={navigate} targets={targets} reportDraft={reportDraft} openProperties={()=>setPanel("change")}/>)}
    </div><footer className="r7-status"><span>{project.archived?"Archived project · read-only":"Browser-local project"} · {project.documents.length} Parts</span><span>needs_human_review · fabrication_release=false · machine_actuation=false</span></footer>
  </main>;
}
type EmptyTreeNode = {id:string;label:string;detail:string;children?:EmptyTreeNode[]};
function EmptyPartModelTree({document,onSelect}:{document:PartDocument;onSelect:(ref:SelectionReference)=>void}) {
  // R14 documentTree / initialExpandedTreeNodeIds: root open, Origin collapsed.
  // These reference axes are UI context, never authored datum records or revisions.
  const [expanded,setExpanded]=useState<string[]>(["document"]);
  const [selected,setSelected]=useState("document"),[focused,setFocused]=useState("document");
  const rows=useRef(new Map<string,HTMLDivElement>());
  useEffect(()=>{onSelect({documentId:document.id,revisionId:null,nodeId:selected,label:`${document.name} · ${selected}`,representation:["origin","front","top","right"].includes(selected)?"coordinate-reference":"document-summary"});},[document.id,document.name,selected,onSelect]);
  const nodes:EmptyTreeNode[]=[{id:"document",label:`${document.name} · Part`,detail:"Empty Part document. No authored geometry, parameters or revisions.",children:[
    {id:"origin",label:"Origin · reference",detail:"CAD origin (0, 0, 0) mm. Coordinate reference only; not an authored feature.",children:[
      {id:"front",label:"Front Plane · reference",detail:"CAD XZ plane (Y=0). Coordinate reference only; not an authored feature."},
      {id:"top",label:"Top Plane · reference",detail:"CAD XY plane (Z=0), the physical grid plane. Coordinate reference only; not an authored feature."},
      {id:"right",label:"Right Plane · reference",detail:"CAD YZ plane (X=0). Coordinate reference only; not an authored feature."}]},
    {id:"features",label:"Features (0)",detail:"No authored features yet. Use named-feature source to preview a bounded profile, extrusion and hole."},
    {id:"bodies",label:"Solid Bodies (0)",detail:"No solid bodies. This Part has no authored geometry or review mesh."}]}];
  const visible:EmptyTreeNode[]=[],all=new Map<string,EmptyTreeNode>(),parents=new Map<string,string>();
  const collect=(list:EmptyTreeNode[],parent?:string,shown=true)=>{for(const node of list){all.set(node.id,node);if(parent)parents.set(node.id,parent);if(shown)visible.push(node);if(node.children)collect(node.children,node.id,shown&&expanded.includes(node.id));}};
  collect(nodes);
  const focus=(id:string)=>{setFocused(id);rows.current.get(id)?.focus();};
  const toggle=(id:string)=>setExpanded(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);
  const renderNodes=(list:EmptyTreeNode[]):ReactNode=>list.map(node=><div key={node.id} onClick={event=>{event.stopPropagation();focus(node.id);setSelected(node.id);}} role="treeitem" aria-label={node.label} aria-selected={selected===node.id} aria-expanded={node.children?expanded.includes(node.id):undefined} tabIndex={focused===node.id?0:-1} ref={element=>{if(element)rows.current.set(node.id,element);else rows.current.delete(node.id);}} onFocus={event=>{event.stopPropagation();setFocused(node.id);}} onKeyDown={event=>{
    event.stopPropagation();const index=visible.findIndex(row=>row.id===node.id);
    if(!["ArrowDown","ArrowUp","ArrowLeft","ArrowRight","Home","End","Enter"," "].includes(event.key))return;
    event.preventDefault();
    if(event.key==="ArrowDown"||event.key==="ArrowUp")focus(visible[Math.max(0,Math.min(visible.length-1,index+(event.key==="ArrowDown"?1:-1)))].id);
    else if(event.key==="Home"||event.key==="End")focus(visible[event.key==="Home"?0:visible.length-1].id);
    else if(event.key==="ArrowRight"&&node.children){if(!expanded.includes(node.id))toggle(node.id);else focus(node.children[0].id);}
    else if(event.key==="ArrowLeft"){if(node.children&&expanded.includes(node.id))toggle(node.id);else if(parents.has(node.id))focus(parents.get(node.id)!);}
    else if(event.key==="Enter"||event.key===" ")setSelected(node.id);
  }}><div className="r7-tree-row"><span className="r7-tree-disclosure" aria-hidden="true" onClick={event=>{if(node.children){event.stopPropagation();focus(node.id);toggle(node.id);}}}>{node.children?(expanded.includes(node.id)?"▾":"▸"):"·"}</span><span>{node.label}</span></div>{node.children&&expanded.includes(node.id)&&<div role="group">{renderNodes(node.children)}</div>}</div>);
  return <section className="r7-model-tree"><h2 className="r7-panel-head">Model tree</h2><div role="tree" aria-label={`${document.name} model tree`}>{renderNodes(nodes)}</div><section className="r7-tree-details" aria-label="Model selection details"><h3>{document.name} · {all.get(selected)?.label}</h3><p>{all.get(selected)?.detail}</p></section></section>;
}
function EmptyProjectViewport({empty,partName}:{empty:boolean;partName?:string}) {
  const host=useRef<HTMLDivElement>(null);
  const command=useRef<(view:string)=>void>(()=>{});
  const [available,setAvailable]=useState(false);
  const [failure,setFailure]=useState("");
  useEffect(()=>{
    let disposed=false, cleanup=()=>{};
    void (async()=>{
      // No document, geometry worker or authored revision is created here.
      if(!window.WebGLRenderingContext) {setFailure("3D viewport unavailable in this browser.");return;}
      try {
        const THREE=await import("three");
        const {OrbitControls}=await import("three/addons/controls/OrbitControls.js");
        if(disposed||!host.current)return;
        const element=host.current, scene=new THREE.Scene();
        const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
        renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
        element.appendChild(renderer.domElement);
        const camera=new THREE.PerspectiveCamera(40,1,.1,2000);
        const controls=new OrbitControls(camera,renderer.domElement);
        // CAD Z=0 maps to Three.js Y=0, matching the existing Part viewport.
        const grid=new THREE.GridHelper(240,24,0x42647d,0x243c4e);
        scene.add(grid);
        const render=()=>renderer.render(scene,camera);
        const view=(name:string)=>{
          if(name.includes("Roll")) {
            const axis=new THREE.Vector3();camera.getWorldDirection(axis);
            camera.up.applyAxisAngle(axis,(name.startsWith("↶")?-1:1)*Math.PI/12);
          } else {
            controls.target.set(0,0,0);camera.up.set(0,1,0);
            if(name==="Front")camera.position.set(0,0,280);
            else if(name==="Top"){camera.position.set(0,280,0);camera.up.set(0,0,-1);}
            else camera.position.set(180,150,200);
          }
          camera.lookAt(controls.target);controls.update();render();
        };
        const resize=()=>{const width=element.clientWidth,height=element.clientHeight;if(!width||!height)return;camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);render();};
        const observer=new ResizeObserver(resize);observer.observe(element);
        controls.addEventListener("change",render);command.current=view;resize();view("Iso");setAvailable(true);
        cleanup=()=>{observer.disconnect();controls.dispose();grid.geometry.dispose();(grid.material as import("three").Material).dispose();renderer.dispose();renderer.domElement.remove();command.current=()=>{};};
      }catch(e){if(!disposed)setFailure(`3D viewport unavailable: ${e instanceof Error?e.message:String(e)}`);}
    })();
    return()=>{disposed=true;cleanup();};
  },[]);
  return <><div className="r7-toolbar" aria-label="View controls">{["Iso","Front","Top","Fit"].map(name=><button key={name} disabled={!available} onClick={()=>command.current(name)}>{name}</button>)}<button disabled title="Open a document with review geometry to measure">Measure</button><button disabled>Clear measurement</button>{["↶ Roll","Roll ↷"].map(name=><button key={name} disabled={!available} onClick={()=>command.current(name)}>{name}</button>)}</div>
    <div className="r7-empty-viewport" data-testid="empty-project-viewport" aria-label="Empty CAD viewport"><div className="r7-three" ref={host}/><div className="r7-empty-message"><strong>{partName?"Empty Part":empty?"Empty project":"No open document"}</strong><p>{partName?`${partName} has no authored geometry or revisions. Use named-feature source to preview a Part.`:empty?"Create a Part from the project panel to begin.":"Open a document from the project panel to continue."}</p>{failure&&<p role="status">{failure}</p>}</div><div className="r7-axis">CAD Z ↑<br/><span>grid = physical CAD Z=0 · mm</span></div></div>
  </>;
}
function PartEditor({application,projectId,document,revisionId,archived,refresh,navigate,active,targets,reportDraft}:{application:WorkspaceApplication;projectId:string;document:PartDocument & {part:BrowserProject};revisionId?:string;archived:boolean;refresh:()=>Promise<void>;navigate:(url:string)=>void;active:boolean;targets:WorkbenchTargets;reportDraft?:(id:string,status:DraftStatus)=>void}) {
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
  useEffect(()=>{reportDraft?.(document.id,{dirty,busy,preview:!!preview});},[document.id,dirty,busy,!!preview,reportDraft]);
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
  return <>
    {active&&createPortal(<div>    <h2 className="r7-panel-head">FeatureManager · Model</h2><section className="r7-section"><h3>{document.name}</h3><nav><button onClick={()=>navigate(`/projects/${projectId}`)}>Project overview</button>{readonly&&<button onClick={()=>navigate(url)}>Open current revision</button>}</nav><p>{readonly?"Historical / archived document — read-only":"Editable Part · L-bracket"}</p><h2>Parameters (mm)</h2>
    {blocked&&<p role="alert">Document changed outside this draft. Reload the latest revision before authoring; your unsaved draft has been preserved.</p>}{blocked&&<button disabled={busy} onClick={reload}>Reload latest revision</button>}
    <fieldset disabled={readonly || busy || blocked}>{Object.entries(parameters).map(([key,value])=><label key={key}>{key}<input aria-label={key} type="number" step="0.1" value={Number.isFinite(value) ? value : ""} onChange={e=>{proposalGeneration.current += 1;setParameters({...parameters,[key]:e.target.valueAsNumber});setPreview(null);setReady(false);}}/></label>)}
      <button onClick={()=>void run(()=>propose(proposal()))}>Propose and preview</button><button disabled={!preview||!ready||mesh?.sourceRevisionId!==preview.candidate.id} onClick={()=>void run(async()=>{if(blocked||readonly||!preview||!ready||mesh?.sourceRevisionId!==preview.candidate.id)return;ownCommit.current=preview.candidate.id;try {await application.commit(preview.proposal);if(!mounted.current)return;await refresh();if(mounted.current)setMessage("Revision committed; engineering approval not granted.");} catch(e) {ownCommit.current=null;throw e;}})}>Commit revision</button>
      {preview && <section aria-label="Proposed parameter changes"><h2>Preview only · not committed</h2><ul>{Object.entries(preview.proposal.parameters).filter(([key, value]) => value !== revision.parameters[key as keyof LBracketParameters]).map(([key, value]) => <li key={key}>{key}: {revision.parameters[key as keyof LBracketParameters]} → {value} mm</li>)}</ul><button onClick={() => {proposalGeneration.current += 1;setPreview(null);setParameters({...revision.parameters});setReady(false);}}>Discard preview</button></section>}
    </fieldset><fieldset disabled={readonly||busy||blocked}>      <label>Part name<input value={newName} onChange={e=>setNewName(e.target.value)}/></label><button onClick={()=>void run(async()=>{if(blocked||readonly)return;await application.renamePart(projectId,document.id,newName);if(!mounted.current)return;setBase(previous=>({...previous,name:newName}));await refresh();})}>Rename Part</button>
</fieldset></section>
    <h2 className="r7-panel-head">Outputs · active document</h2><section className="r7-section"><button disabled={!!revisionId} onClick={()=>void run(async()=>downloadPartFile(`${document.id}-custody.json`,JSON.stringify(await application.exportPart(projectId,document.id),null,2),"application/json"))}>Export Part custody</button><button disabled={!mesh||mesh.sourceRevisionId!==shown.id} onClick={()=>void run(async()=>downloadPartFile(`${document.id}-review-unreleased.stl`,reviewPartStl(mesh!,shown.id),"model/stl"))}>Download Part review STL (unreleased)</button><p role="status">{message}</p></section><section className="r7-section"><h2>Revision history</h2>{Object.entries(document.revisionIds).reverse().map(([id,content],index)=><button key={id} onClick={()=>navigate(`${url}/revisions/${id}`)}>Revision {document.part.revisions.length-index}{content===document.part.currentRevisionId?" · current":""}</button>)}
    </section></div>,targets.left)}
    {active&&createPortal(<div><section className="r7-section"><h3>Selected context</h3><p>Active Part and base revision are attached to local parameter proposals. Geometry selection is not connected to an agent.</p><button disabled>Attach selection to agent context</button><h3>Exact attached payload</h3><pre className="r7-context">{JSON.stringify({projectId,documentId:document.id,expectedRevisionId:Object.keys(document.revisionIds).find(id=>document.revisionIds[id]===base.revision.id)},null,2)}</pre></section><section className="r7-section"><fieldset disabled={readonly||busy||blocked}>      <h2>Structured change request</h2><p>Local typed proposal, no LLM backend. Supply the six parameter values as JSON; project, document and base revision are attached automatically.</p><textarea aria-label="Structured change request" value={json} onChange={e=>{proposalGeneration.current+=1;setJson(e.target.value);setPreview(null);setReady(false);}} placeholder={JSON.stringify(parameters,null,2)}/><button onClick={()=>void run(async()=>{setPreview(null);setReady(false);await propose({...proposal(),parameters:JSON.parse(json)});})}>Prepare change proposal</button>
</fieldset><p>Manual proposal only. {preview?"Prepared locally · preview only, not sent.":"Not prepared or sent."}</p></section></div>,targets.right)}
    {active&&createPortal(<section className="r7-authored-viewport" data-document-id={document.id} data-revision-id={shown.id}><Viewport onReviewMesh={setMesh} parameters={shown.parameters} authoritativeBase={shown} onBuildStatus={status=>setReady(status.state==="ready")} /></section>
,targets.center)}
  </>;
}
/** Canonical bounded source text — kept in sync with src/modeling/source.ts HEADER
 * so users see the exact wire format the application enforces. */
const EMPTY_FEATURE_SOURCE_PLACEHOLDER =
  '// Piton browser-typescript/v1; units=mm; restricted named-feature source\n' +
  'part.rectangle({"id":"outline","name":"Plate outline","plane":"XY","width":80,"height":50});\n' +
  'part.extrude({"id":"plate","name":"Plate thickness","profileId":"outline","distance":6});\n' +
  'part.hole({"id":"mount-1","name":"Mounting hole 1","bodyId":"plate","x":15,"y":15,"diameter":5,"extent":"through"});\n';
/** Both first-feature and subsequent source edits cross the same preview gate. */
function EmptyFeatureAuthoring({active,application,projectId,part,refresh,pending,archived,revisionId,navigate,targets,reportDraft,openProperties}:{
  active:boolean;
  application: WorkspaceApplication;
  projectId: string;
  part?: PartDocument;
  refresh: () => Promise<void>;
  pending:boolean;
  archived?:boolean;
  revisionId?:string;
  navigate?:(url:string)=>void;
  targets?:WorkbenchTargets;
  reportDraft?:(id:string,status:DraftStatus)=>void;
  openProperties:()=>void;
}) {
  const current = part && isFeaturePart(part.part) ? part.part.revisions.find(r=>r.id===part.part.currentRevisionId) : undefined;
  const shown = part && isFeaturePart(part.part) && revisionId ? part.part.revisions.find(r=>r.id===part.revisionIds[revisionId]) : current;
  const [source,setSource]=useState(current?.authored.source ?? EMPTY_FEATURE_SOURCE_PLACEHOLDER);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [preview,setPreview]=useState<Awaited<ReturnType<WorkspaceApplication["proposeFeatures"]>>|null>(null);
  const [geometry,setGeometry]=useState<{mesh:FeatureEvaluation;scope:string}|null>(null);
  const [measurement,setMeasurement]=useState<{scope:string;value:FixtureReviewMeasurement}|null>(null);
  const [message,setMessage]=useState("");
  const [sketchDirty,setSketchDirty]=useState(false);
  const [sketchVisible,setSketchVisible]=useState(false);
  const [draftBase,setDraftBase]=useState<string|null>(()=>part&&isFeaturePart(part.part)?Object.keys(part.revisionIds).find(id=>part.revisionIds[id]===part.part.currentRevisionId)??null:null);
  const [conflict,setConflict]=useState(false);
  const [sketchReset,setSketchReset]=useState(0);
  const generation=useRef(0), geometryGeneration=useRef(0), mounted=useRef(false), operation=useRef(false);
  const readonly=!!archived||!!revisionId;
  const currentPointer=part&&current?Object.keys(part.revisionIds).find(id=>part.revisionIds[id]===current.id):null;
  const draftDirty=sketchDirty||!!preview||source!==(current?.authored.source??EMPTY_FEATURE_SOURCE_PLACEHOLDER);
  const blocked=conflict||draftBase!==(currentPointer??null);
  const reload=()=>{
    generation.current++;geometryGeneration.current++;
    if(preview)application.cancelFeatureProposal(preview.proposal);
    setPreview(null);setGeometry(null);setMeasurement(null);
    setSource(current?.authored.source??EMPTY_FEATURE_SOURCE_PLACEHOLDER);
    setDraftBase(currentPointer??null);setConflict(false);setSketchReset(value=>value+1);
    setSketchDirty(false);setError("");setMessage("");
  };
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;geometryGeneration.current++;};},[]);
  useEffect(()=>{if(!active)setMeasurement(null);},[active]);
  useEffect(()=>{
    if(!shown)return;
    const token=++geometryGeneration.current;
    setGeometry(null);
    if(!revisionId&&preview&&draftBase===(currentPointer??null)) {
      setGeometry({mesh:preview.geometry,scope:preview.candidate.id});
      return;
    }
    void evaluateFeatureSourceInWorker(shown.authored).then(result=>{if(mounted.current&&token===geometryGeneration.current)setGeometry({mesh:result,scope:shown.id});}).catch(e=>{if(mounted.current&&token===geometryGeneration.current)setError(e instanceof Error?e.message:"Review mesh unavailable");});
  },[shown?.id,revisionId]);
  const previousCurrent=useRef(current?.authored.source??EMPTY_FEATURE_SOURCE_PLACEHOLDER);
  useEffect(()=>{
    if(draftBase===(currentPointer??null))return;
    if(sketchDirty||preview||source!==previousCurrent.current) {
      generation.current++;
      if(preview)application.cancelFeatureProposal(preview.proposal);
      setPreview(null);setGeometry(null);setMeasurement(null);setConflict(true);
    } else {
      setDraftBase(currentPointer??null);
      setSource(current?.authored.source??EMPTY_FEATURE_SOURCE_PLACEHOLDER);
    }
    previousCurrent.current=current?.authored.source??EMPTY_FEATURE_SOURCE_PLACEHOLDER;
  },[currentPointer]);
  useEffect(()=>{if(part)reportDraft?.(part.id,{dirty:draftDirty,busy,preview:!!preview&&!blocked});},[part?.id,draftDirty,busy,preview,blocked,reportDraft]);
  if (!part) return null;
  const visiblePreview=!revisionId&&!blocked?preview:null;
  const scope=visiblePreview?.candidate.id??shown?.id??"";
  const admitted=active&&!!geometry&&geometry.scope===scope;
  const currentMeasurement=admitted&&measurement?.scope===scope?measurement.value:{phase:"idle"} as FixtureReviewMeasurement;
  const measure=()=>{if(admitted)setMeasurement({scope,value:{phase:"armed"}});};
  const clearMeasurement=()=>setMeasurement(null);
  const point=(point:FixtureReviewPoint)=>{
    if(!admitted||!point.every(Number.isFinite))return;
    setMeasurement(previous=>{
      if(previous?.scope!==scope)return previous;
      const value=previous.value;
      if(value.phase==="armed")return {scope,value:{phase:"endpoint-a",endpointA:point,hoverEndpoint:null}};
      if(value.phase==="endpoint-a"&&value.endpointA)return {scope,value:{phase:"complete",endpointA:value.endpointA,endpointB:point}};
      return previous;
    });
  };
  const hover=(point:FixtureReviewPoint|null)=>setMeasurement(previous=>previous?.scope===scope&&previous.value.phase==="endpoint-a"?{scope,value:{...previous.value,hoverEndpoint:point}}:previous);
  const invalidate=()=>{generation.current++;geometryGeneration.current++;if(preview)application.cancelFeatureProposal(preview.proposal);setPreview(null);setGeometry(null);setMeasurement(null);};
  const submit=async()=>{
    if(operation.current||readonly||pending||blocked)return;
    invalidate();
    const token=++generation.current;
    operation.current=true;setBusy(true);setError("");setMessage("");
    try {
      const features=parseFeatureSource(source);
      if (!features.length) throw new Error("No named features parsed from source. Use part.rectangle / circle / extrude / hole calls.");
      const proposal:FeatureProposal={projectId,documentId:part.id,expectedRevisionId:draftBase,idempotencyKey:crypto.randomUUID(),units:"mm",features,...(current?{operation:"replace" as const}:{})};
      const result=await application.proposeFeatures(proposal);
      if(mounted.current&&token===generation.current){setPreview(result);setGeometry({mesh:result.geometry,scope:result.candidate.id});setMessage("Preview only · not committed. Inspect the review mesh, then explicitly commit.");}
      else application.cancelFeatureProposal(result.proposal);
    }catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Preview failed");}
    finally{operation.current=false;if(mounted.current)setBusy(false);}
  };
  const commit=async()=>{
    if(!preview||operation.current||readonly||pending||blocked)return;
    operation.current=true;setBusy(true);setError("");
    try {const id=await application.commitFeatures(preview.proposal);if(!mounted.current)return;setDraftBase(id);setSource(preview.candidate.authored.source);previousCurrent.current=preview.candidate.authored.source;setPreview(null);setGeometry(null);setMeasurement(null);setMessage(`Revision committed: ${id} · engineering approval not granted.`);await refresh();}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Commit failed");}
    finally{operation.current=false;if(mounted.current)setBusy(false);}
  };
  return <>
    {active&&createPortal(<section className="r7-empty-authoring" data-testid="empty-feature-authoring" aria-label="Part source and revision">
      <h2 className="r7-panel-head">{revisionId?"Historical revision":current?"Current Part":"New Part draft"}</h2>
      <p className="r7-section-help">{part.name} · browser-typescript/v1 · mm · review mesh only. {revisionId?"Read-only historical source.":"Source is authored only on explicit commit."}</p>
      {current&&<nav aria-label="Feature revision history">{part.part.revisions.map((revision,index)=>{const pointer=Object.keys(part.revisionIds).find(id=>part.revisionIds[id]===revision.id);return <button key={revision.id} onClick={()=>navigate?.(`/projects/${projectId}/documents/${part.id}/revisions/${pointer}`)}>Revision {index+1}</button>;})}{revisionId&&<button onClick={()=>navigate?.(`/projects/${projectId}/documents/${part.id}`)}>Open current revision</button>}</nav>}
      {!revisionId&&blocked&&<><p role="alert">Part changed since this draft began. Local draft preserved; reload the latest revision or reconcile before preview or commit.</p><button type="button" disabled={busy} onClick={reload}>Reload latest revision</button></>}
      <details className="r7-advanced-source"><summary>Advanced · {revisionId?"historical source":current?"current source and draft":"example recipe and draft source"}</summary>
        {!current&&<p>Example recipe only; edit before preview. No example geometry is saved automatically.</p>}
        <label className="r7-feature-source-label">Named feature source<textarea aria-label="Named feature source" data-testid="feature-source-input" value={revisionId?shown?.authored.source??source:source} onChange={e=>{invalidate();setSource(e.target.value);}} disabled={busy||readonly||blocked} spellCheck={false} /></label>
        <div className="r7-feature-source-actions"><button type="button" data-testid="submit-first-feature" disabled={busy||readonly||blocked||!source.trim()||pending} onClick={()=>void submit()}>{busy?"Evaluating…":"Preview source draft"}</button>
          <button type="button" disabled={busy||readonly} onClick={reload}>Discard draft</button></div>
      </details>
      {visiblePreview&&<section data-testid="feature-preview"><strong>Preview only · not committed</strong><p>{visiblePreview.candidate.id} · {visiblePreview.geometry.triangles.length/3} triangles · {visiblePreview.geometry.volumeMm3.toFixed(2)} mm³</p></section>}
      {!revisionId&&message&&<p role="status" data-testid="empty-feature-message">{message}</p>}{error&&<p role="alert" data-testid="empty-feature-error">{error}</p>}
    </section>,targets?.right??globalThis.document.querySelector(".r7-right")??globalThis.document.body)}
    {targets&&createPortal(<div hidden={!active}><PartCommandUI active={active} context={{projectId,documentId:part.id,revisionId:draftBase}} baseSource={revisionId?shown?.authored??emptyFeatureSource():current?.authored??emptyFeatureSource()} source={revisionId?shown?.authored.source??source:!current&&source===EMPTY_FEATURE_SOURCE_PLACEHOLDER?emptyFeatureSource().source:source} onSource={next=>{invalidate();setSource(next);}} readonly={readonly||blocked} busy={busy||pending} previewReady={!!visiblePreview} onPreview={()=>void submit()} onCommit={()=>void commit()} onSketchDirty={setSketchDirty} onSketchVisible={setSketchVisible} onOpenProperties={openProperties} propertyTarget={targets.right} viewportTarget={targets.center} resetToken={sketchReset} measureAvailable={admitted} measurement={currentMeasurement} onMeasure={measure} onClearMeasurement={clearMeasurement}/></div>,targets.commands)}
    {active&&current&&targets&&createPortal(<section className="r7-section" aria-label="Named feature tree"><h2>Model tree</h2><p>{readFeatures(shown?.authored??current.authored).length} named features · 1 review body</p><ul>{readFeatures(shown?.authored??current.authored).map(f=><li key={f.id}>{f.name} · {f.kind}</li>)}</ul></section>,targets.left)}
    {active&&!sketchVisible&&admitted&&geometry&&targets&&createPortal(<FeatureMeshViewport key={scope} geometry={geometry.mesh} revisionId={scope} measurement={currentMeasurement} onMeasurementPoint={point} onMeasurementHover={hover} onMeasurementCancel={clearMeasurement}/>,targets.center)}
    {active&&!sketchVisible&&!admitted&&targets&&createPortal(<EmptyProjectViewport empty={false} partName={part.name}/>,targets.center)}
  </>;
}
/** Never drop invalid lines: parse through the same strict canonical source reader. */
function parseFeatureSource(text: string): PartFeature[] {
  return [...readFeatures({authorityProfile:"browser-typescript/v1",units:"mm",source:text})];
}
