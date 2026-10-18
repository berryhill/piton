import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { appendFeatures, emptyFeatureSource, readFeatures, replaceFeature, type PartFeature, type FeatureSource, type ProfileFeature, type SketchConstraint } from "./source";
import { reduceSketchDraft, reopenSketchProfile, sketchSource, type SketchContext, type SketchDraft, type SketchCommand } from "./sketchDraft";
import { analyzeSketch, sketchConstraints } from "./sketchConstraints";
import { SketchCanvas } from "./SketchCanvas";
import type { FixtureReviewMeasurement } from "../fixture";
import type { SurvivingCap } from "./capFaces";
import type { PrincipalPlane } from "./source";

export interface CapFaceSelection extends SketchContext {
  readonly sourceDigest:string; readonly scope:string;
  readonly featureId:string; readonly side:"start"|"end"; readonly plane:PrincipalPlane;
}

type FeatureTool = "Extrude" | "Cut Extrude" | "Revolve" | "Hole" | "Linear Pattern" | "Fillet" | "Chamfer";
type SketchTool = "Line" | "Rectangle" | "Circle" | "Dimension" | "Mirror" | "Trim";
const features: FeatureTool[] = ["Extrude", "Cut Extrude", "Revolve", "Hole", "Linear Pattern", "Fillet", "Chamfer"];
const sketches: SketchTool[] = ["Line", "Rectangle", "Circle", "Dimension", "Mirror", "Trim"];
const defaults: Record<string, number> = { width: 80, height: 50, diameter: 20, x: 15, y: 15, distance: 6, radius: 2, count: 2, spacingX: 15, spacingY: 0, vertexX: 0, vertexY: 0 };
const categories = ["Sketch", "Features", "Inspect"] as const;
export type PartCategory = typeof categories[number];
export function PartCategoryTabs({id,category,onSelect}:{id:string;category:PartCategory;onSelect:(category:PartCategory)=>void}) {
  const tabs=useRef<Partial<Record<PartCategory,HTMLButtonElement|null>>>({});
  return <div className="r7-command-tabs" role="tablist" aria-label="Part command categories">{categories.map((item,index)=><button type="button" key={item} ref={node=>{tabs.current[item]=node;}} id={`${id}-${item}`} role="tab" aria-controls={`${id}-panel`} tabIndex={category===item?0:-1} aria-selected={category===item} onClick={()=>onSelect(item)} onKeyDown={event=>{const target=event.key==="Home"?0:event.key==="End"?categories.length-1:event.key==="ArrowRight"?(index+1)%categories.length:event.key==="ArrowLeft"?(index+categories.length-1)%categories.length:null;if(target!==null){event.preventDefault();onSelect(categories[target]);tabs.current[categories[target]]?.focus();}}}>{item}</button>)}</div>;
}

/** Transient document-local controls; only canonical source crosses the application gate. */
export function PartCommandUI({active=true,selectedFeatureId,context,baseSource,source,onSource,readonly,busy,previewReady,onPreview,onCommit,onSketchDirty,onSketchVisible,onOpenProperties,propertyTarget,viewportTarget,resetToken,measureAvailable=false,measureUnavailableReason,measurement={phase:"idle"},onMeasure,onClearMeasurement,capCandidates,onClearCapSelection,capSelection}:{
  active?:boolean;
  selectedFeatureId?:string;
  context:SketchContext; baseSource:FeatureSource; source:string; onSource:(source:string)=>void;
  readonly:boolean;busy:boolean;previewReady:boolean;onPreview:()=>void;onCommit:()=>void;onSketchDirty:(dirty:boolean)=>void;
  onSketchVisible?:(visible:boolean)=>void;onOpenProperties?:()=>void;propertyTarget?:HTMLElement;viewportTarget?:HTMLElement;
  resetToken?:number;
  measureAvailable?:boolean;measureUnavailableReason?:string;measurement?:FixtureReviewMeasurement;onMeasure?:()=>void;onClearMeasurement?:()=>void;
  capCandidates?:readonly SurvivingCap[];capSelection?:CapFaceSelection|null;onClearCapSelection?:()=>void;
}) {
  const [category,setCategory]=useState<"Sketch"|"Features"|"Inspect">("Sketch");
  const [sketch,setSketch]=useState<SketchDraft|null>(null);
  const [tool,setTool]=useState<SketchTool|FeatureTool|null>(null);
  const [values,setValues]=useState<Record<string,number>>(defaults);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [points,setPoints]=useState("");
  const [mirrorAxis,setMirrorAxis]=useState<"U"|"V">("V");
  const [trimEdge,setTrimEdge]=useState("0");
  const [trimKeep,setTrimKeep]=useState<"start"|"end">("start");
  const [plane,setPlane]=useState("");
  const [support,setSupport]=useState("");
  const [offset,setOffset]=useState(0);
  const [direction,setDirection]=useState<"forward"|"reverse"|"symmetric">("forward");
  const [endCondition,setEndCondition]=useState<"blind"|"throughAll">("blind");
  const [editing,setEditing]=useState<{id:string;source:string;revisionId:string|null;kind:"sketch"|"feature"}|null>(null);
  const sketchRef=useRef<SketchDraft|null>(null);
  const tabId=useId();

  useEffect(()=>{onSketchDirty(!!sketch||!!editing);},[sketch,editing,onSketchDirty]);
  useEffect(()=>{if(resetToken===undefined)return;sketchRef.current=null;setSketch(null);setTool(null);setEditing(null);setError("");setNotice("");},[resetToken]);
  const stale=!!sketch && (sketch.context.projectId!==context.projectId || sketch.context.documentId!==context.documentId || sketch.context.revisionId!==context.revisionId);
  const effective=source===baseSource.source?baseSource:{...baseSource,source};
  let parsed:readonly PartFeature[]=[];
  try { parsed=readFeatures(effective); } catch { /* Advanced source is invalid; command actions disclose this below. */ }
  const profiles=parsed.filter((f):f is ProfileFeature=>f.kind==="rectangle"||f.kind==="circle"||f.kind==="polygon");
  const profile=profiles.at(-1);
  const body=[...parsed].reverse().find(f=>f.kind==="extrude"||f.kind==="revolve");
  const pending=sketch?.status==="finished"?sketch.profile:[...profiles].reverse().find(p=>!parsed.some(f=>(f.kind==="extrude"||f.kind==="revolve")&&f.profileId===p.id));
  const hole=parsed.find(f=>f.kind==="hole");
  const finished=parsed.some(f=>f.kind==="fillet"||f.kind==="chamfer");
  const selected=active&&!readonly&&!busy&&selectedFeatureId?parsed.find(f=>f.id===selectedFeatureId):undefined;
  const editable=selected&&selected.kind!=="revolve"?selected:undefined;
  const editorValid=!!editing&&active&&!readonly&&!busy&&editing.revisionId===context.revisionId&&editing.source===effective.source;
  const cancelEdit=()=>{if(editing?.kind==="sketch"){sketchRef.current=null;setSketch(null);}setEditing(null);setTool(null);setError("");};
  const openEdit=(feature:PartFeature)=>attempt(()=>{
    if(!active||readonly||busy||sketch||editing)throw new Error("Finish or cancel the active editor first");
    const kind=feature.kind==="rectangle"||feature.kind==="circle"||feature.kind==="polygon"?"sketch":"feature";
    if(feature.kind==="revolve")throw new Error("Revolve editing is not supported");
    setEditing({id:feature.id,source:effective.source,revisionId:context.revisionId,kind});
    setValues({...defaults,...("width" in feature?{width:feature.width,height:feature.height}:{}),...("diameter" in feature?{diameter:feature.diameter}:{}),...("distance" in feature?{distance:feature.distance}:{}),...("radius" in feature?{radius:feature.radius}:{}),...("count" in feature?{count:feature.count,spacingX:feature.spacingX,spacingY:feature.spacingY}:{}),...("x" in feature?{x:feature.x,y:feature.y}:{})});
    if(kind==="sketch"){
      const draft=reopenSketchProfile(effective,feature.id,context,crypto.randomUUID());
      update(draft);setPlane(draft.placement.plane);setSupport(draft.placement.support?`${draft.placement.support.featureId}:${draft.placement.support.side}`:"");setOffset(draft.placement.offset??0);
      setCategory("Sketch");setTool(null);
    }else{
      setDirection(feature.kind==="extrude"?feature.direction??"forward":"forward");setEndCondition(feature.kind==="extrude"?feature.endCondition??"blind":"blind");
      setCategory("Features");setTool(feature.kind==="extrude"?feature.operation==="cut"?"Cut Extrude":"Extrude":feature.kind==="linearPattern"?"Linear Pattern":feature.kind==="fillet"?"Fillet":feature.kind==="chamfer"?"Chamfer":"Hole");
    }
    onOpenProperties?.();
  });
  const applyFeatureEdit=()=>{
    if(!editing||editing.kind!=="feature"||!editorValid)throw new Error("Stale feature editor; cancel and reopen against the current source");
    const feature=readFeatures(effective).find(f=>f.id===editing.id);
    if(!feature)throw new Error("Selected feature no longer exists");
    let replacement:PartFeature;
    switch(feature.kind){
      case "extrude": {
        const {direction:previousDirection,endCondition:previousCondition,...unchanged}=feature;
        replacement={...unchanged,distance:n("distance"),...(direction!=="forward"||previousDirection!==undefined?{direction}:{}),...(endCondition!=="blind"||previousCondition!==undefined?{endCondition}:{})};break;
      }
      case "hole": replacement={...feature,x:n("x"),y:n("y"),diameter:n("diameter")};break;
      case "linearPattern": replacement={...feature,count:n("count"),spacingX:n("spacingX"),spacingY:n("spacingY")};break;
      case "fillet": replacement={...feature,radius:n("radius")};break;
      case "chamfer": replacement={...feature,distance:n("distance")};break;
      default: throw new Error("This feature has no supported editor");
    }
    const next=replaceFeature(effective,editing.id,replacement);
    onSource(next.source);setEditing(null);setTool(null);setNotice("Edited canonical draft. Preview dependent features before committing.");
  };
  const update=(next:SketchDraft|null)=>{sketchRef.current=next;setSketch(next);setError("");setNotice("");};
  const canvasCommand=(command:SketchCommand)=>{try { update(command.type==="cancelSketch"?reduceSketchDraft(sketchRef.current,command):reduceSketchDraft(sketchRef.current,command)); } catch(e){setError(e instanceof Error?e.message:String(e));}};
  const attempt=(fn:()=>void)=>{try {setError("");fn();} catch(e){setError(e instanceof Error?e.message:String(e));}};
  const choose=(name:SketchTool|FeatureTool)=>{
    const profile=sketch?.profile;
    setPoints(profile?.kind==="polygon"?"0":"");
    setMirrorAxis("V");setTrimEdge("0");setTrimKeep("start");
    setTool(name);
    setDirection("forward");setEndCondition("blind");
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
    const sourceBase=sketch?.status==="finished" ? sketchSource(sketch,context,effective) : effective;
    const existing=readFeatures(sourceBase);
    const p=sketch?.status==="finished"?existing.find(f=>f.id===sketch.profileId):[...existing].reverse().find(f=>(f.kind==="rectangle"||f.kind==="circle"||f.kind==="polygon")&&!existing.some(e=>(e.kind==="extrude"||e.kind==="revolve")&&e.profileId===f.id));
    const b=[...existing].reverse().find(f=>f.kind==="extrude"||f.kind==="revolve");
    const bodyProfile=b?existing.find(f=>f.id===b.profileId):undefined;
    const h=existing.find(f=>f.kind==="hole");
    const id=(prefix:string)=>{const used=new Set(existing.map(f=>f.id));let index=1;while(used.has(`${prefix}${index}`))index++;return `${prefix}${index}`;};
    let feature:PartFeature;
    if(name==="Extrude" || name==="Cut Extrude" || name==="Revolve") {
      if(!p) throw new Error("Finish a new, unconsumed sketch profile before creating a feature");
      if(name==="Revolve"&&b) throw new Error("Revolve only supports the first body; use Extrude for subsequent sketches");
      if(name==="Cut Extrude"&&(!b||b.kind!=="extrude")) throw new Error("Cut Extrude requires a preceding extruded body");
      feature=name!=="Revolve"?{kind:"extrude",id:id("extrude"),name:name==="Cut Extrude"?"Cut extrusion":"Extrusion",profileId:p.id,distance:n("distance"),
        ...(b&&b.kind==="extrude"?{targetBodyId:b.id,operation:name==="Cut Extrude"?"cut" as const:"add" as const}:{}),
        ...(direction!=="forward"?{direction}:{}),...(name==="Cut Extrude"?{endCondition}:{} )}
        :{kind:"revolve",id:id("revolve"),name:"Full revolve",profileId:p.id,axis:"Z",angleDegrees:360};
    } else if(name==="Hole") {
      if(!b||b.kind!=="extrude"||!bodyProfile||(bodyProfile.kind!=="rectangle"&&bodyProfile.kind!=="circle")) throw new Error("Hole requires an extruded rectangle or circle");
      feature={kind:"hole",id:id("hole"),name:"Through hole",bodyId:b.id,x:n("x"),y:n("y"),diameter:n("diameter"),extent:"through"};
    } else if(name==="Linear Pattern") {
      if(!b||!h) throw new Error("Linear Pattern requires a preceding through-hole on an extruded body");
      feature={kind:"linearPattern",id:id("pattern"),name:"Hole pattern",bodyId:b.id,sourceHoleId:h.id,count:n("count"),spacingX:n("spacingX"),spacingY:n("spacingY")};
    } else {
      if(!b||b.kind!=="extrude"||bodyProfile?.kind!=="rectangle") throw new Error(`${name} requires a rectangular extruded plate`);
      feature=name==="Fillet"?{kind:"fillet",id:id("fillet"),name:"Outer corner fillet",bodyId:b.id,edgeSet:"verticalOuterPerimeter",radius:n("radius")}
        :{kind:"chamfer",id:id("chamfer"),name:"Outer corner chamfer",bodyId:b.id,edgeSet:"verticalOuterPerimeter",distance:n("distance")};
    }
    const next=appendFeatures(sourceBase,[feature]);
    onSource(next.source);setSketch(null);setTool(null);setNotice("Canonical source updated. Preview the review mesh before committing.");
  };
  const fields=tool==="Rectangle"?["width","height"]:tool==="Circle"?["diameter"]:tool==="Line"?["x","y"]:tool==="Dimension"?
    (sketch?.profile?.kind==="rectangle"?["width","height"]:sketch?.profile?.kind==="circle"?["diameter"]:["vertexX","vertexY"]):
    tool==="Extrude"||tool==="Cut Extrude"?["distance"]:tool==="Hole"?["x","y","diameter"]:tool==="Linear Pattern"?["count","spacingX","spacingY"]:tool==="Fillet"?["radius"]:tool==="Chamfer"?["distance"]:[];
  const applySketch=()=>attempt(()=>{
    if(!sketch||stale) throw new Error("Start a current sketch first");
    let next=sketch;
    if(tool==="Rectangle") next=reduceSketchDraft(next,{type:"rectangle",context,width:n("width"),height:n("height")});
    else if(tool==="Circle") next=reduceSketchDraft(next,{type:"circle",context,diameter:n("diameter")});
    else if(tool==="Line") next=reduceSketchDraft(next,{type:"linePoint",context,point:[n("x"),n("y")]});
    else if(tool==="Mirror") next=reduceSketchDraft(next,{type:next.profile?"mirrorReflection":"mirrorLine",context,axis:mirrorAxis});
    else if(tool==="Trim") next=reduceSketchDraft(next,{type:"trimLine",context,edge:trimEdge.trim()===""?NaN:Number(trimEdge),keep:trimKeep});
    else if(tool==="Dimension") {
      if(!next.profile) throw new Error("Dimension requires a closed profile");
      const polygon=next.profile.kind==="polygon";
      if(next.profile.kind==="polygon"&&(!Number.isInteger(Number(points))||points.trim()===""||Number(points)<0||Number(points)>=next.profile.vertices.length)) throw new Error("Dimension requires an existing vertex index");
      for(const key of fields) next=reduceSketchDraft(next,{type:"dimension",context,target:key as "width"|"height"|"diameter"|"vertexX"|"vertexY",value:n(key),...(polygon?{index:Number(points)}:{})});
    }
    update(next);
  });
  useEffect(()=>{onSketchVisible?.(!!sketch&&!readonly&&!stale);},[!!sketch,readonly,stale,onSketchVisible]);
  const selectCategory=(item:typeof categories[number])=>{setCategory(item);if(!editing)setTool(null);setError("");};
  const chooseVertex=(value:string)=>{
    setPoints(value);
    const polygon=sketch?.profile;
    const index=Number(value);
    if(polygon?.kind!=="polygon"||value.trim()===""||!Number.isInteger(index)||index<0||index>=polygon.vertices.length)return;
    const vertex=polygon.vertices[index];
    setValues(current=>({...current,vertexX:vertex[0],vertexY:vertex[1]}));
  };
  const constraints=sketch?.profile?sketchConstraints(sketch.profile):[];
  const constraintId=()=>{const used=new Set(constraints.map(c=>c.id));let i=1;while(used.has(`constraint${i}`))i++;return `constraint${i}`;};
  const constrain=(constraint:{kind:"origin"}|{kind:"dimension";target:"width"|"height"|"diameter";value:number})=>attempt(()=>{
    if(!sketch||stale||sketch.status!=="drawing") throw new Error("Start a current drawing sketch first");
    update(reduceSketchDraft(sketch,{type:"addConstraint",context,constraint:{...constraint,id:constraintId()} as SketchConstraint}));
  });
  const capOptions=capCandidates??[];
  const selectedCap=capSelection&&capSelection.projectId===context.projectId&&capSelection.documentId===context.documentId&&capSelection.revisionId===context.revisionId&&capOptions.some(c=>c.featureId===capSelection.featureId&&c.side===capSelection.side)?capSelection:null;
  const beginSketch=(placement:{plane:PrincipalPlane;support?:{kind:"extrusionCap";featureId:string;side:"start"|"end"};offset:number})=>attempt(()=>{
    if(!active||readonly||busy||sketch||editing)throw new Error("Sketch authoring unavailable in this document");
    if(placement.support&&!capOptions.some(c=>c.featureId===placement.support?.featureId&&c.side===placement.support?.side))throw new Error("Selected support is not a surviving cap on the current review mesh");
    const used=new Set(parsed.map(f=>f.id));let index=1;while(used.has(`sketchProfile${index}`))index++;
    update(reduceSketchDraft(null,{type:"newSketch",context,draftId:crypto.randomUUID(),plane:placement.plane,profileId:`sketchProfile${index}`,base:effective,...(placement.offset!==0?{offset:placement.offset}:{}),...(placement.support?{support:placement.support}:{})}));setTool(null);
  });
  return <section className="r7-command-ui" aria-label="Part commands">
    {active&&propertyTarget&&selected&&createPortal(<section aria-label="Selected feature editing"><strong>{selected.name} · {selected.id}</strong>{editable?<button type="button" disabled={readonly||busy||!!sketch||!!editing} onClick={()=>openEdit(editable)}>{editable.kind==="rectangle"||editable.kind==="circle"||editable.kind==="polygon"?"Edit Sketch":"Edit Feature"}</button>:<p>Editing this feature is not supported.</p>}</section>,propertyTarget)}
    <PartCategoryTabs id={tabId} category={category} onSelect={selectCategory}/>
    <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${category}`}><div className="r7-command-tools" aria-label={`${category} tools`}>
      {category==="Sketch"&&<><label>Sketch plane<select aria-label="Sketch plane" value={plane} onChange={event=>setPlane(event.target.value)} disabled={readonly||busy||!!sketch}><option value="">Choose plane</option><option value="XY">XY plane</option><option value="XZ">XZ plane</option><option value="YZ">YZ plane</option></select></label><label>Sketch support<select aria-label="Sketch support" value={capOptions.some(c=>`${c.featureId}:${c.side}`===support)?support:""} onChange={event=>{setSupport(event.target.value);if(event.target.value){const parent=parsed.find(f=>f.id===event.target.value.split(":")[0]);const parentProfile=parent?.kind==="extrude"?profiles.find(p=>p.id===parent.profileId):null;if(parentProfile)setPlane(parentProfile.plane);}}} disabled={readonly||busy||!!sketch}><option value="">Principal plane</option>{capOptions.map(c=><option key={`${c.featureId}:${c.side}`} value={`${c.featureId}:${c.side}`}>{parsed.find(f=>f.id===c.featureId)?.name} · {c.featureId} · {c.side} cap</option>)}</select></label><label>Sketch offset<input aria-label="Sketch offset" type="number" step="any" value={offset} onChange={event=>setOffset(event.target.valueAsNumber)} disabled={readonly||busy||!!sketch}/></label><button disabled={readonly||busy||!!sketch||!plane||!parsed.length&&source!==baseSource.source} onClick={()=>{const [featureId,side]=support.split(":");beginSketch({plane:plane as PrincipalPlane,offset,...(support?{support:{kind:"extrusionCap",featureId,side:side as "start"|"end"}}:{})});}}>New Sketch</button>{sketches.map(item=><button key={item} disabled={readonly||busy||!sketch||stale||sketch.status!=="drawing"} onClick={()=>choose(item)}>{item}</button>)}</>}
      {category==="Features"&&features.map(item=><button key={item} disabled={readonly||busy||stale||finished||!!sketch&&sketch.status==="drawing"|| (item==="Extrude"?!pending||!!body&&body.kind!=="extrude":item==="Cut Extrude"?!pending||!body||body.kind!=="extrude":item==="Revolve"?!pending||!!body||pending.kind==="circle":item==="Hole"?!body||body.kind!=="extrude"||profile?.kind==="polygon":item==="Linear Pattern"?!hole:!body||body.kind!=="extrude"||profile?.kind!=="rectangle")} title={item==="Revolve"?"First body only: full Z revolve; circle profile unsupported":item==="Cut Extrude"?"Requires a new finished sketch and preceding extruded body":item==="Hole"?"Through holes on extruded rectangles/circles only":item==="Linear Pattern"?"Requires a through-hole; 2–16 instances":item==="Fillet"||item==="Chamfer"?"Rectangular extruded plate outer vertical corners only":undefined} onClick={()=>choose(item)}>{item}</button>)}
      {category==="Inspect"&&<><button disabled={!measureAvailable} onClick={onMeasure} title={!measureAvailable?measureUnavailableReason??"Admitted review mesh required":undefined}>Measure</button><button disabled={measurement.phase==="idle"} onClick={onClearMeasurement}>Clear</button><output aria-live="polite" data-testid="feature-measurement">{!measureAvailable?measureUnavailableReason??"No admitted review mesh to measure":measurement.phase==="armed"?"Select first point on review mesh (click or focus mesh and press Enter)":measurement.phase==="endpoint-a"?"Select second point on review mesh; Escape cancels":measurement.phase==="complete"&&measurement.endpointA&&measurement.endpointB?`Approx. review-mesh distance ${Math.hypot(...measurement.endpointA.map((value,index)=>value-measurement.endpointB![index])).toFixed(2)} mm · review-only, not exact B-rep`:"Review-mesh distance · choose Measure"}</output></>}
    </div></div>
    {category==="Sketch"&&<div aria-live="polite">{selectedCap?<><output>Selected support: {selectedCap.featureId} {selectedCap.side} cap · review mesh</output> <button type="button" disabled={!active||readonly||busy||!!sketch} onClick={()=>beginSketch({plane:selectedCap.plane,support:{kind:"extrusionCap",featureId:selectedCap.featureId,side:selectedCap.side},offset:0})}>Sketch on selected face</button> <button type="button" onClick={onClearCapSelection}>Clear selected face</button></>:capSelection?<><output>Selected face unavailable on current review mesh</output> <button type="button" onClick={onClearCapSelection}>Clear selected face</button></>:capCandidates===undefined&&parsed.length>0?<output>Named cap supports unavailable until source-matched review geometry is ready; principal planes remain available.</output>:null}</div>}
    {sketch&&!readonly&&<div className="r7-sketch-state"><strong>{sketch.placement.plane} sketch · {sketch.status} · 2D only</strong>{stale&&<p role="alert">Stale sketch context. Cancel and start against the current revision.</p>}{sketch.linePoints.length>0&&!sketch.profile&&<button onClick={()=>attempt(()=>update(reduceSketchDraft(sketch,{type:"closeLine",context})))} disabled={stale||readonly}>Close Line</button>}{sketch.status==="drawing"&&<button disabled={readonly||stale||!sketch.profile||!!editing&&!editorValid} onClick={()=>attempt(()=>{const finished=reduceSketchDraft(sketch,{type:"finishSketch",context});if(editing?.kind==="sketch") {if(!editorValid||finished.profile?.id!==editing.id)throw new Error("Stale sketch editor");const next=sketchSource(finished,context,effective);onSource(next.source);setEditing(null);setTool(null);update(null);setNotice("Edited canonical sketch draft. Preview dependent features before committing.");}else update(finished);})}>Finish Sketch</button>}<button disabled={readonly} onClick={()=>attempt(()=>{if(editing)cancelEdit();else update(reduceSketchDraft(sketch,{type:"cancelSketch",context:sketch.context}));})}>Cancel Sketch</button></div>}
    {active&&sketch&&!stale&&!readonly&&viewportTarget&&createPortal(<SketchCanvas draft={sketch} tool={sketch.status==="drawing"&&(tool==="Rectangle"||tool==="Circle"||tool==="Line")?tool:null} selectedAxis={tool==="Mirror"?mirrorAxis:null} selectedEdge={tool==="Trim"&&trimEdge.trim()!==""?Number(trimEdge):null} onSelectEdge={index=>{setTrimEdge(String(index));setTool("Trim");onOpenProperties?.();}} onCommand={canvasCommand} onError={setError} onSelectVertex={index=>{chooseVertex(String(index));setTool("Dimension");onOpenProperties?.();}}/>,viewportTarget)}
    {active&&tool!=="Mirror"&&tool!=="Trim"&&tool&&!readonly&&propertyTarget&&createPortal(<form className="r7-command-editor" aria-label={editing?.kind==="feature"?"Edit Feature parameters":`${tool} parameters`} onSubmit={event=>{event.preventDefault();if(readonly||busy)return;editing?.kind==="feature"?attempt(applyFeatureEdit):features.includes(tool as FeatureTool)?attempt(()=>addFeature(tool as FeatureTool)):applySketch();}}><strong>{editing?.kind==="feature"?"Edit ":""}{tool} · mm</strong>{fields.map(key=><label key={key}>{key}<input type="number" step={key==="count"?1:"any"} value={values[key]} onChange={event=>setValues(current=>({...current,[key]:event.target.valueAsNumber}))}/></label>)}{(tool==="Extrude"||tool==="Cut Extrude")&&<><label>Direction<select value={direction} onChange={event=>setDirection(event.target.value as typeof direction)}><option value="forward">Forward</option><option value="reverse">Reverse</option><option value="symmetric">Symmetric</option></select></label>{(tool==="Cut Extrude"||editing?.kind==="feature")&&<label>End condition<select value={endCondition} onChange={event=>setEndCondition(event.target.value as typeof endCondition)}><option value="blind">Blind</option><option value="throughAll">Through all</option></select></label>}</>}{tool==="Dimension"&&sketch?.profile?.kind==="polygon"&&<label>Vertex index<input type="number" min="0" max={sketch.profile.vertices.length-1} step="1" value={points} onChange={e=>chooseVertex(e.target.value)}/></label>}<button disabled={readonly||busy||stale||!!editing&&!editorValid}>{editing?.kind==="feature"?"Apply Edit":sketches.includes(tool as SketchTool)?"Apply to sketch":"Add feature"}</button><button type="button" onClick={()=>editing?cancelEdit():setTool(null)}>Cancel</button>{sketch?.status==="drawing"&&sketch.profile&&!stale&&sketch.profile.kind!=="polygon"&&<section aria-label="Sketch constraints"><output>{analyzeSketch(sketch).status} · {analyzeSketch(sketch).degreesOfFreedom} degrees of freedom</output><button type="button" disabled={constraints.some(c=>c.kind==="origin")} onClick={()=>constrain({kind:"origin"})}>Constrain origin</button>{(sketch.profile.kind==="rectangle"?["width","height"]:["diameter"]).map(target=>{const driver=constraints.find(c=>c.kind==="dimension"&&c.target===target);const value=sketch.profile!.kind==="rectangle"?(target==="width"?sketch.profile!.width:sketch.profile!.height):sketch.profile!.kind==="circle"?sketch.profile!.diameter:NaN;return <div key={target}><label>Driving {target}<input type="checkbox" checked={!!driver} onChange={()=>{if(driver)attempt(()=>update(reduceSketchDraft(sketch,{type:"removeConstraint",context,id:driver.id})));else constrain({kind:"dimension",target:target as "width"|"height"|"diameter",value});}}/></label><span>{driver?"Driven":"Free"}</span><button type="button" disabled={!!driver} onClick={()=>constrain({kind:"dimension",target:target as "width"|"height"|"diameter",value})}>Drive {target}</button></div>;})}{constraints.map(c=><button type="button" key={c.id} onClick={()=>attempt(()=>update(reduceSketchDraft(sketch,{type:"removeConstraint",context,id:c.id})))}>Remove {c.id} ({c.kind})</button>)}</section>}</form>,propertyTarget)}
    {active&&(tool==="Mirror"||tool==="Trim")&&!readonly&&propertyTarget&&createPortal(
      <form className="r7-command-editor" aria-label={`${tool} parameters`} onSubmit={event=>{event.preventDefault();if(!busy)applySketch();}}>
        <strong>{tool} · local sketch · mm</strong>
        {tool==="Mirror"?<>
          <label>Mirror axis<select value={mirrorAxis} onChange={event=>setMirrorAxis(event.target.value as "U"|"V")}><option value="V">Local V (u=0)</option><option value="U">Local U (v=0)</option></select></label>
          <p>Open Line: both endpoints on axis and interior points strictly on one side; copies into one closed profile. Closed unconstrained polygon: destructive reflection. No arbitrary axis or parametric mirror relation.</p>
        </>:<>
          <label>Edge index<input type="number" step="1" min="0" value={trimEdge} onChange={event=>setTrimEdge(event.target.value)}/></label>
          <label>Keep side<select value={trimKeep} onChange={event=>setTrimKeep(event.target.value as "start"|"end")}><option value="start">Start (prefix)</option><option value="end">End (suffix)</option></select></label>
          <p>Open Line chain only: remove the selected edge and retain a contiguous side with at least two points. Closed contour trim and intersection solving are unsupported.</p>
        </>}
        <button disabled={busy||stale||sketch?.status!=="drawing"||!!editing&&!editorValid}>Apply to sketch</button>
        <button type="button" onClick={()=>{setTool(null);setError("");}}>Cancel</button>
      </form>,propertyTarget)}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <div className="r7-command-preview"><button disabled={readonly||busy||!!sketch||!!editing||!body} onClick={onPreview}>Preview features</button><button disabled={readonly||busy||!!sketch||!!editing||!previewReady} onClick={onCommit}>Commit feature revision</button><small>Review mesh only · explicit immutable commit · needs_human_review</small></div>
  </section>;
}
export const commandEmptySource=emptyFeatureSource;
