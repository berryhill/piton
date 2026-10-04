import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { appendFeatures, emptyFeatureSource, readFeatures, type PartFeature, type FeatureSource } from "./source";
import { reduceSketchDraft, sketchPreview, sketchSource, type SketchContext, type SketchDraft } from "./sketchDraft";
import type { FixtureReviewMeasurement } from "../fixture";

type FeatureTool = "Extrude" | "Revolve" | "Hole" | "Linear Pattern" | "Fillet" | "Chamfer";
type SketchTool = "Line" | "Rectangle" | "Circle" | "Dimension";
const features: FeatureTool[] = ["Extrude", "Revolve", "Hole", "Linear Pattern", "Fillet", "Chamfer"];
const sketches: SketchTool[] = ["Line", "Rectangle", "Circle", "Dimension"];
const defaults: Record<string, number> = { width: 80, height: 50, diameter: 20, x: 15, y: 15, distance: 6, radius: 2, count: 2, spacingX: 15, spacingY: 0, vertexX: 0, vertexY: 0 };
const categories = ["Sketch", "Features", "Inspect"] as const;

/** Transient document-local controls; only canonical source crosses the application gate. */
export function PartCommandUI({active=true,context,baseSource,source,onSource,readonly,busy,previewReady,onPreview,onCommit,onSketchDirty,onSketchVisible,onOpenProperties,propertyTarget,viewportTarget,resetToken,measureAvailable=false,measurement={phase:"idle"},onMeasure,onClearMeasurement}:{
  active?:boolean;
  context:SketchContext; baseSource:FeatureSource; source:string; onSource:(source:string)=>void;
  readonly:boolean;busy:boolean;previewReady:boolean;onPreview:()=>void;onCommit:()=>void;onSketchDirty:(dirty:boolean)=>void;
  onSketchVisible?:(visible:boolean)=>void;onOpenProperties?:()=>void;propertyTarget?:HTMLElement;viewportTarget?:HTMLElement;
  resetToken?:number;
  measureAvailable?:boolean;measurement?:FixtureReviewMeasurement;onMeasure?:()=>void;onClearMeasurement?:()=>void;
}) {
  const [category,setCategory]=useState<"Sketch"|"Features"|"Inspect">("Sketch");
  const [sketch,setSketch]=useState<SketchDraft|null>(null);
  const [tool,setTool]=useState<SketchTool|FeatureTool|null>(null);
  const [values,setValues]=useState<Record<string,number>>(defaults);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [points,setPoints]=useState("");
  const [plane,setPlane]=useState("");
  const tabId=useId();
  const tabs=useRef<Partial<Record<typeof categories[number],HTMLButtonElement|null>>>({});
  useEffect(()=>{onSketchDirty(!!sketch);},[sketch,onSketchDirty]);
  useEffect(()=>{if(resetToken===undefined)return;setSketch(null);setTool(null);setError("");setNotice("");},[resetToken]);
  const stale=!!sketch && (sketch.context.projectId!==context.projectId || sketch.context.documentId!==context.documentId || sketch.context.revisionId!==context.revisionId);
  const effective=source===baseSource.source?baseSource:{...baseSource,source};
  let parsed:readonly PartFeature[]=[];
  try { parsed=readFeatures(effective); } catch { /* Advanced source is invalid; command actions disclose this below. */ }
  const profile=parsed.find(f=>f.kind==="rectangle"||f.kind==="circle"||f.kind==="polygon");
  const body=parsed.find(f=>f.kind==="extrude"||f.kind==="revolve");
  const hole=parsed.find(f=>f.kind==="hole");
  const finished=parsed.some(f=>f.kind==="fillet"||f.kind==="chamfer");
  const update=(next:SketchDraft|null)=>{setSketch(next);setError("");setNotice("");};
  const attempt=(fn:()=>void)=>{try {setError("");fn();} catch(e){setError(e instanceof Error?e.message:String(e));}};
  const choose=(name:SketchTool|FeatureTool)=>{
    const profile=sketch?.profile;
    setPoints(profile?.kind==="polygon"?"0":"");
    setTool(name);
    setValues(name==="Dimension"&&profile?{
      ...defaults,
      ...(profile.kind==="rectangle"?{width:profile.width,height:profile.height}:profile.kind==="circle"?{diameter:profile.diameter}:{vertexX:profile.vertices[0][0],vertexY:profile.vertices[0][1]}),
    }:{...defaults});
    setError("");setNotice("");
    onOpenProperties?.();
  };
  const n=(key:string)=>values[key];
  const addFeature=(name:FeatureTool)=>{
    if(stale) throw new Error("Stale sketch context; cancel or reopen against the current revision");
    const sourceBase=sketch?.status==="finished" ? appendFeatures(baseSource,readFeatures(sketchSource(sketch,context))) : effective;
    const existing=readFeatures(sourceBase);
    const p=existing.find(f=>f.kind==="rectangle"||f.kind==="circle"||f.kind==="polygon");
    const b=existing.find(f=>f.kind==="extrude"||f.kind==="revolve");
    const h=existing.find(f=>f.kind==="hole");
    const id=(prefix:string)=>{const used=new Set(existing.map(f=>f.id));let index=1;while(used.has(`${prefix}${index}`))index++;return `${prefix}${index}`;};
    let feature:PartFeature;
    if(name==="Extrude" || name==="Revolve") {
      if(!p||b) throw new Error("Finish one sketch profile before creating its single body");
      feature=name==="Extrude"?{kind:"extrude",id:id("extrude"),name:"Extrusion",profileId:p.id,distance:n("distance")}
        :{kind:"revolve",id:id("revolve"),name:"Full revolve",profileId:p.id,axis:"Z",angleDegrees:360};
    } else if(name==="Hole") {
      if(!b||b.kind!=="extrude"||p?.kind==="polygon") throw new Error("Hole requires an extruded rectangle or circle");
      feature={kind:"hole",id:id("hole"),name:"Through hole",bodyId:b.id,x:n("x"),y:n("y"),diameter:n("diameter"),extent:"through"};
    } else if(name==="Linear Pattern") {
      if(!b||!h) throw new Error("Linear Pattern requires a preceding through-hole on an extruded body");
      feature={kind:"linearPattern",id:id("pattern"),name:"Hole pattern",bodyId:b.id,sourceHoleId:h.id,count:n("count"),spacingX:n("spacingX"),spacingY:n("spacingY")};
    } else {
      if(!b||b.kind!=="extrude"||p?.kind!=="rectangle") throw new Error(`${name} requires a rectangular extruded plate`);
      feature=name==="Fillet"?{kind:"fillet",id:id("fillet"),name:"Outer corner fillet",bodyId:b.id,edgeSet:"verticalOuterPerimeter",radius:n("radius")}
        :{kind:"chamfer",id:id("chamfer"),name:"Outer corner chamfer",bodyId:b.id,edgeSet:"verticalOuterPerimeter",distance:n("distance")};
    }
    const next=appendFeatures(sourceBase,[feature]);
    onSource(next.source);setSketch(null);setTool(null);setNotice("Canonical source updated. Preview the review mesh before committing.");
  };
  const fields=tool==="Rectangle"?["width","height"]:tool==="Circle"?["diameter"]:tool==="Line"?["x","y"]:tool==="Dimension"?
    (sketch?.profile?.kind==="rectangle"?["width","height"]:sketch?.profile?.kind==="circle"?["diameter"]:["vertexX","vertexY"]):
    tool==="Extrude"?["distance"]:tool==="Hole"?["x","y","diameter"]:tool==="Linear Pattern"?["count","spacingX","spacingY"]:tool==="Fillet"?["radius"]:tool==="Chamfer"?["distance"]:[];
  const applySketch=()=>attempt(()=>{
    if(!sketch||stale) throw new Error("Start a current XY sketch first");
    let next=sketch;
    if(tool==="Rectangle") next=reduceSketchDraft(next,{type:"rectangle",context,width:n("width"),height:n("height")});
    else if(tool==="Circle") next=reduceSketchDraft(next,{type:"circle",context,diameter:n("diameter")});
    else if(tool==="Line") next=reduceSketchDraft(next,{type:"linePoint",context,point:[n("x"),n("y")]});
    else if(tool==="Dimension") {
      if(!next.profile) throw new Error("Dimension requires a closed profile");
      const polygon=next.profile.kind==="polygon";
      if(next.profile.kind==="polygon"&&(!Number.isInteger(Number(points))||points.trim()===""||Number(points)<0||Number(points)>=next.profile.vertices.length)) throw new Error("Dimension requires an existing vertex index");
      for(const key of fields) next=reduceSketchDraft(next,{type:"dimension",context,target:key as "width"|"height"|"diameter"|"vertexX"|"vertexY",value:n(key),...(polygon?{index:Number(points)}:{})});
    }
    update(next);
  });
  const view=sketch&&!stale&&!readonly?sketchPreview(sketch,context):null;
  useEffect(()=>{onSketchVisible?.(!!sketch&&!readonly&&!stale);},[!!sketch,readonly,stale,onSketchVisible]);
  const bounds=view?view.kind==="circle"?
    [view.center[0]-view.diameter/2,view.center[1]-view.diameter/2,view.center[0]+view.diameter/2,view.center[1]+view.diameter/2]:
    [Math.min(...view.outline.map(p=>p[0])),Math.min(...view.outline.map(p=>p[1])),Math.max(...view.outline.map(p=>p[0])),Math.max(...view.outline.map(p=>p[1]))]:null;
  const margin=bounds?Math.max(1,Math.max(bounds[2]-bounds[0],bounds[3]-bounds[1])*0.05):0;
  const viewBox=bounds?`${bounds[0]-margin} ${bounds[1]-margin} ${Math.max(bounds[2]-bounds[0],1)+2*margin} ${Math.max(bounds[3]-bounds[1],1)+2*margin}`:"-50 -35 100 70";
  const selectCategory=(item:typeof categories[number])=>{setCategory(item);setTool(null);setError("");};
  const chooseVertex=(value:string)=>{
    setPoints(value);
    const polygon=sketch?.profile;
    const index=Number(value);
    if(polygon?.kind!=="polygon"||value.trim()===""||!Number.isInteger(index)||index<0||index>=polygon.vertices.length)return;
    const vertex=polygon.vertices[index];
    setValues(current=>({...current,vertexX:vertex[0],vertexY:vertex[1]}));
  };
  return <section className="r7-command-ui" aria-label="Part commands">
    <div className="r7-command-tabs" role="tablist" aria-label="Part command categories">{categories.map((item,index)=><button type="button" key={item} ref={node=>{tabs.current[item]=node;}} id={`${tabId}-${item}`} role="tab" aria-controls={`${tabId}-panel`} tabIndex={category===item?0:-1} aria-selected={category===item} onClick={()=>selectCategory(item)} onKeyDown={event=>{const target=event.key==="Home"?0:event.key==="End"?categories.length-1:event.key==="ArrowRight"?(index+1)%categories.length:event.key==="ArrowLeft"?(index+categories.length-1)%categories.length:null;if(target!==null){event.preventDefault();selectCategory(categories[target]);tabs.current[categories[target]]?.focus();}}}>{item}</button>)}</div>
    <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${category}`}><div className="r7-command-tools" aria-label={`${category} tools`}>
      {category==="Sketch"&&<><label>Sketch plane<select aria-label="Sketch plane" value={plane} onChange={event=>setPlane(event.target.value)} disabled={readonly||busy||!!sketch}><option value="">Choose plane</option><option value="XY">XY plane</option><option value="XZ" disabled>XZ plane · unavailable</option><option value="YZ" disabled>YZ plane · unavailable</option></select></label><button disabled={readonly||busy||!!sketch||!!body||!!profile||plane!=="XY"} title={body||profile?"This slice supports one sketch profile per Part":undefined} onClick={()=>attempt(()=>update(reduceSketchDraft(null,{type:"newSketch",context,draftId:crypto.randomUUID(),plane:"XY"})))}>New Sketch</button>{sketches.map(item=><button key={item} disabled={readonly||busy||!sketch||stale||sketch.status!=="drawing"} onClick={()=>choose(item)}>{item}</button>)}</>}
      {category==="Features"&&features.map(item=><button key={item} disabled={readonly||busy||stale||finished|| (item==="Extrude"||item==="Revolve"?!((sketch?.status==="finished"&&sketch.profile)||profile)||!!body : item==="Hole"?!body||body.kind!=="extrude"||profile?.kind==="polygon":item==="Linear Pattern"?!hole:!body||body.kind!=="extrude"||profile?.kind!=="rectangle")} title={item==="Revolve"?"Full Z revolve only; circle profile unsupported":item==="Hole"?"Through holes on extruded rectangles/circles only":item==="Linear Pattern"?"Requires a through-hole; 2–16 instances":item==="Fillet"||item==="Chamfer"?"Rectangular extruded plate outer vertical corners only":undefined} onClick={()=>choose(item)}>{item}</button>)}
      {category==="Inspect"&&<><button disabled={!measureAvailable} onClick={onMeasure} title={!measureAvailable?"Admitted review mesh required":undefined}>Measure</button><button disabled={measurement.phase==="idle"} onClick={onClearMeasurement}>Clear</button><output aria-live="polite" data-testid="feature-measurement">{!measureAvailable?"No admitted review mesh to measure":measurement.phase==="armed"?"Select first point on review mesh (click or focus mesh and press Enter)":measurement.phase==="endpoint-a"?"Select second point on review mesh; Escape cancels":measurement.phase==="complete"&&measurement.endpointA&&measurement.endpointB?`Approx. review-mesh distance ${Math.hypot(...measurement.endpointA.map((value,index)=>value-measurement.endpointB![index])).toFixed(2)} mm · review-only, not exact B-rep`:"Review-mesh distance · choose Measure"}</output></>}
    </div></div>
    {sketch&&!readonly&&<div className="r7-sketch-state"><strong>XY sketch · {sketch.status} · 2D only</strong>{stale&&<p role="alert">Stale sketch context. Cancel and start against the current revision.</p>}{sketch.linePoints.length>0&&!sketch.profile&&<button onClick={()=>attempt(()=>update(reduceSketchDraft(sketch,{type:"closeLine",context})))} disabled={stale||readonly}>Close Line</button>}{sketch.status==="drawing"&&<button disabled={readonly||stale||!sketch.profile} onClick={()=>attempt(()=>update(reduceSketchDraft(sketch,{type:"finishSketch",context})))}>Finish Sketch</button>}<button disabled={readonly} onClick={()=>attempt(()=>update(reduceSketchDraft(sketch,{type:"cancelSketch",context:sketch.context})))}>Cancel Sketch</button></div>}
    {active&&sketch&&!stale&&!readonly&&viewportTarget&&createPortal(<div className="r7-sketch-workplane" data-testid="sketch-workplane"><div className="r7-workplane-caption">XY workplane · {sketch.status} · mm · sketch only</div><svg role="img" aria-label="Sketch-only 2D preview" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="r7-sketch-preview">{view&&(view.kind==="circle"?<circle cx={view.center[0]} cy={view.center[1]} r={view.diameter/2} fill="none" stroke="currentColor"/>:view.closed?<polygon points={view.outline.map(([x,y])=>`${x},${y}`).join(" ")} fill="none" stroke="currentColor"/>:<polyline points={view.outline.map(([x,y])=>`${x},${y}`).join(" ")} fill="none" stroke="currentColor"/>)}</svg><div className="r7-axis">CAD XY · mm</div></div>,viewportTarget)}
    {active&&tool&&!readonly&&propertyTarget&&createPortal(<form className="r7-command-editor" aria-label={`${tool} parameters`} onSubmit={event=>{event.preventDefault();if(readonly||busy)return;tool==="Revolve"||features.includes(tool as FeatureTool)?attempt(()=>addFeature(tool as FeatureTool)):applySketch();}}><strong>{tool} · mm</strong>{fields.map(key=><label key={key}>{key}<input type="number" step={key==="count"?1:"any"} value={values[key]} onChange={event=>setValues(current=>({...current,[key]:event.target.valueAsNumber}))}/></label>)}{tool==="Dimension"&&sketch?.profile?.kind==="polygon"&&<label>Vertex index<input type="number" min="0" max={sketch.profile.vertices.length-1} step="1" value={points} onChange={e=>chooseVertex(e.target.value)}/></label>}<button disabled={readonly||busy||stale}>{sketches.includes(tool as SketchTool)?"Apply to sketch":"Add feature"}</button></form>,propertyTarget)}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <div className="r7-command-preview"><button disabled={readonly||busy||!!sketch||!body} onClick={onPreview}>Preview features</button><button disabled={readonly||busy||!previewReady} onClick={onCommit}>Commit feature revision</button><small>Review mesh only · explicit immutable commit · needs_human_review</small></div>
  </section>;
}
export const commandEmptySource=emptyFeatureSource;
