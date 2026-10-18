import type { Point } from "./sketchDraft";

/** Bounded, destructive draft geometry operations, not parametric relations.
 * U is local v=0; V is local u=0. There is no arbitrary-axis mirror,
 * intersection trim, arc trim, constraint propagation or saved trim feature. */
export type SketchLocalAxis = "U" | "V";

function coordinate(axis: SketchLocalAxis): 0 | 1 {
  if (axis === "U") return 1;
  if (axis === "V") return 0;
  throw new Error("Mirror axis must be local U or V");
}
function reflected(point: Point, index: 0 | 1): Point {
  return index === 0 ? [point[0] === 0 ? 0 : -point[0], point[1]] : [point[0], point[1] === 0 ? 0 : -point[1]];
}
function ccw(points: readonly Point[]): readonly Point[] {
  const twiceArea = points.reduce((area, point, i) => {
    const next = points[(i + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0);
  if (twiceArea === 0) throw new Error("Mirror produces a zero-area contour");
  return twiceArea > 0 ? points : [...points].reverse();
}

/** Copy an open connected chain across its endpoint axis into one polygon.
 * Endpoints must lie exactly on the axis; every interior vertex must be
 * strictly on the same side. Canonical polygon validation remains mandatory. */
export function mirrorLinePoints(points: readonly Point[], axis: SketchLocalAxis): readonly Point[] {
  const index = coordinate(axis);
  if (points.length < 3) throw new Error("Mirror Line requires at least three open chain points");
  if (points[0][index] !== 0 || points[points.length - 1][index] !== 0)
    throw new Error("Mirror Line requires both chain endpoints on the selected axis");
  const interior = points.slice(1, -1);
  if (interior.some(point => point[index] === 0 || Math.sign(point[index]) !== Math.sign(interior[0][index])))
    throw new Error("Mirror Line requires all interior points strictly on one side of the axis");
  const outline = [...points, ...interior.map(point => reflected(point, index)).reverse()];
  if (outline.length > 32) throw new Error("Mirror Line exceeds the 32-vertex polygon limit");
  return ccw(outline);
}

/** Remove the selected edge and all geometry beyond the explicitly kept side.
 * No segment splitting or intersection solving; retain at least two points. */
export function trimLinePoints(points: readonly Point[], edge: number, keep: "start" | "end"): readonly Point[] {
  if (keep !== "start" && keep !== "end") throw new Error("Trim Line keep must be start or end");
  if (!Number.isInteger(edge) || edge < 0 || edge >= points.length - 1) throw new Error("Trim Line requires an existing open chain edge");
  const retained = keep === "start" ? points.slice(0, edge + 1) : points.slice(edge + 1);
  if (retained.length < 2) throw new Error("Trim Line must retain at least two points");
  return retained;
}

/** Reflect a closed polygon's coordinates; reverse ordering to keep CCW.
 * Caller must reject constraints whose indices/intent cannot be remapped. */
export function reflectPolygonPoints(points: readonly Point[], axis: SketchLocalAxis): readonly Point[] {
  const index = coordinate(axis);
  return points.map(point => reflected(point, index)).reverse();
}
