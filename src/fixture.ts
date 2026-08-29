export type FixtureDocumentId =
  | "base-plate.part"
  | "clamp-jaw.part"
  | "guide-pin.part"
  | "bench-clamp.assembly";
export type FixtureDocumentKind = "part" | "assembly";
export type FixtureSelectionMode = "smart" | "face" | "component";
export type FixtureViewPreset = "iso" | "front" | "top";
export type FixtureCommandCategory = "features" | "sketch" | "assembly" | "mates" | "inspect";

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
  readonly stl: Readonly<{ state: "idle" | "building" | "ready" | "failed"; artifactId?: string }>;
  readonly camera: Readonly<{ position: Vector3; target: Vector3; up: Vector3 }>;
}

export interface FixtureSession {
  readonly openDocumentIds: readonly FixtureDocumentId[];
  readonly activeDocumentId: FixtureDocumentId;
  readonly documentStates: Readonly<Record<FixtureDocumentId, FixtureDocumentState>>;
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

function defaultDocumentState(): FixtureDocumentState {
  return {
    selection: null,
    selectionMode: "smart",
    viewPreset: "iso",
    commandCategory: "inspect",
    treeExpandedIds: [],
    treeFocusId: null,
    approximateSourceVisible: false,
    measurement: { phase: "idle" },
    reviewMeasurementMm: null,
    stl: { state: "idle" },
    camera: { position: [150, -150, 120], target: [0, 0, 20], up: [0, 0, 1] },
  };
}

function allDocumentStates(): Record<FixtureDocumentId, FixtureDocumentState> {
  return Object.fromEntries(DOCUMENTS.map((document) => [document.id, defaultDocumentState()])) as Record<FixtureDocumentId, FixtureDocumentState>;
}

export function createFixtureSession(): FixtureSession {
  return {
    openDocumentIds: [...INITIAL_OPEN_DOCUMENT_IDS],
    activeDocumentId: INITIAL_ACTIVE_DOCUMENT_ID,
    documentStates: allDocumentStates(),
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
  if (remaining.length === 0) return createFixtureSession();
  if (session.activeDocumentId !== id) return { ...session, openDocumentIds: remaining };
  const neighborIndex = Math.min(closingIndex, remaining.length - 1);
  return { ...session, openDocumentIds: remaining, activeDocumentId: remaining[neighborIndex] };
}

export function updateActiveDocumentState(
  session: FixtureSession,
  update: (state: FixtureDocumentState) => FixtureDocumentState,
): FixtureSession;
export function updateActiveDocumentState(
  session: FixtureSession,
  update: Partial<FixtureDocumentState>,
): FixtureSession;
export function updateActiveDocumentState(
  session: FixtureSession,
  update: Partial<FixtureDocumentState> | ((state: FixtureDocumentState) => FixtureDocumentState),
): FixtureSession {
  const activeId = session.activeDocumentId;
  const current = session.documentStates[activeId];
  const requested = typeof update === "function" ? update(current) : { ...current, ...update };
  const activeDocument = fixtureDocument(activeId);
  const next = requested.selectionMode === "component" && activeDocument.kind === "part"
    ? { ...requested, selectionMode: current.selectionMode }
    : requested;
  return {
    ...session,
    documentStates: { ...session.documentStates, [activeId]: next },
  };
}

export function fixtureDocument(id: FixtureDocumentId): FixtureDocument {
  requireDocument(id);
  return DOCUMENTS.find((document) => document.id === id)!;
}
