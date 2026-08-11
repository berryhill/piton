(() => {
  "use strict";
  const body = document.body;
  const decode = key => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.dataset[key]), c => c.charCodeAt(0))));
  const packet = decode("packetBase64");
  const selection = decode("selectionBase64");
  const glb = Uint8Array.from(atob(body.dataset.glbBase64), c => c.charCodeAt(0));
  const status = document.getElementById("loaded-status");
  const canvas = document.getElementById("review-canvas");
  const context = canvas.getContext("2d");
  const state = {view:"iso", roll:0, mode:"Smart", selected:false};

  function parseGlb(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0,true) !== 0x46546c67 || view.getUint32(4,true) !== 2 || view.getUint32(8,true) !== bytes.byteLength) throw new Error("invalid GLB");
    const jsonLength = view.getUint32(12,true);
    const document = JSON.parse(new TextDecoder().decode(bytes.slice(20,20+jsonLength)).trim());
    const binaryStart = 20 + jsonLength + 8;
    const primitive = document.meshes[0].primitives[0];
    const pa = document.accessors[primitive.attributes.POSITION], ia = document.accessors[primitive.indices];
    const pv = document.bufferViews[pa.bufferView], iv = document.bufferViews[ia.bufferView];
    const vertices=[]; for(let i=0;i<pa.count;i++){const o=binaryStart+(pv.byteOffset||0)+(pa.byteOffset||0)+i*12;vertices.push([view.getFloat32(o,true),view.getFloat32(o+4,true),view.getFloat32(o+8,true)]);}
    const indices=[]; for(let i=0;i<ia.count;i++){indices.push(view.getUint32(binaryStart+(iv.byteOffset||0)+(ia.byteOffset||0)+i*4,true));}
    return {vertices,indices};
  }
  const mesh = parseGlb(glb);
  // CAD/review XYZ -> Three.js-style world XZY with review Z=0 on world Y=0 grid.
  const artifactToWorld = ([x,y,z]) => [x,z,-y];
  if (Math.abs(Math.min(...mesh.vertices.map(v => artifactToWorld(v)[1]))) > packet.build_plane.tolerance_mm) throw new Error("grid-plane alignment blocked");

  function project(point) {
    let [x,y,z]=artifactToWorld(point); const r=state.roll*Math.PI/180; [x,y]=[x*Math.cos(r)-y*Math.sin(r),x*Math.sin(r)+y*Math.cos(r)];
    if(state.view==="top") [x,y]=[x,z]; else if(state.view==="front") [x,y]=[x,y]; else [x,y]=[x-z*.45,y-z*.25];
    const b=packet.review_geometry.bounding_box_mm, scale=Math.min(canvas.width/(b.size[0]+b.size[1]*.5+20),canvas.height/(b.size[2]+b.size[1]*.3+20));
    return [canvas.width/2+(x-b.size[0]/2)*scale,canvas.height*.72-y*scale];
  }
  function draw(){context.clearRect(0,0,canvas.width,canvas.height);context.strokeStyle="#355668";for(let x=0;x<canvas.width;x+=32){context.beginPath();context.moveTo(x,0);context.lineTo(x,canvas.height);context.stroke()}for(let y=0;y<canvas.height;y+=32){context.beginPath();context.moveTo(0,y);context.lineTo(canvas.width,y);context.stroke()}context.strokeStyle=state.selected?"#ffb24b":"#73d5e8";context.lineWidth=state.selected?2.5:1;for(let i=0;i<mesh.indices.length;i+=3){const p=[0,1,2].map(n=>project(mesh.vertices[mesh.indices[i+n]]));context.beginPath();context.moveTo(...p[0]);context.lineTo(...p[1]);context.lineTo(...p[2]);context.closePath();context.stroke();}}
  function select(){state.selected=true;document.getElementById("current-selection").textContent=`${state.mode}: part:l_bracket`;document.getElementById("attached-context").textContent="Source-Part part:l_bracket · occurrence:l_bracket:1";document.querySelector("#selected-zone output").textContent=selection.bindings[0].zones.map(z=>z.label).join(", ");draw();}
  canvas.addEventListener("click",select);canvas.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();select();}});
  document.querySelectorAll("[data-mode]").forEach(b=>b.addEventListener("click",()=>{state.mode=b.dataset.mode;b.classList.add("selected");}));
  document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>{state.view=b.dataset.view;draw();}));
  document.getElementById("roll").addEventListener("click",()=>{state.roll=(state.roll+15)%360;draw();});
  document.getElementById("reset").addEventListener("click",()=>{Object.assign(state,{view:"iso",roll:0,selected:false});draw();});
  document.getElementById("bbox-reset").addEventListener("click",draw);
  const addDl=(selector,items)=>{const dl=document.querySelector(selector);Object.entries(items).forEach(([k,v])=>{const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=k;dd.textContent=typeof v==="object"?JSON.stringify(v):String(v);dl.append(dt,dd);});};
  addDl("#identity dl",{project_id:packet.project_id,revision_id:packet.revision_id,build_attempt_id:packet.build_attempt_id,evidence_closure_digest:packet.evidence_closure_digest,worker_pin:packet.worker_pin});
  addDl("#source-parameters dl",packet.source_parameters);
  document.querySelector("#bounding-box output").textContent=JSON.stringify(packet.review_geometry.bounding_box_mm);
  packet.validation_issues.forEach(issue=>{const li=document.createElement("li");li.textContent=`${issue.status}: ${issue.message}`;document.querySelector("#validation-issues ul").append(li);});
  status.textContent="Loaded · packet validated";status.className="selected";draw();
})();
