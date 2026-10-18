import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useRef, useState } from "react";
import { SketchCanvas } from "../src/modeling/SketchCanvas";
import { reduceSketchDraft, type SketchCommand, type SketchDraft } from "../src/modeling/sketchDraft";

const context = { projectId: "p", documentId: "d", revisionId: null };
const begin = (plane: "XY" | "XZ" | "YZ" = "XY") => reduceSketchDraft(null, { type: "newSketch", context, draftId: "draft", plane });
afterEach(cleanup);
function Harness({tool = "Rectangle", initial = begin(), active = true}: {tool?: "Rectangle" | "Circle" | "Line" | null; initial?: SketchDraft; active?: boolean}) {
  const [draft, setDraft] = useState(initial);
  const current = useRef<SketchDraft | null>(initial);
  const [error, setError] = useState("");
  return <><output data-testid="draft">{JSON.stringify(draft)}</output><output role="alert">{error}</output>{active && <SketchCanvas draft={draft} tool={tool} onCommand={(command: SketchCommand) => {
    try { current.current = command.type === "cancelSketch" ? reduceSketchDraft(current.current, command) : reduceSketchDraft(current.current, command); setDraft(current.current as SketchDraft); setError(""); } catch (e) { setError(String(e)); }
  }} onError={setError} onSelectVertex={() => {}} />}</>;
}
function data(): SketchDraft { return JSON.parse(screen.getByTestId("draft").textContent!); }
function canvas() { return screen.getByRole("img", { name: "Sketch-only 2D preview" }); }
function unitViewport() {
  Object.defineProperty(canvas(), "getBoundingClientRect", { value: () => {
    const [x,y,width,height] = canvas().getAttribute("viewBox")!.split(" ").map(Number);
    return { left:100+x, top:100+y, width, height, right:100+x+width, bottom:100+y+height };
  }});
}
function point(x: number, y: number, pointerId = 1) { return { clientX: x, clientY: y, pointerId, pointerType: "mouse" }; }
function draw(from: readonly [number, number], to: readonly [number, number]) {
  fireEvent.pointerDown(canvas(), point(...from)); fireEvent.pointerMove(canvas(), point(...to)); fireEvent.pointerUp(canvas(), point(...to));
}
it("draws a rectangle from two viewport points in local mm without authored source", () => {
  render(<Harness />); unitViewport(); draw([100, 100], [140, 120]);
  expect(data().profile).toMatchObject({kind:"rectangle", width:40, height:20});
  expect(data().generation).toBe(2);
  expect(canvas().querySelector("polygon")).toHaveAttribute("points", "0,0 40,0 40,20 0,20");
  expect(screen.getByText(/underdefined/)).toBeInTheDocument();
});
it("draws a circle with pointer center and diameter twice the radius", () => {
  render(<Harness tool="Circle"/>); unitViewport(); draw([100,100],[130,140]);
  expect(data().profile).toMatchObject({kind:"circle", diameter:100});
  expect(canvas().querySelector("circle")).toHaveAttribute("r", "50");
});
it("draws and closes connected line points using keyboard and pointer", () => {
  render(<Harness tool="Line"/>); unitViewport();
  fireEvent.pointerDown(canvas(),point(100,100));fireEvent.pointerDown(canvas(),point(130,100));fireEvent.pointerDown(canvas(),point(130,125));
  expect(data().linePoints).toEqual([[0,0],[30,0],[30,25]]);
  fireEvent.keyDown(canvas(),{key:"Enter"});
  expect(data().profile).toMatchObject({kind:"polygon",vertices:[[0,0],[30,0],[30,25]]});
});
it("maps through a letterboxed SVG viewport rather than stretching client bounds", () => {
  render(<Harness/>);const svg=canvas();
  Object.defineProperty(svg,"getBoundingClientRect",{value:()=>({left:0,top:0,width:400,height:200,right:400,bottom:200})});
  // 100x70 viewBox in a 400x200 client rectangle: 2.857 px/mm with horizontal padding.
  fireEvent.pointerDown(svg,point(100,100));fireEvent.pointerUp(svg,point(157.142857,128.571428));
  expect(data().profile?.kind).toBe("rectangle");
  const profile=data().profile;
  if(profile?.kind==="rectangle") { expect(profile.width).toBeCloseTo(20,3); expect(profile.height).toBeCloseTo(10,3); }
});
it("selects, moves, and deletes a free profile without drawing when no tool is active", () => {
  let draft=reduceSketchDraft(begin(),{type:"rectangle",context,width:20,height:10});
  render(<Harness tool={null} initial={draft}/>); unitViewport();
  const shape=canvas().querySelector("polygon")!;
  fireEvent.pointerDown(shape,point(100,100));fireEvent.pointerMove(canvas(),point(110,115));fireEvent.pointerUp(canvas(),point(110,115));
  expect(data().profile).toMatchObject({origin:[10,15]});
  fireEvent.keyDown(canvas(),{key:"Delete"});expect(data().profile).toBeNull();
});
it("rejects a constrained move visibly and preserves the last valid profile", () => {
  let draft=reduceSketchDraft(begin(),{type:"rectangle",context,width:20,height:10});
  draft=reduceSketchDraft(draft,{type:"addConstraint",context,constraint:{id:"fixed",kind:"fixedProfile"}});
  render(<Harness tool={null} initial={draft}/>); unitViewport();
  fireEvent.pointerDown(canvas().querySelector("polygon")!,point(100,100));fireEvent.pointerUp(canvas(),point(110,110));
  expect(data()).toEqual(draft);expect(screen.getByRole("alert")).toHaveTextContent(/constrained/i);
  expect(screen.getByText(/fully defined/i)).toBeInTheDocument();
});
it("shows the chosen plane axes and omits inactive or historical canvas", () => {
  const {rerender}=render(<Harness initial={begin("YZ")}/>);
  expect(screen.getByText(/YZ workplane/)).toBeInTheDocument();
  expect(screen.getByText(/Y →/)).toBeInTheDocument();
  rerender(<Harness active={false}/>);
  expect(screen.queryByTestId("sketch-workplane")).not.toBeInTheDocument();
});
