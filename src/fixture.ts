import { R14_ASSEMBLY } from "./assembly";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import {
  createFixtureRequestSession,
  detachFixtureReviewContext,
  prepareLocalChangeRequestDraft,
} from "./change-request";
import type {
  FixtureContextEntityKind,
  FixtureRequestSession,
} from "./change-request";

export type FixtureDocumentId =
  | "base-plate.part"
  | "clamp-jaw.part"
  | "guide-pin.part"
  | "bench-clamp.assembly";
export type FixtureDocumentKind = "part" | "assembly";
export type FixtureSelectionMode = "smart" | "face" | "component";
export type FixtureViewPreset = "iso" | "front" | "top";
export type FixtureCommandCategory = "features" | "sketch" | "assembly" | "mates" | "inspect";
export type FixtureTreeNodeKind = "document" | "origin" | "plane" | "body" | "feature" | "review-surfaces" | "review-surface" | "components" | "occurrence" | "source-reference" | "mates" | "mate";

export interface FixtureTreeNode {
  readonly id: string;
  readonly label: string;
  readonly kind: FixtureTreeNodeKind;
  readonly children: readonly FixtureTreeNode[];
  readonly sourceDocumentId?: Exclude<FixtureDocumentId, "bench-clamp.assembly">;
}

export interface FixtureReviewCommandRequest {
  readonly expectedDocumentId: FixtureDocumentId;
  readonly category: FixtureCommandCategory;
  readonly command: "measure" | "clear-measurement" | "open-part";
  readonly selectionId?: string;
}

type Vector3 = [number, number, number];

export interface FixtureDocument {
  readonly id: FixtureDocumentId;
  readonly fileName: string;
  readonly kind: FixtureDocumentKind;
  readonly parameters: Readonly<Record<string, number>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface FixtureDocumentState {
  readonly selection: string | null;
  readonly selectionMode: FixtureSelectionMode;
  readonly viewPreset: FixtureViewPreset;
  readonly commandCategory: FixtureCommandCategory;
  readonly treeExpandedIds: readonly string[];
  readonly treeFocusId: string | null;
  readonly approximateSourceVisible: boolean;
  readonly measurement: Readonly<{
    phase: "idle" | "endpoint-a" | "complete";
    endpointA?: Vector3;
    endpointB?: Vector3;
    hoverEndpoint?: Vector3 | null;
  }>;
  readonly reviewMeasurementMm: number | null;
  readonly stl: Readonly<{
    state: "idle" | "building" | "ready" | "failed";
    artifactId?: string;
    filename?: string;
    byteLength?: number;
    facetCount?: number;
    cadZMinMm?: number;
    message?: string;
  }>;
  readonly camera: Readonly<{ position: Vector3; target: Vector3; up: Vector3 }>;
}

export interface FixtureSession {
  readonly openDocumentIds: readonly FixtureDocumentId[];
  readonly activeDocumentId: FixtureDocumentId;
  readonly documentStates: Readonly<Record<FixtureDocumentId, FixtureDocumentState>>;
  readonly requestSession: FixtureRequestSession;
}

const DOCUMENTS: readonly FixtureDocument[] = [
  {
    id: "base-plate.part",
    fileName: "Base Plate.part",
    kind: "part",
    parameters: {
      width_mm: 120,
      depth_mm: 80,
      thickness_mm: 12,
      corner_radius_mm: 8,
      hole_diameter_mm: 9,
      hole_inset_mm: 14,
    },
    metadata: { hole_centers_mm: [[-46, -26], [-46, 26], [46, -26], [46, 26]] },
  },
  {
    id: "clamp-jaw.part",
    fileName: "Clamp Jaw.part",
    kind: "part",
    parameters: { width_mm: 30, depth_mm: 28, height_mm: 45, foot_width_mm: 46, foot_height_mm: 8 },
  },
  {
    id: "guide-pin.part",
    fileName: "Guide Pin.part",
    kind: "part",
    parameters: { diameter_mm: 10, height_mm: 48, head_diameter_mm: 18, head_height_mm: 5 },
  },
  {
    id: "bench-clamp.assembly",
    fileName: "Bench Clamp.assembly",
    kind: "assembly",
    parameters: { instance_count: 4 },
  },
] as const;

export const R14_FIXTURE = Object.freeze({
  id: "bench-clamp-fixture",
  name: "Bench Clamp Fixture",
  kind: "container",
  fileTypes: ["part", "assembly"] as const,
  documents: DOCUMENTS,
  claimScope: "Static fixture metadata and review-interaction evidence only; not exact-kernel realization, exact topology, fabrication suitability, approval, export, or release.",
});

const INITIAL_OPEN_DOCUMENT_IDS: readonly FixtureDocumentId[] = ["base-plate.part", "bench-clamp.assembly"];
const INITIAL_ACTIVE_DOCUMENT_ID: FixtureDocumentId = "bench-clamp.assembly";

function defaultDocumentState(documentId: FixtureDocumentId): FixtureDocumentState {
  return {
    selection: null,
    selectionMode: "smart",
    viewPreset: "iso",
    commandCategory: "inspect",
    treeExpandedIds: documentId === "bench-clamp.assembly"
      ? [`document:${documentId}`, "assembly:components", "assembly:mates"]
      : [`document:${documentId}`, `${documentId}:origin`, `${documentId}:body`],
    treeFocusId: `document:${documentId}`,
    approximateSourceVisible: false,
    measurement: { phase: "idle" },
    reviewMeasurementMm: null,
    stl: { state: "idle" },
    camera: { position: [150, -150, 120], target: [0, 0, 20], up: [0, 0, 1] },
  };
}

function allDocumentStates(): Record<FixtureDocumentId, FixtureDocumentState> {
  return Object.fromEntries(DOCUMENTS.map((document) => [document.id, defaultDocumentState(document.id)])) as Record<FixtureDocumentId, FixtureDocumentState>;
}

export function createFixtureSession(): FixtureSession {
  return {
    openDocumentIds: [...INITIAL_OPEN_DOCUMENT_IDS],
    activeDocumentId: INITIAL_ACTIVE_DOCUMENT_ID,
    documentStates: allDocumentStates(),
    requestSession: createFixtureRequestSession(),
  };
}

function requireDocument(id: FixtureDocumentId): void {
  if (!DOCUMENTS.some((document) => document.id === id)) throw new Error(`unknown fixture document: ${id}`);
}

function clearTransientMeasurementPreview(state: FixtureDocumentState): FixtureDocumentState {
  if (state.measurement.hoverEndpoint == null) return state;
  return { ...state, measurement: { ...state.measurement, hoverEndpoint: null } };
}

export function openFixtureDocument(session: FixtureSession, id: FixtureDocumentId): FixtureSession {
  requireDocument(id);
  const withOpenDocument = session.openDocumentIds.includes(id)
    ? session.openDocumentIds
    : [...session.openDocumentIds, id];
  return activateFixtureDocument({ ...session, openDocumentIds: withOpenDocument }, id);
}

export function activateFixtureDocument(session: FixtureSession, id: FixtureDocumentId): FixtureSession {
  requireDocument(id);
  if (!session.openDocumentIds.includes(id)) throw new Error(`fixture document is not open: ${id}`);
  const outgoingId = session.activeDocumentId;
  return {
    ...session,
    activeDocumentId: id,
    documentStates: {
      ...session.documentStates,
      [outgoingId]: clearTransientMeasurementPreview(session.documentStates[outgoingId]),
    },
  };
}

export function closeFixtureDocument(session: FixtureSession, id: FixtureDocumentId): FixtureSession {
  requireDocument(id);
  const closingIndex = session.openDocumentIds.indexOf(id);
  if (closingIndex < 0) return session;
  const remaining = session.openDocumentIds.filter((documentId) => documentId !== id);
  if (remaining.length === 0) return { ...createFixtureSession(), requestSession: session.requestSession };
  if (session.activeDocumentId !== id) return { ...session, openDocumentIds: remaining };
  const neighborIndex = Math.min(closingIndex, remaining.length - 1);
  return { ...session, openDocumentIds: remaining, activeDocumentId: remaining[neighborIndex] };
}

type FixtureDocumentViewUpdate = Partial<Pick<FixtureDocumentState,
  "selectionMode" | "viewPreset" | "approximateSourceVisible" | "stl" | "camera"
>>;

function replaceActiveDocumentState(
  session: FixtureSession,
  update: (state: FixtureDocumentState) => FixtureDocumentState,
): FixtureSession {
  const activeId = session.activeDocumentId;
  const current = session.documentStates[activeId];
  const next = update(current);
  return {
    ...session,
    documentStates: { ...session.documentStates, [activeId]: next },
  };
}

export function updateFixtureDocumentView(
  session: FixtureSession,
  expectedDocumentId: FixtureDocumentId,
  update: FixtureDocumentViewUpdate,
): FixtureSession {
  if (session.activeDocumentId !== expectedDocumentId) throw new Error("stale or inactive fixture document context");
  const allowed = new Set(["selectionMode", "viewPreset", "approximateSourceVisible", "stl", "camera"]);
  if (Object.keys(update).some((key) => !allowed.has(key))) throw new Error("protected fixture review state requires an admitted command");
  return replaceActiveDocumentState(session, (current) => {
    const requested = { ...current, ...update };
    return requested.selectionMode === "component" && fixtureDocument(expectedDocumentId).kind === "part"
      ? { ...requested, selectionMode: current.selectionMode }
      : requested;
  });
}

export function clearFixtureReviewMeasurement(session: FixtureSession, expectedDocumentId: FixtureDocumentId): FixtureSession {
  if (session.activeDocumentId !== expectedDocumentId) throw new Error("stale or inactive fixture document context");
  return replaceActiveDocumentState(session, (state) => ({ ...state, reviewMeasurementMm: null, measurement: { phase: "idle" } }));
}

export function fixtureDocument(id: FixtureDocumentId): FixtureDocument {
  requireDocument(id);
  return DOCUMENTS.find((document) => document.id === id)!;
}

const EMPTY_CHILDREN: readonly FixtureTreeNode[] = Object.freeze([]);
const PART_FEATURES: Readonly<Record<Exclude<FixtureDocumentId, "bench-clamp.assembly">, readonly string[]>> = {
  "base-plate.part": ["Sketch 1", "Extrude 1", "Sketch 2", "Hole Pattern 1"],
  "clamp-jaw.part": ["Sketch 1", "Extrude 1"],
  "guide-pin.part": ["Sketch 1", "Revolve 1"],
};
const PART_SURFACES: Readonly<Record<Exclude<FixtureDocumentId, "bench-clamp.assembly">, readonly [string, string][]>> = {
  "base-plate.part": [["face:top", "Top review face"], ["face:bottom", "Bottom review face"], ["face:outer-wall", "Outer wall review face"], ["face:hole-wall:1", "Hole wall 1"], ["face:hole-wall:2", "Hole wall 2"], ["face:hole-wall:3", "Hole wall 3"], ["face:hole-wall:4", "Hole wall 4"]],
  "clamp-jaw.part": [["face:jaw-top", "Jaw top review face"], ["face:jaw-base", "Jaw base review face"], ["face:jaw-grip", "Jaw grip review face"]],
  "guide-pin.part": [["face:pin-shaft", "Pin shaft review face"], ["face:pin-base", "Pin base review face"], ["face:pin-top", "Pin top review face"]],
};

function leaf(id: string, label: string, kind: FixtureTreeNodeKind, sourceDocumentId?: Exclude<FixtureDocumentId, "bench-clamp.assembly">): FixtureTreeNode {
  return { id, label, kind, children: EMPTY_CHILDREN, ...(sourceDocumentId ? { sourceDocumentId } : {}) };
}

function partTree(documentId: Exclude<FixtureDocumentId, "bench-clamp.assembly">): readonly FixtureTreeNode[] {
  const document = fixtureDocument(documentId);
  const origin: FixtureTreeNode = {
    id: `${documentId}:origin`, label: "Origin", kind: "origin", children: [
      leaf("plane:front", "Front plane", "plane"),
      leaf("plane:top", "Top plane", "plane"),
      leaf("plane:right", "Right plane", "plane"),
    ],
  };
  const reviewSurfaces: FixtureTreeNode = {
    id: `${documentId}:review-surfaces`, label: "Review surfaces", kind: "review-surfaces",
    children: PART_SURFACES[documentId].map(([id, label]) => leaf(id, label, "review-surface")),
  };
  const body: FixtureTreeNode = {
    id: `${documentId}:body`, label: "Body", kind: "body", children: [
      ...PART_FEATURES[documentId].map((label, index) => leaf(`${documentId}:feature:${index + 1}`, label, "feature")),
      reviewSurfaces,
    ],
  };
  return [{ id: `document:${documentId}`, label: document.fileName, kind: "document", children: [origin, body] }];
}

function assemblyTree(): readonly FixtureTreeNode[] {
  const occurrenceNodes = R14_ASSEMBLY.occurrences.map((occurrence): FixtureTreeNode => ({
    id: occurrence.id,
    label: `${occurrence.label}${occurrence.fixed ? " (Fixed)" : ""}`,
    kind: "occurrence",
    sourceDocumentId: occurrence.sourceDocumentId,
    children: [
      leaf(`association:${occurrence.id}:source`, `Source · ${fixtureDocument(occurrence.sourceDocumentId).fileName}`, "source-reference", occurrence.sourceDocumentId),
      ...R14_ASSEMBLY.contextualFaces
        .filter(({ occurrenceId }) => occurrenceId === occurrence.id)
        .map((face) => leaf(face.id, `Contextual review surface · ${face.sourceFaceId}`, "review-surface", face.sourceDocumentId)),
    ],
  }));
  return [{
    id: "document:bench-clamp.assembly", label: "Bench Clamp.assembly", kind: "document", children: [
      { id: "assembly:components", label: "Components", kind: "components", children: occurrenceNodes },
      {
        id: "assembly:mates", label: "Mates", kind: "mates", children: R14_ASSEMBLY.relationships.map((relationship) =>
          leaf(relationship.id, `${relationship.label} · ${relationship.status}`, "mate")),
      },
    ],
  }];
}

export function fixtureModelTree(documentId: FixtureDocumentId): readonly FixtureTreeNode[] {
  requireDocument(documentId);
  return documentId === "bench-clamp.assembly" ? assemblyTree() : partTree(documentId);
}

export function flattenFixtureTree(nodes: readonly FixtureTreeNode[]): readonly FixtureTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenFixtureTree(node.children)]);
}

export function fixtureCommandCategories(documentId: FixtureDocumentId): readonly FixtureCommandCategory[] {
  return fixtureDocument(documentId).kind === "part"
    ? ["features", "sketch", "inspect"]
    : ["assembly", "mates", "inspect"];
}

export function setFixtureCommandCategory(
  session: FixtureSession,
  expectedDocumentId: FixtureDocumentId,
  category: FixtureCommandCategory,
): FixtureSession {
  if (session.activeDocumentId !== expectedDocumentId) throw new Error("stale or inactive fixture document context");
  if (!fixtureCommandCategories(expectedDocumentId).includes(category)) throw new Error(`command category ${category} is not admitted for ${fixtureDocument(expectedDocumentId).kind}`);
  return replaceActiveDocumentState(session, (state) => ({ ...state, commandCategory: category }));
}

export function setFixtureTreeInteraction(
  session: FixtureSession,
  expectedDocumentId: FixtureDocumentId,
  update: Readonly<{ expandedIds?: readonly string[]; focusId?: string | null; selectionId?: string | null }>,
): FixtureSession {
  if (session.activeDocumentId !== expectedDocumentId) throw new Error("stale or inactive fixture document context");
  const nodeIds = new Set(flattenFixtureTree(fixtureModelTree(expectedDocumentId)).map(({ id }) => id));
  if (update.expandedIds?.some((id) => !nodeIds.has(id))) throw new Error("unknown tree expansion identity");
  if (update.focusId != null && !nodeIds.has(update.focusId)) throw new Error("unknown tree focus identity");
  if (update.selectionId != null && !nodeIds.has(update.selectionId)) throw new Error("unknown tree selection identity");
  const current = session.documentStates[expectedDocumentId];
  if (update.selectionId !== undefined && current.commandCategory !== "inspect") throw new Error("tree selection requires Inspect category");
  return replaceActiveDocumentState(session, (state) => ({
    ...state,
    ...(update.expandedIds ? { treeExpandedIds: [...update.expandedIds] } : {}),
    ...(update.focusId !== undefined ? { treeFocusId: update.focusId } : {}),
    ...(update.selectionId !== undefined ? {
      selection: state.selection === update.selectionId ? null : update.selectionId,
      reviewMeasurementMm: null,
    } : {}),
  }));
}

export function setFixtureViewportSelection(
  session: FixtureSession,
  expectedDocumentId: FixtureDocumentId,
  selectionId: string,
): FixtureSession {
  if (session.activeDocumentId !== expectedDocumentId) throw new Error("stale or inactive fixture document context");
  if (session.documentStates[expectedDocumentId].commandCategory !== "inspect") throw new Error("viewport selection requires Inspect category");
  const nodeIds = new Set(flattenFixtureTree(fixtureModelTree(expectedDocumentId)).map(({ id }) => id));
  if (!nodeIds.has(selectionId)) throw new Error("unknown viewport selection identity");
  return replaceActiveDocumentState(session, (state) => ({
    ...state,
    selection: selectionId,
    treeFocusId: selectionId,
    reviewMeasurementMm: null,
  }));
}

function selectedTreeNode(documentId: FixtureDocumentId, selectionId: string | undefined): FixtureTreeNode {
  if (!selectionId) throw new Error("review command requires a selection");
  const matches = flattenFixtureTree(fixtureModelTree(documentId)).filter(({ id }) => id === selectionId);
  if (matches.length !== 1) throw new Error(matches.length === 0 ? "missing or forged selection identity" : "ambiguous selection identity");
  return matches[0];
}

const ATTACHABLE_NODE_KINDS: Readonly<Partial<Record<FixtureTreeNodeKind, FixtureContextEntityKind>>> = Object.freeze({
  "review-surface": "face",
  feature: "feature",
  occurrence: "component",
  "source-reference": "document_reference",
  mate: "mate",
});

export function attachCurrentFixtureSelection(
  session: FixtureSession,
  expectedDocumentId: FixtureDocumentId,
  revisionId: string,
): FixtureSession {
  if (session.activeDocumentId !== expectedDocumentId) throw new Error("stale or inactive fixture document context");
  const selectionId = session.documentStates[expectedDocumentId].selection;
  if (!selectionId) throw new Error("current selection required");
  const node = selectedTreeNode(expectedDocumentId, selectionId);
  const entityKind = ATTACHABLE_NODE_KINDS[node.kind];
  if (!entityKind) throw new Error("selection kind is not attachable");
  if (revisionId.trim().length === 0) throw new Error("revision identity required");

  const attachedContext = detachFixtureReviewContext({
    documentId: expectedDocumentId,
    entityId: node.id,
    entityKind,
    entityLabel: node.label,
    revisionId,
  });
  return {
    ...session,
    requestSession: { ...session.requestSession, attachedContext },
  };
}

export function clearAttachedFixtureContext(session: FixtureSession): FixtureSession {
  if (session.requestSession.attachedContext == null) return session;
  return {
    ...session,
    requestSession: { ...session.requestSession, attachedContext: null },
  };
}

export function prepareFixtureChangeRequest(session: FixtureSession, prompt: string): FixtureSession {
  const preparedDraft = prepareLocalChangeRequestDraft(prompt, session.requestSession.attachedContext);
  return {
    ...session,
    requestSession: { ...session.requestSession, preparedDraft },
  };
}

export function fixtureOpenPartTarget(documentId: FixtureDocumentId, selectionId: string | null): Exclude<FixtureDocumentId, "bench-clamp.assembly"> | null {
  if (documentId !== "bench-clamp.assembly" || !selectionId) return null;
  const matches = flattenFixtureTree(fixtureModelTree(documentId)).filter(({ id }) => id === selectionId);
  if (matches.length !== 1) return null;
  const node = matches[0];
  return ["occurrence", "source-reference", "review-surface"].includes(node.kind) ? node.sourceDocumentId ?? null : null;
}

function fixtureReviewMeasurementMm(documentId: FixtureDocumentId, node: FixtureTreeNode): number {
  if (node.kind !== "review-surface") throw new Error("selection kind does not admit measurement");
  const sourceDocumentId = node.sourceDocumentId ?? (documentId === "bench-clamp.assembly" ? null : documentId);
  if (!sourceDocumentId) throw new Error("review surface has no unambiguous source Part");
  const parameters = fixtureDocument(sourceDocumentId).parameters;
  if (sourceDocumentId === "base-plate.part") {
    if (node.id.includes("outer-wall")) return parameters.thickness_mm;
    if (node.id.includes("hole-wall")) return parameters.hole_diameter_mm;
    return parameters.depth_mm;
  }
  if (sourceDocumentId === "clamp-jaw.part") return node.id.includes("base") ? parameters.foot_width_mm : parameters.height_mm;
  return node.id.includes("shaft") ? parameters.height_mm : parameters.head_diameter_mm;
}

export function dispatchFixtureReviewCommand(session: FixtureSession, request: FixtureReviewCommandRequest): FixtureSession {
  if (session.activeDocumentId !== request.expectedDocumentId) throw new Error("stale or inactive fixture document context");
  if (!fixtureCommandCategories(request.expectedDocumentId).includes(request.category)) throw new Error("command category is not admitted for active document");
  const state = session.documentStates[request.expectedDocumentId];
  if (state.commandCategory !== request.category) throw new Error("stale command category context");
  if (request.category !== "inspect") throw new Error("operational review commands require Inspect category");
  if (request.command === "clear-measurement") {
    if (state.reviewMeasurementMm == null && state.measurement.phase === "idle") throw new Error("active document has no measurement to clear");
    return replaceActiveDocumentState(session, (current) => ({ ...current, reviewMeasurementMm: null, measurement: { phase: "idle" } }));
  }
  if (request.command === "measure") {
    const node = selectedTreeNode(request.expectedDocumentId, request.selectionId);
    if (request.selectionId !== state.selection) throw new Error("stale selection context");
    const measurementMm = fixtureReviewMeasurementMm(request.expectedDocumentId, node);
    return replaceActiveDocumentState(session, (current) => ({ ...current, reviewMeasurementMm: measurementMm }));
  }
  if (request.command === "open-part") {
    selectedTreeNode(request.expectedDocumentId, request.selectionId);
    if (request.selectionId !== state.selection) throw new Error("stale selection context");
    const target = fixtureOpenPartTarget(request.expectedDocumentId, request.selectionId ?? null);
    if (!target) throw new Error("selection does not resolve unambiguously to an in-fixture Part");
    return openFixtureDocument(session, target);
  }
  throw new Error("unsupported or unavailable review command");
}

const APPROXIMATE_SOURCE_HEADER = [
  "# document-specific approximate review source",
  "# review_state=needs_human_review; fabrication_release=false; machine_actuation=false",
  "# generated disclosure only; not exact B-rep or fabrication source",
  "from build123d import *",
] as const;

function sourceNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("fixture source contains a non-finite parameter");
  return Number(value.toFixed(6)).toString();
}

export function generateFixtureApproximateSource(documentId: FixtureDocumentId): string {
  const document = fixtureDocument(documentId);
  const p = document.parameters;
  let body: readonly string[];
  if (documentId === "base-plate.part") {
    const pitchX = p.width_mm - 2 * p.hole_inset_mm;
    const pitchY = p.depth_mm - 2 * p.hole_inset_mm;
    body = [
      `# ${document.fileName}`,
      "with BuildPart() as part:",
      `    with BuildSketch(): RectangleRounded(${sourceNumber(p.width_mm)}, ${sourceNumber(p.depth_mm)}, ${sourceNumber(p.corner_radius_mm)})`,
      `    extrude(amount=${sourceNumber(p.thickness_mm)})`,
      "    with BuildSketch(part.faces().sort_by(Axis.Z)[-1]):",
      `        with GridLocations(${sourceNumber(pitchX)}, ${sourceNumber(pitchY)}, 2, 2): Circle(${sourceNumber(p.hole_diameter_mm / 2)})`,
      `    extrude(amount=-${sourceNumber(p.thickness_mm)}, mode=Mode.SUBTRACT)`,
    ];
  } else if (documentId === "clamp-jaw.part") {
    body = [
      `# ${document.fileName}`,
      "with BuildPart() as part:",
      `    Box(${sourceNumber(p.foot_width_mm)}, ${sourceNumber(p.depth_mm)}, ${sourceNumber(p.foot_height_mm)})`,
      `    with Locations((0, 0, ${sourceNumber(p.foot_height_mm)})): Box(${sourceNumber(p.width_mm)}, ${sourceNumber(p.depth_mm)}, ${sourceNumber(p.height_mm - p.foot_height_mm)})`,
    ];
  } else if (documentId === "guide-pin.part") {
    const shaftHeight = p.height_mm - p.head_height_mm;
    body = [
      `# ${document.fileName}`,
      "with BuildPart() as part:",
      `    Cylinder(${sourceNumber(p.diameter_mm / 2)}, ${sourceNumber(shaftHeight)})`,
      `    with Locations((0, 0, ${sourceNumber(shaftHeight)})): Cylinder(${sourceNumber(p.head_diameter_mm / 2)}, ${sourceNumber(p.head_height_mm)})`,
    ];
  } else {
    body = [
      `# ${document.fileName}`,
      "# source Parts remain separate; occurrence references and transforms are disclosed",
      "components = [",
      ...R14_ASSEMBLY.occurrences.map(({ label, sourceDocumentId, transform }) =>
        `    ('${label}', '${sourceDocumentId}', (${transform.translationMm.join(", ")}), (${transform.rotationDeg.join(", ")})),`),
      "]",
    ];
  }
  return [...APPROXIMATE_SOURCE_HEADER, ...body].join("\n");
}

export interface FixtureReviewMeshStl {
  readonly documentId: FixtureDocumentId;
  readonly filename: string;
  readonly text: string;
  readonly byteLength: number;
  readonly facetCount: number;
  readonly bounds: Readonly<{ min: Vector3; max: Vector3 }>;
  readonly validation: Readonly<{ ascii: true; nonempty: true; finite: true; cadZMinOnBuildPlane: true }>;
  readonly claimScope: "Document-specific browser-generated review mesh only; not exact B-rep, engineering approval, or export authority; not fabrication release.";
}

function roundedRectangle(width: number, depth: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -depth / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.absarc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
  shape.lineTo(x + width, y + depth - radius);
  shape.absarc(x + width - radius, y + depth - radius, radius, 0, Math.PI / 2);
  shape.lineTo(x + radius, y + depth);
  shape.absarc(x + radius, y + depth - radius, radius, Math.PI / 2, Math.PI);
  shape.lineTo(x, y + radius);
  shape.absarc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
  return shape;
}

function basePlateReviewObject(): THREE.Mesh {
  const document = fixtureDocument("base-plate.part");
  const p = document.parameters;
  const shape = roundedRectangle(p.width_mm, p.depth_mm, p.corner_radius_mm);
  const centers = document.metadata?.hole_centers_mm as readonly (readonly [number, number])[];
  for (const [x, y] of centers) {
    const hole = new THREE.Path();
    hole.absarc(x, y, p.hole_diameter_mm / 2, 0, Math.PI * 2);
    shape.holes.push(hole);
  }
  return new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {
    depth: p.thickness_mm,
    bevelEnabled: false,
    curveSegments: 24,
  }));
}

function clampJawReviewObject(): THREE.Group {
  const p = fixtureDocument("clamp-jaw.part").parameters;
  const root = new THREE.Group();
  const foot = new THREE.Mesh(new THREE.BoxGeometry(p.foot_width_mm, p.depth_mm, p.foot_height_mm));
  foot.position.z = p.foot_height_mm / 2;
  const uprightHeight = p.height_mm - p.foot_height_mm;
  const upright = new THREE.Mesh(new THREE.BoxGeometry(p.width_mm, p.depth_mm, uprightHeight));
  upright.position.z = p.foot_height_mm + uprightHeight / 2;
  root.add(foot, upright);
  return root;
}

function guidePinReviewObject(): THREE.Group {
  const p = fixtureDocument("guide-pin.part").parameters;
  const root = new THREE.Group();
  const shaftHeight = p.height_mm - p.head_height_mm;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(p.diameter_mm / 2, p.diameter_mm / 2, shaftHeight, 32));
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = shaftHeight / 2;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(p.head_diameter_mm / 2, p.head_diameter_mm / 2, p.head_height_mm, 32));
  head.rotation.x = Math.PI / 2;
  head.position.z = shaftHeight + p.head_height_mm / 2;
  root.add(shaft, head);
  return root;
}

function fixturePartReviewObject(documentId: Exclude<FixtureDocumentId, "bench-clamp.assembly">): THREE.Object3D {
  if (documentId === "base-plate.part") return basePlateReviewObject();
  if (documentId === "clamp-jaw.part") return clampJawReviewObject();
  return guidePinReviewObject();
}

function fixtureReviewRoot(documentId: FixtureDocumentId): THREE.Group {
  requireDocument(documentId);
  const root = new THREE.Group();
  root.name = `piton_${documentId.replace(/[^a-z0-9]+/gi, "_")}`;
  if (documentId !== "bench-clamp.assembly") {
    root.add(fixturePartReviewObject(documentId));
  } else {
    for (const occurrence of R14_ASSEMBLY.occurrences) {
      if (occurrence.suppressed) continue;
      const instance = fixturePartReviewObject(occurrence.sourceDocumentId);
      instance.position.set(...occurrence.transform.translationMm);
      instance.rotation.set(...occurrence.transform.rotationDeg.map(THREE.MathUtils.degToRad) as [number, number, number]);
      root.add(instance);
    }
  }
  root.updateMatrixWorld(true);
  return root;
}

function disposeReviewRoot(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
  });
}

export function generateFixtureReviewMeshStl(documentId: FixtureDocumentId): FixtureReviewMeshStl {
  const root = fixtureReviewRoot(documentId);
  try {
    const box = new THREE.Box3().setFromObject(root);
    const min = box.min.toArray() as Vector3;
    const max = box.max.toArray() as Vector3;
    if (![...min, ...max].every(Number.isFinite)) throw new Error("review mesh bounds are not finite");
    if (Math.abs(min[2]) > 1e-6) throw new Error(`review mesh CAD Z min ${min[2]} does not contact build plane Z=0`);
    min[2] = 0;
    const raw = new STLExporter().parse(root, { binary: false });
    if (typeof raw !== "string") throw new Error("review mesh STL exporter returned a non-ASCII payload");
    const solidName = root.name;
    const text = raw.replace(/^solid exported/, `solid ${solidName}`).replace(/endsolid exported\s*$/, `endsolid ${solidName}\n`);
    const facetCount = text.match(/facet normal/g)?.length ?? 0;
    const ascii = /^[\x00-\x7F]+$/.test(text);
    const finite = !/\b(?:NaN|Infinity)\b/.test(text);
    const byteLength = new TextEncoder().encode(text).byteLength;
    const hasEnvelope = /^solid\s/.test(text) && /endsolid\s+\S+\s*$/.test(text);
    if (!ascii || !finite || byteLength === 0 || facetCount === 0 || !hasEnvelope) {
      throw new Error(`generated STL failed nonempty ASCII facet validation (ascii=${ascii}, finite=${finite}, bytes=${byteLength}, facets=${facetCount}, envelope=${hasEnvelope})`);
    }
    return {
      documentId,
      filename: `${documentId}-review-mesh.stl`,
      text,
      byteLength,
      facetCount,
      bounds: { min, max },
      validation: { ascii: true, nonempty: true, finite: true, cadZMinOnBuildPlane: true },
      claimScope: "Document-specific browser-generated review mesh only; not exact B-rep, engineering approval, or export authority; not fabrication release.",
    };
  } finally {
    disposeReviewRoot(root);
  }
}
