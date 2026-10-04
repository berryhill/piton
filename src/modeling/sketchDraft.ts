import { appendFeatures, emptyFeatureSource, type FeatureSource, type ProfileFeature } from "./source";

/** UI-only state. Never store this alongside an authored revision or treat a
 * sketch-only preview as a solid evaluation / commit receipt. */
export interface SketchContext {
  readonly projectId: string;
  readonly documentId: string;
  readonly revisionId: string | null;
}
export type Point = readonly [number, number];
export type SketchProfile = ProfileFeature;
export interface SketchDraft {
  readonly status: "drawing" | "finished";
  readonly context: SketchContext;
  readonly draftId: string;
  /** Changes on every geometry edit; consumers must drop older previews. */
  readonly generation: number;
  readonly profile: SketchProfile | null;
  readonly linePoints: readonly Point[];
}
export type SketchCommand =
  | { readonly type: "newSketch"; readonly context: SketchContext; readonly draftId: string; readonly plane: "XY" }
  | { readonly type: "rectangle"; readonly context: SketchContext; readonly width: number; readonly height: number }
  | { readonly type: "circle"; readonly context: SketchContext; readonly diameter: number }
  | { readonly type: "linePoint"; readonly context: SketchContext; readonly point: Point }
  | { readonly type: "closeLine"; readonly context: SketchContext }
  | { readonly type: "dimension"; readonly context: SketchContext; readonly target: "width" | "height" | "diameter" | "vertexX" | "vertexY"; readonly value: number; readonly index?: number }
  | { readonly type: "finishSketch"; readonly context: SketchContext }
  | { readonly type: "cancelSketch"; readonly context: SketchContext };
type CancelSketch = Extract<SketchCommand, { type: "cancelSketch" }>;

const PROFILE_ID = "sketchProfile";
const PROFILE_NAME = "Sketch profile";
function sameContext(a: SketchContext, b: SketchContext): boolean {
  return a.projectId === b.projectId && a.documentId === b.documentId && a.revisionId === b.revisionId;
}
function bound(state: SketchDraft | null, context: SketchContext): SketchDraft {
  if (!state) throw new Error("No active sketch draft");
  if (!sameContext(state.context, context)) throw new Error("Stale sketch context; discard or reopen against the current document revision");
  return state;
}
function drawing(state: SketchDraft | null, context: SketchContext): SketchDraft {
  const draft = bound(state, context);
  if (draft.status !== "drawing") throw new Error("Sketch is not drawing; start a new sketch");
  return draft;
}
function validPoint(point: Point): Point {
  if (!Array.isArray(point) || point.length !== 2 || point.some(v => typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1000))
    throw new Error("Line point must be a finite XY coordinate within +/-1000 mm");
  return Object.freeze([point[0], point[1]] as const);
}
function validProfile(profile: SketchProfile): SketchProfile {
  // Reuse the exact canonical source grammar and polygon checks; this does not
  // invoke the solid evaluator or create an authored revision.
  appendFeatures(emptyFeatureSource(), [profile]);
  return profile;
}
function updated(state: SketchDraft, profile: SketchProfile | null, linePoints: readonly Point[] = []): SketchDraft {
  return { ...state, profile, linePoints, generation: state.generation + 1 };
}

/** Pure reducer: the caller owns document-local lifetime and invalidates any
 * dependent solid proposal when the returned generation changes or is null. */
export function reduceSketchDraft(state: SketchDraft | null, command: CancelSketch): null;
export function reduceSketchDraft(state: SketchDraft | null, command: Exclude<SketchCommand, CancelSketch>): SketchDraft;
export function reduceSketchDraft(state: SketchDraft | null, command: SketchCommand): SketchDraft | null {
  if (command.type === "newSketch") {
    if (state) throw new Error("An active sketch draft must be cancelled before New Sketch");
    if (command.plane !== "XY") throw new Error("Only the XY reference plane is supported");
    if (!command.context.projectId || !command.context.documentId || !command.draftId) throw new Error("Sketch requires project, document and draft identity");
    return { status: "drawing", context: { ...command.context }, draftId: command.draftId, generation: 0, profile: null, linePoints: [] };
  }
  const draft = bound(state, command.context);
  if (command.type === "cancelSketch") return null;
  if (command.type === "finishSketch") {
    if (draft.status !== "drawing" || !draft.profile) throw new Error("Finish Sketch requires a closed supported profile in a drawing sketch");
    validProfile(draft.profile);
    return { ...draft, status: "finished" };
  }
  drawing(draft, command.context);
  if (command.type === "rectangle") {
    return updated(draft, validProfile({ kind: "rectangle", id: PROFILE_ID, name: PROFILE_NAME, plane: "XY", width: command.width, height: command.height }));
  }
  if (command.type === "circle") {
    return updated(draft, validProfile({ kind: "circle", id: PROFILE_ID, name: PROFILE_NAME, plane: "XY", diameter: command.diameter }));
  }
  if (command.type === "linePoint") {
    if (draft.profile) throw new Error("Clear the profile with a new tool before adding Line points");
    if (draft.linePoints.length >= 32) throw new Error("Line polygon is limited to 32 vertices");
    const point = validPoint(command.point);
    if (draft.linePoints.some(v => v[0] === point[0] && v[1] === point[1])) throw new Error("Line polygon cannot contain duplicate vertices or a duplicate closing point");
    return updated(draft, null, [...draft.linePoints, point]);
  }
  if (command.type === "closeLine") {
    if (draft.profile) throw new Error("Line profile is already closed or another profile is active");
    const profile = validProfile({ kind: "polygon", id: PROFILE_ID, name: PROFILE_NAME, plane: "XY", vertices: draft.linePoints });
    return updated(draft, profile);
  }
  const profile = draft.profile;
  if (!profile) throw new Error("Dimension requires a supported closed profile");
  const { target, value } = command;
  let edited: SketchProfile;
  if (profile.kind === "rectangle" && (target === "width" || target === "height")) edited = { ...profile, [target]: value };
  else if (profile.kind === "circle" && target === "diameter") edited = { ...profile, diameter: value };
  else if (profile.kind === "polygon" && (target === "vertexX" || target === "vertexY")) {
    if (!Number.isInteger(command.index) || command.index! < 0 || command.index! >= profile.vertices.length) throw new Error("Dimension requires an existing vertex index");
    const vertices = profile.vertices.map((point, index) => index === command.index
      ? validPoint(target === "vertexX" ? [value, point[1]] : [point[0], value]) : point);
    edited = { ...profile, vertices };
  } else throw new Error("Dimension target is unsupported for this profile");
  return updated(draft, validProfile(edited));
}

export type SketchPreview = Readonly<{
  context: SketchContext; draftId: string; generation: number; plane: "XY";
  outline?: readonly Point[];
  claimScope: "sketch-only"; reviewState: "needs_human_review";
  fabricationRelease: false; machineActuation: false;
} & (
  | { kind: "line"; closed: false; outline: readonly Point[] }
  | { kind: "rectangle" | "polygon"; closed: true; outline: readonly Point[]; width?: number; height?: number }
  | { kind: "circle"; closed: true; center: Point; diameter: number }
)>;

/** Lightweight 2D data for a UI overlay; no Manifold/solid evaluation. */
export function sketchPreview(state: SketchDraft | null, context: SketchContext): SketchPreview | null {
  if (!state) return null;
  const draft = bound(state, context);
  const common = { context: draft.context, draftId: draft.draftId, generation: draft.generation, plane: "XY" as const,
    claimScope: "sketch-only" as const, reviewState: "needs_human_review" as const, fabricationRelease: false as const, machineActuation: false as const };
  const profile = draft.profile;
  if (!profile) return draft.linePoints.length ? { ...common, kind: "line", closed: false, outline: draft.linePoints } : null;
  if (profile.kind === "circle") return { ...common, kind: "circle", closed: true, center: [0, 0], diameter: profile.diameter };
  if (profile.kind === "rectangle") return { ...common, kind: "rectangle", closed: true, width: profile.width, height: profile.height,
    outline: [[0, 0], [profile.width, 0], [profile.width, profile.height], [0, profile.height]] };
  return { ...common, kind: "polygon", closed: true, outline: profile.vertices };
}

/** Explicit handoff to the existing preview/proposal path. Profile-only source
 * is not a committed solid; a supported body must be added before proposal. */
export function sketchSource(state: SketchDraft | null, context: SketchContext): FeatureSource {
  const draft = bound(state, context);
  if (draft.status !== "finished" || !draft.profile) throw new Error("Only a finished sketch can produce canonical source");
  return appendFeatures(emptyFeatureSource(), [draft.profile]);
}
