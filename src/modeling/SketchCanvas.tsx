import { useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from "react";
import { analyzeDraftSketch, sketchPreview, type Point, type SketchCommand, type SketchDraft } from "./sketchDraft";

export type CanvasTool = "Rectangle" | "Circle" | "Line" | null;
type Gesture = { start: Point; current: Point; pointerId: number; move?: { vertex?: number; anchor: Point } };
const axes = { XY: ["X", "Y"], XZ: ["X", "Z"], YZ: ["Y", "Z"] } as const;

/** Local sketch coordinates are millimetres, with positive v down on this 2D workplane. */
export function SketchCanvas({ draft, tool, selectedAxis = null, selectedEdge = null, onSelectEdge, onCommand, onError, onSelectVertex }: {
  draft: SketchDraft; tool: CanvasTool; onCommand: (command: SketchCommand) => void;
  selectedAxis?: "U" | "V" | null; selectedEdge?: number | null; onSelectEdge?: (index: number) => void;
  onError: (message: string) => void; onSelectVertex: (index: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const frozenBox = useRef<string | null>(null);
  const [drawing, setDrawing] = useState<Gesture | null>(null);
  const [selection, setSelection] = useState<{ vertex?: number } | null>(null);
  const view = sketchPreview(draft, draft.context);
  const bounds = view ? view.kind === "circle" ?
    [view.center[0] - view.diameter / 2, view.center[1] - view.diameter / 2, view.center[0] + view.diameter / 2, view.center[1] + view.diameter / 2] :
    [Math.min(...view.outline.map(p => p[0])), Math.min(...view.outline.map(p => p[1])), Math.max(...view.outline.map(p => p[0])), Math.max(...view.outline.map(p => p[1]))] : null;
  const margin = bounds ? Math.max(1, Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * .05) : 0;
  const computedBox = bounds ? `${bounds[0] - margin} ${bounds[1] - margin} ${Math.max(bounds[2] - bounds[0], 1) + 2 * margin} ${Math.max(bounds[3] - bounds[1], 1) + 2 * margin}` : "-50 -35 100 70";
  const viewBox = frozenBox.current ?? computedBox;
  const [boxX, boxY, boxW, boxH] = viewBox.split(/\s+/).map(Number);
  const coords = (event: ReactPointerEvent): Point => {
    const element = svg.current!;
    const ctm = element.getScreenCTM?.();
    if (ctm && typeof DOMPoint !== "undefined") {
      const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
      return [p.x, p.y];
    }
    // jsdom and browsers without a CTM: reproduce SVG's xMidYMid meet projection.
    const rect = element.getBoundingClientRect();
    const [x, y, w, h] = viewBox.split(/\s+/).map(Number);
    const width = rect.width || 200, height = rect.height || 200;
    const scale = Math.min(width / w, height / h);
    return [x + (event.clientX - rect.left - (width - w * scale) / 2) / scale,
      y + (event.clientY - rect.top - (height - h * scale) / 2) / scale];
  };
  const emit = (command: SketchCommand) => { onCommand(command); };
  const down = (event: ReactPointerEvent) => {
    if (draft.status !== "drawing" || event.button !== 0) return;
    const vertexNode = (event.target as Element).closest("[data-sketch-vertex]");
    const edgeNode = (event.target as Element).closest("[data-sketch-edge]");
    if (edgeNode && onSelectEdge) {
      onSelectEdge(Number(edgeNode.getAttribute("data-sketch-edge")));
      return;
    }
    const shapeNode = (event.target as Element).closest("[data-sketch-profile]");
    if (vertexNode || shapeNode) {
      const vertex = vertexNode ? Number(vertexNode.getAttribute("data-sketch-vertex")) : undefined;
      setSelection({ vertex });
      if (vertex !== undefined) onSelectVertex(vertex);
      const start = coords(event);
      const anchor = vertex !== undefined && draft.profile?.kind === "polygon" ? draft.profile.vertices[vertex] : draft.position;
      gesture.current = { start, current: start, pointerId: event.pointerId, move: { vertex, anchor } };
    } else if (tool === "Line") {
      if (draft.profile) { onError("Clear the existing profile before drawing Line points"); return; }
      emit({ type: "linePoint", context: draft.context, point: coords(event) });
      return;
    } else if (tool === "Rectangle" || tool === "Circle") {
      if (draft.profile) { onError("Clear the existing profile before drawing another shape"); return; }
      const start = coords(event);
      gesture.current = { start, current: start, pointerId: event.pointerId };
    } else return;
    frozenBox.current = viewBox;
    setDrawing(gesture.current);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event: ReactPointerEvent) => {
    if (!gesture.current || event.pointerId !== gesture.current.pointerId) return;
    gesture.current = { ...gesture.current, current: coords(event) };
    setDrawing(gesture.current);
  };
  const stop = (event: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const end = coords(event);
    gesture.current = null; frozenBox.current = null; setDrawing(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (g.move) {
      const point: Point = [g.move.anchor[0] + end[0] - g.start[0], g.move.anchor[1] + end[1] - g.start[1]];
      if (point[0] !== g.move.anchor[0] || point[1] !== g.move.anchor[1]) emit({ type: "move", context: draft.context, entityId: draft.profileId, point, ...(g.move.vertex !== undefined ? { vertex: g.move.vertex } : {}) });
    } else if (tool === "Rectangle") {
      const width = Math.abs(end[0] - g.start[0]), height = Math.abs(end[1] - g.start[1]);
      if (width > 0 && height > 0) {
        emit({ type: "rectangle", context: draft.context, width, height });
        emit({ type: "move", context: draft.context, entityId: draft.profileId, point: [Math.min(g.start[0], end[0]), Math.min(g.start[1], end[1])] });
      }
    } else if (tool === "Circle") {
      const diameter = 2 * Math.hypot(end[0] - g.start[0], end[1] - g.start[1]);
      if (diameter > 0) {
        emit({ type: "circle", context: draft.context, diameter });
        emit({ type: "move", context: draft.context, entityId: draft.profileId, point: g.start });
      }
    }
  };
  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "Escape") { gesture.current = null; frozenBox.current = null; setDrawing(null); return; }
    if (draft.status !== "drawing") return;
    if (event.key === "Enter" && tool === "Line" && draft.linePoints.length >= 3 && !draft.profile) {
      event.preventDefault(); emit({ type: "closeLine", context: draft.context });
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selection) {
      event.preventDefault();
      if (selection.vertex !== undefined) emit({ type: "deletePoint", context: draft.context, entityId: draft.profileId, vertex: selection.vertex });
      else {
        // A draft has no deleteProfile command: cancel and reopen only this transient sketch.
        emit({ type: "cancelSketch", context: draft.context });
        emit({ type: "newSketch", context: draft.context, draftId: draft.draftId, ...draft.placement, profileId: draft.profileId, ...(draft.base ? { base: draft.base } : {}) });
      }
      setSelection(null);
    }
  };
  const dimensions = view?.kind === "circle" ? `Ø ${view.diameter.toFixed(2)} mm${view.innerDiameter !== undefined ? ` · inner Ø ${view.innerDiameter.toFixed(2)} mm` : ""}` : view?.kind === "rectangle" ? `${view.width!.toFixed(2)} × ${view.height!.toFixed(2)} mm` : null;
  const status = analyzeDraftSketch(draft).status === "fullyDefined" ? "fully defined" : "underdefined";
  const plane = draft.placement.plane;
  return <div className="r7-sketch-workplane" data-testid="sketch-workplane">
    <div className="r7-workplane-caption">{plane} workplane · {draft.status} · mm · sketch only · {status}</div>
    <svg ref={svg} role="img" aria-label="Sketch-only 2D preview" tabIndex={0} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="r7-sketch-preview"
      style={{ touchAction: "none" }} onPointerDown={down} onPointerMove={move} onPointerUp={stop} onPointerCancel={() => { gesture.current = null; frozenBox.current = null; setDrawing(null); }} onKeyDown={key}>
      {view && (view.kind === "circle" ? <><circle data-sketch-profile="true" aria-label="Select circle profile" cx={view.center[0]} cy={view.center[1]} r={view.diameter / 2} fill="none" stroke="currentColor"/>{view.innerDiameter !== undefined && <circle data-sketch-profile="true" aria-label="Select inner circle profile" cx={view.center[0]} cy={view.center[1]} r={view.innerDiameter / 2} fill="none" stroke="currentColor"/>}</> : view.closed ? <polygon data-sketch-profile="true" aria-label="Select sketch profile" points={view.outline.map(([x,y]) => `${x},${y}`).join(" ")} fill="none" stroke="currentColor"/> : <polyline points={view.outline.map(([x,y]) => `${x},${y}`).join(" ")} fill="none" stroke="currentColor"/>)}
      {selectedAxis && <line data-sketch-selected-axis={selectedAxis} x1={selectedAxis === "V" ? 0 : boxX} y1={selectedAxis === "U" ? 0 : boxY} x2={selectedAxis === "V" ? 0 : boxX + boxW} y2={selectedAxis === "U" ? 0 : boxY + boxH} stroke="currentColor" strokeDasharray="3 2" pointerEvents="none" aria-label={`Local ${selectedAxis} mirror axis`}/>}
      {view?.kind === "line" && view.outline.slice(0, -1).map((p, index) => <line key={index} data-sketch-edge={index} data-sketch-selected-edge={selectedEdge === index ? index : undefined} aria-label={`Select open chain edge ${index}`} x1={p[0]} y1={p[1]} x2={view.outline[index+1][0]} y2={view.outline[index+1][1]} stroke="currentColor" strokeWidth={selectedEdge === index ? 3 : 1} onClick={() => onSelectEdge?.(index)}/>)}
      {view?.kind === "polygon" && view.outline.map(([x,y], index) => <circle key={index} data-sketch-vertex={index} aria-label={`Select vertex ${index}`} cx={x} cy={y} r="3" fill="currentColor"/>)}
      {drawing && !drawing.move && tool === "Rectangle" && <rect x={Math.min(drawing.start[0], drawing.current[0])} y={Math.min(drawing.start[1], drawing.current[1])} width={Math.abs(drawing.current[0]-drawing.start[0])} height={Math.abs(drawing.current[1]-drawing.start[1])} fill="none" stroke="currentColor" strokeDasharray="3 2" pointerEvents="none"/>}
      {drawing && !drawing.move && tool === "Circle" && <circle cx={drawing.start[0]} cy={drawing.start[1]} r={Math.hypot(drawing.current[0]-drawing.start[0],drawing.current[1]-drawing.start[1])} fill="none" stroke="currentColor" strokeDasharray="3 2" pointerEvents="none"/>}
    </svg>
    {dimensions && <output className="r7-sketch-dimensions">{dimensions}</output>}
    <div className="r7-axis">CAD {plane} · {axes[plane][0]} → · {axes[plane][1]} ↓ · mm</div>
  </div>;
}
