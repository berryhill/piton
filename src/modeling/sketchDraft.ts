import { appendFeatures, assertProfileConstraints, emptyFeatureSource, readFeatures, replaceFeature, type FeatureSource, type PrincipalPlane, type ProfileFeature, type ProfilePlacement, type SketchConstraint } from "./source";
import { principalFrame, resolveWorkplane } from "./workplanes";
import { analyzeSketch, sketchConstraints } from "./sketchConstraints";
import { mirrorLinePoints, reflectPolygonPoints, trimLinePoints, type SketchLocalAxis } from "./sketchOperations";

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
  readonly placement: ProfilePlacement;
  readonly profileId: string;
  readonly position: Point;
  readonly base?: FeatureSource;
}
/** One independent annular dimension extends the bounded circle rank. */
export function analyzeDraftSketch(draft: SketchDraft): ReturnType<typeof analyzeSketch> {
  if (draft.profile?.kind !== "circle" || draft.profile.innerDiameter === undefined) return analyzeSketch(draft);
  assertProfileConstraints(draft.profile);
  const constraints = sketchConstraints(draft.profile);
  const core = analyzeSketch({ ...draft, profile: { ...draft.profile, sketchIntent: { constraints: constraints.filter(c => c.kind !== "dimension" || c.target !== "innerDiameter") } } });
  const remaining = constraints.some(c => c.kind === "fixedProfile" || c.kind === "dimension" && c.target === "innerDiameter") ? 0 : 1;
  const degreesOfFreedom = core.degreesOfFreedom + remaining;
  return { status: degreesOfFreedom ? "underdefined" : "fullyDefined", degreesOfFreedom };
}
export type SketchCommand =
  | { readonly type: "newSketch"; readonly context: SketchContext; readonly draftId: string; readonly plane: PrincipalPlane; readonly profileId?: string; readonly offset?: number; readonly support?: ProfilePlacement["support"]; readonly base?: FeatureSource }
  | { readonly type: "rectangle"; readonly context: SketchContext; readonly width: number; readonly height: number }
  | { readonly type: "circle"; readonly context: SketchContext; readonly diameter: number; readonly innerDiameter?: number }
  | { readonly type: "linePoint"; readonly context: SketchContext; readonly point: Point }
  | { readonly type: "closeLine"; readonly context: SketchContext }
  | { readonly type: "mirrorLine"; readonly context: SketchContext; readonly axis: SketchLocalAxis }
  | { readonly type: "trimLine"; readonly context: SketchContext; readonly edge: number; readonly keep: "start" | "end" }
  | { readonly type: "mirrorReflection"; readonly context: SketchContext; readonly axis: SketchLocalAxis }
  | { readonly type: "dimension"; readonly context: SketchContext; readonly target: "width" | "height" | "diameter" | "innerDiameter" | "vertexX" | "vertexY"; readonly value: number; readonly index?: number }
  | { readonly type: "addConstraint"; readonly context: SketchContext; readonly constraint: SketchConstraint }
  | { readonly type: "removeConstraint"; readonly context: SketchContext; readonly id: string }
  | { readonly type: "move"; readonly context: SketchContext; readonly entityId: string; readonly point: Point; readonly vertex?: number }
  | { readonly type: "deletePoint"; readonly context: SketchContext; readonly entityId: string; readonly vertex: number }
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
function located(profile: SketchProfile, position: Point): SketchProfile {
  if (profile.kind === "polygon") return profile;
  const { origin: _origin, ...rest } = profile;
  return position[0] === 0 && position[1] === 0 ? rest as SketchProfile : { ...rest, origin: validPoint(position) } as SketchProfile;
}
function profilePosition(profile: SketchProfile): Point { return profile.kind === "polygon" ? [0, 0] : profile.origin ?? [0, 0]; }
function validProfile(profile: SketchProfile, base?: FeatureSource): SketchProfile {
  // Reuse the exact canonical source grammar and polygon checks; this does not
  // invoke the solid evaluator or create an authored revision.
  assertProfileConstraints(profile);
  if (base?.source && readFeatures(base).some(f => f.id === profile.id)) replaceFeature(base, profile.id, profile);
  else if (profile.support && !base) {
    // The draft may be previewed without a parent; handoff requires the base.
    const { support: _support, ...unbound } = profile;
    appendFeatures(emptyFeatureSource(), [unbound as SketchProfile]);
  } else appendFeatures(base ?? emptyFeatureSource(), [profile]);
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
    if (!["XY", "XZ", "YZ"].includes(command.plane)) throw new Error("Invalid principal workplane (XY, XZ or YZ)");
    if (!command.context.projectId || !command.context.documentId || !command.draftId) throw new Error("Sketch requires project, document and draft identity");
    const profileId = command.profileId ?? PROFILE_ID;
    const placement: ProfilePlacement = { plane: command.plane, ...(command.offset !== undefined ? { offset: command.offset } : {}), ...(command.support ? { support: command.support } : {}) };
    const probe: SketchProfile = { kind: "rectangle", id: profileId, name: PROFILE_NAME, ...placement, width: 1, height: 1 };
    validProfile(probe, command.base);
    return { status: "drawing", context: { ...command.context }, draftId: command.draftId, generation: 0, profile: null, linePoints: [], placement, profileId, position: [0, 0], ...(command.base ? { base: command.base } : {}) };
  }
  const draft = bound(state, command.context);
  if (command.type === "cancelSketch") return null;
  if (command.type === "finishSketch") {
    if (draft.status !== "drawing" || !draft.profile) throw new Error("Finish Sketch requires a closed supported profile in a drawing sketch");
    validProfile(draft.profile, draft.base);
    return { ...draft, status: "finished" };
  }
  drawing(draft, command.context);
  if (command.type === "rectangle") {
    if (draft.profile && draft.profile.kind !== "rectangle" && sketchConstraints(draft.profile).length) throw new Error("Remove constraints before switching profile kind");
    const retained = draft.profile?.kind === "rectangle" ? draft.profile : undefined;
    const position = retained ? draft.position : [0, 0] as const;
    return updated({ ...draft, position }, validProfile({ kind: "rectangle", id: draft.profileId, name: draft.profile?.name ?? PROFILE_NAME, ...draft.placement,
      ...(retained?.origin ? { origin: retained.origin } : {}), ...(retained?.sketchIntent ? { sketchIntent: retained.sketchIntent } : {}), width: command.width, height: command.height }, draft.base));
  }
  if (command.type === "circle") {
    if (draft.profile && draft.profile.kind !== "circle" && sketchConstraints(draft.profile).length) throw new Error("Remove constraints before switching profile kind");
    const retained = draft.profile?.kind === "circle" ? draft.profile : undefined;
    const position = retained ? draft.position : [0, 0] as const;
    return updated({ ...draft, position }, validProfile({ kind: "circle", id: draft.profileId, name: draft.profile?.name ?? PROFILE_NAME, ...draft.placement,
      ...(retained?.origin ? { origin: retained.origin } : {}), ...(retained?.sketchIntent ? { sketchIntent: retained.sketchIntent } : {}), diameter: command.diameter,
      ...(command.innerDiameter !== undefined ? { innerDiameter: command.innerDiameter } : {}) }, draft.base));
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
    const profile = validProfile({ kind: "polygon", id: draft.profileId, name: PROFILE_NAME, ...draft.placement, vertices: draft.linePoints }, draft.base);
    return updated(draft, profile);
  }
  if (command.type === "mirrorLine") {
    if (draft.profile) throw new Error("Mirror Line requires an open Line chain, not a closed profile");
    const vertices = mirrorLinePoints(draft.linePoints, command.axis);
    const profile = validProfile({ kind: "polygon", id: draft.profileId, name: PROFILE_NAME, ...draft.placement, vertices }, draft.base);
    return updated(draft, profile);
  }
  if (command.type === "trimLine") {
    if (draft.profile) throw new Error("Trim Line requires an open Line chain; closed contour trim is unsupported");
    return updated(draft, null, trimLinePoints(draft.linePoints, command.edge, command.keep));
  }
  if (command.type === "mirrorReflection") {
    if (draft.profile?.kind !== "polygon") throw new Error("Mirror Reflection requires a closed polygon profile");
    if (sketchConstraints(draft.profile).length) throw new Error("Mirror Reflection cannot preserve indexed constraint intent; remove constraints first");
    return updated(draft, validProfile({ ...draft.profile, vertices: reflectPolygonPoints(draft.profile.vertices, command.axis) }, draft.base));
  }
  if (command.type === "deletePoint") {
    if (command.entityId !== draft.profileId) throw new Error("Unknown sketch entity");
    const points = draft.profile?.kind === "polygon" ? draft.profile.vertices : draft.linePoints;
    if (!Number.isInteger(command.vertex) || command.vertex < 0 || command.vertex >= points.length) throw new Error("Invalid vertex index");
    if (draft.profile?.sketchIntent?.constraints.length) throw new Error("Remove dependent constraints before deleting a vertex");
    const remaining = points.filter((_, i) => i !== command.vertex);
    return draft.profile?.kind === "polygon" ? updated(draft, validProfile({ ...draft.profile, vertices: remaining }, draft.base)) : updated(draft, null, remaining);
  }
  const profile = draft.profile;
  if (!profile) throw new Error("Dimension requires a supported closed profile");
  const constraints = sketchConstraints(profile);
  if (command.type === "removeConstraint") {
    if (!constraints.some(c => c.id === command.id)) throw new Error("Unknown constraint ID");
    return updated(draft, validProfile({ ...profile, sketchIntent: { constraints: constraints.filter(c => c.id !== command.id) } }, draft.base));
  }
  if (command.type === "addConstraint") {
    const supplied = command.constraint;
    const c: SketchConstraint = supplied.kind === "fixedPoint" && profile.kind === "polygon" && Number.isInteger(supplied.vertex) && supplied.vertex >= 0 && supplied.vertex < profile.vertices.length
      ? { ...supplied, point: validPoint(profile.vertices[supplied.vertex]) } : supplied;
    if (c.kind === "dimension" && !Number.isFinite(c.value)) throw new Error("Dimension must be finite");
    let next: SketchProfile = profile;
    let position = draft.position;
    if (c.kind === "origin") {
      if (profile.kind === "polygon") next = { ...profile, vertices: profile.vertices.map((v, i) => i === 0 ? [0, 0] : v) };
      else position = [0, 0];
    } else if (c.kind === "horizontal" || c.kind === "vertical") {
      if (profile.kind !== "polygon" || !Number.isInteger(c.edge) || c.edge < 0 || c.edge >= profile.vertices.length) throw new Error("Unsupported polygon edge");
      const nextIndex = (c.edge + 1) % profile.vertices.length;
      next = { ...profile, vertices: profile.vertices.map((v, i) => i !== nextIndex ? v :
        c.kind === "horizontal" ? [v[0], profile.vertices[c.edge][1]] : [profile.vertices[c.edge][0], v[1]]) };
    } else if (c.kind === "dimension") {
      if (c.target === "centerX" || c.target === "centerY") position = validPoint(c.target === "centerX" ? [c.value, position[1]] : [position[0], c.value]);
      else if (profile.kind === "rectangle" && (c.target === "width" || c.target === "height")) next = { ...profile, [c.target]: c.value };
      else if (profile.kind === "circle" && (c.target === "diameter" || c.target === "innerDiameter")) next = { ...profile, [c.target]: c.value };
      else if (profile.kind === "polygon" && (c.target === "vertexX" || c.target === "vertexY") && c.vertex !== undefined) next = { ...profile, vertices: profile.vertices.map((v, i) => i !== c.vertex ? v : c.target === "vertexX" ? [c.value, v[1]] : [v[0], c.value]) };
      else throw new Error("Unsupported dimension target");
    }
    if (profile.kind === "polygon" && next.kind === "polygon") for (const fixed of constraints) if (fixed.kind === "fixedPoint" &&
      (next.vertices[fixed.vertex][0] !== profile.vertices[fixed.vertex][0] || next.vertices[fixed.vertex][1] !== profile.vertices[fixed.vertex][1])) throw new Error("Constraint conflicts with fixed vertex");
    next = { ...located(next, position), sketchIntent: { constraints: [...constraints, c] } };
    validProfile(next, draft.base);
    return { ...updated(draft, next), position };
  }
  if (command.type === "move") {
    if (command.entityId !== draft.profileId) throw new Error("Unknown sketch entity");
    const point = validPoint(command.point);
    if (profile.kind !== "polygon") {
      if (command.vertex !== undefined) throw new Error("Shape does not have editable vertices");
      if (constraints.some(c => c.kind === "fixedProfile" || c.kind === "origin" || c.kind === "dimension" && (c.target === "centerX" && c.value !== point[0] || c.target === "centerY" && c.value !== point[1]))) throw new Error("Constrained profile cannot move inconsistently");
      const next = validProfile(located(profile, point), draft.base);
      return { ...updated(draft, next), position: point };
    }
    if (!Number.isInteger(command.vertex) || command.vertex! < 0 || command.vertex! >= profile.vertices.length) throw new Error("Invalid vertex index");
    const index = command.vertex!;
    if (constraints.some(c => c.kind === "fixedPoint" && c.vertex === index || c.kind === "origin" && index === 0)) throw new Error("Fixed vertex cannot move");
    const vertices = profile.vertices.map((v, i) => i === index ? point : v);
    // Equality relations propagate to the other endpoint. Reject changes to
    // fixed/driven coordinates rather than silently invalidating constraints.
    for (const c of constraints) if ((c.kind === "horizontal" || c.kind === "vertical") && (c.edge === index || (c.edge + 1) % vertices.length === index)) {
      const other = c.edge === index ? (index + 1) % vertices.length : c.edge;
      const axis = c.kind === "horizontal" ? 1 : 0;
      vertices[other] = axis === 0 ? [point[0], vertices[other][1]] : [vertices[other][0], point[1]];
    }
    for (let i = 0; i < vertices.length; i++) if (vertices[i][0] !== profile.vertices[i][0] || vertices[i][1] !== profile.vertices[i][1]) {
      if (i !== index && constraints.some(c => c.kind === "fixedPoint" && c.vertex === i || c.kind === "origin" && i === 0)) throw new Error("Propagation conflicts with fixed vertex");
    }
    return updated(draft, validProfile({ ...profile, vertices }, draft.base));
  }
  if (command.type !== "dimension") throw new Error("Unsupported sketch command");
  const { target, value } = command;
  let edited: SketchProfile;
  if (profile.kind === "rectangle" && (target === "width" || target === "height")) edited = { ...profile, [target]: value };
  else if (profile.kind === "circle" && (target === "diameter" || target === "innerDiameter") && (target !== "innerDiameter" || profile.innerDiameter !== undefined)) edited = { ...profile, [target]: value };
  else if (profile.kind === "polygon" && (target === "vertexX" || target === "vertexY")) {
    if (!Number.isInteger(command.index) || command.index! < 0 || command.index! >= profile.vertices.length) throw new Error("Dimension requires an existing vertex index");
    const vertices = profile.vertices.map((point, index) => index === command.index
      ? validPoint(target === "vertexX" ? [value, point[1]] : [point[0], value]) : point);
    edited = { ...profile, vertices };
  } else throw new Error("Dimension target is unsupported for this profile");
  if (constraints.some(c => c.kind === "fixedProfile" || c.kind === "fixedPoint" && profile.kind === "polygon" && c.vertex === command.index && (target === "vertexX" || target === "vertexY"))) throw new Error("Fixed geometry cannot be dimensioned inconsistently");
  const driver = constraints.find(c => c.kind === "dimension" && c.target === target && c.vertex === (command.index ?? undefined));
  if (driver) edited = { ...edited, sketchIntent: { constraints: constraints.map(c => c === driver ? { ...driver, value } as SketchConstraint : c) } };
  return updated(draft, validProfile(edited, draft.base));
}

export type SketchPreview = Readonly<{
  context: SketchContext; draftId: string; generation: number; plane: PrincipalPlane;
  frame: ReturnType<typeof principalFrame>;
  outline?: readonly Point[];
  claimScope: "sketch-only"; reviewState: "needs_human_review";
  fabricationRelease: false; machineActuation: false;
} & (
  | { kind: "line"; closed: false; outline: readonly Point[] }
  | { kind: "rectangle" | "polygon"; closed: true; outline: readonly Point[]; width?: number; height?: number }
  | { kind: "circle"; closed: true; center: Point; diameter: number; innerDiameter?: number }
)>;

/** Lightweight 2D data for a UI overlay; no Manifold/solid evaluation. */
export function sketchPreview(state: SketchDraft | null, context: SketchContext): SketchPreview | null {
  if (!state) return null;
  const draft = bound(state, context);
  const earlier = draft.base ? readFeatures(draft.base).filter(f => f.id !== draft.profileId) : [];
  const frame = draft.profile ? resolveWorkplane(draft.profile, earlier) :
    resolveWorkplane({ kind: "rectangle", id: draft.profileId, name: PROFILE_NAME, ...draft.placement, width: 1, height: 1 }, earlier);
  const common = { context: draft.context, draftId: draft.draftId, generation: draft.generation, plane: draft.placement.plane, frame,
    claimScope: "sketch-only" as const, reviewState: "needs_human_review" as const, fabricationRelease: false as const, machineActuation: false as const };
  const profile = draft.profile;
  if (!profile) return draft.linePoints.length ? { ...common, kind: "line", closed: false, outline: draft.linePoints } : null;
  if (profile.kind === "circle") return { ...common, kind: "circle", closed: true, center: profilePosition(profile), diameter: profile.diameter,
    ...(profile.innerDiameter !== undefined ? { innerDiameter: profile.innerDiameter } : {}) };
  if (profile.kind === "rectangle") return { ...common, kind: "rectangle", closed: true, width: profile.width, height: profile.height,
    outline: [[profilePosition(profile)[0], profilePosition(profile)[1]], [profilePosition(profile)[0] + profile.width, profilePosition(profile)[1]], [profilePosition(profile)[0] + profile.width, profilePosition(profile)[1] + profile.height], [profilePosition(profile)[0], profilePosition(profile)[1] + profile.height]] };
  return { ...common, kind: "polygon", closed: true, outline: profile.vertices };
}

/** Explicit handoff to the existing preview/proposal path. Profile-only source
 * is not a committed solid; a supported body must be added before proposal. */
export function sketchSource(state: SketchDraft | null, context: SketchContext, effectiveBase?: FeatureSource): FeatureSource {
  const draft = bound(state, context);
  if (draft.status !== "finished" || !draft.profile) throw new Error("Only a finished sketch can produce canonical source");

  const base = effectiveBase ?? draft.base;
  if (draft.profile.support && !base) throw new Error("Named cap sketch requires effective base source");
  if (draft.base && base?.source !== draft.base.source) throw new Error("Stale effective base source; reopen sketch against current revision");
  const existing = base ? readFeatures(base) : [];
  return existing.some(f => f.id === draft.profile!.id) ? replaceFeature(base!, draft.profile.id, draft.profile) : appendFeatures(base ?? emptyFeatureSource(), [draft.profile]);
}

/** Reopen one authored profile as a transient drawing, never as another authority. */
export function reopenSketchProfile(base: FeatureSource, profileId: string, context: SketchContext, draftId: string): SketchDraft {
  const feature = readFeatures(base).find(f => f.id === profileId);
  if (!feature || (feature.kind !== "rectangle" && feature.kind !== "circle" && feature.kind !== "polygon")) throw new Error("Unknown sketch profile");
  if (!draftId || !context.projectId || !context.documentId) throw new Error("Sketch requires project, document and draft identity");
  return { status: "drawing", context: { ...context }, draftId, generation: 0, profile: feature,
    linePoints: [], placement: { plane: feature.plane, ...(feature.offset !== undefined ? { offset: feature.offset } : {}), ...(feature.support ? { support: feature.support } : {}) },
    profileId: feature.id, position: profilePosition(feature), base };
}
