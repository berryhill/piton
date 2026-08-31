import type { FixtureDocumentId } from "./fixture";

export type AssemblyOccurrenceId =
  | "component:base-plate:1"
  | "component:clamp-jaw:1"
  | "component:clamp-jaw:2"
  | "component:guide-pin:1";
export type AssemblyRelationshipId = "mate:jaw-spacing" | "mate:pin-concentric";
export type AssemblyVector3 = readonly [number, number, number];

export interface AssemblyOccurrence {
  readonly id: AssemblyOccurrenceId;
  readonly label: string;
  readonly sourceDocumentId: Exclude<FixtureDocumentId, "bench-clamp.assembly">;
  readonly transform: Readonly<{ translationMm: AssemblyVector3; rotationDeg: AssemblyVector3 }>;
  readonly fixed: boolean;
  readonly suppressed: boolean;
}

export interface AssemblySourceReference {
  readonly id: `association:${AssemblyOccurrenceId}:source`;
  readonly parentOccurrenceId: AssemblyOccurrenceId;
  readonly sourceDocumentId: AssemblyOccurrence["sourceDocumentId"];
  readonly kind: "component_source";
}

export interface AssemblyRelationship {
  readonly id: AssemblyRelationshipId;
  readonly label: string;
  readonly kind: "distance" | "concentric";
  readonly relatedOccurrenceIds: readonly AssemblyOccurrenceId[];
  readonly distanceMm?: number;
  readonly status: "review-only";
}

export interface AssemblyContextualFace {
  readonly id: string;
  readonly occurrenceId: AssemblyOccurrenceId;
  readonly sourceDocumentId: AssemblyOccurrence["sourceDocumentId"];
  readonly sourceFaceId: `face:${string}`;
  readonly topologyScope: "occurrence-qualified review-only semantic surface; not exact B-rep topology";
}

const OCCURRENCES: readonly AssemblyOccurrence[] = [
  {
    id: "component:base-plate:1", label: "Base Plate:1", sourceDocumentId: "base-plate.part",
    transform: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] }, fixed: true, suppressed: false,
  },
  {
    id: "component:clamp-jaw:1", label: "Clamp Jaw:1", sourceDocumentId: "clamp-jaw.part",
    transform: { translationMm: [-36, 0, 12], rotationDeg: [0, 0, 0] }, fixed: false, suppressed: false,
  },
  {
    id: "component:clamp-jaw:2", label: "Clamp Jaw:2", sourceDocumentId: "clamp-jaw.part",
    transform: { translationMm: [36, 0, 12], rotationDeg: [0, 0, 180] }, fixed: false, suppressed: false,
  },
  {
    id: "component:guide-pin:1", label: "Guide Pin:1", sourceDocumentId: "guide-pin.part",
    transform: { translationMm: [0, 0, 12], rotationDeg: [0, 0, 0] }, fixed: false, suppressed: false,
  },
];

const SOURCE_REFERENCES: readonly AssemblySourceReference[] = OCCURRENCES.map((occurrence) => ({
  id: `association:${occurrence.id}:source`,
  parentOccurrenceId: occurrence.id,
  sourceDocumentId: occurrence.sourceDocumentId,
  kind: "component_source",
}));

const RELATIONSHIPS: readonly AssemblyRelationship[] = [
  {
    id: "mate:jaw-spacing", label: "Distance Mate · Jaw spacing", kind: "distance",
    relatedOccurrenceIds: ["component:clamp-jaw:1", "component:clamp-jaw:2"], distanceMm: 72, status: "review-only",
  },
  {
    id: "mate:pin-concentric", label: "Concentric Mate · Guide Pin", kind: "concentric",
    relatedOccurrenceIds: ["component:guide-pin:1", "component:base-plate:1"], status: "review-only",
  },
];

const SOURCE_FACE_IDS: Readonly<Record<AssemblyOccurrence["sourceDocumentId"], readonly `face:${string}`[]>> = {
  "base-plate.part": ["face:top", "face:bottom", "face:outer-wall", "face:hole-wall:1", "face:hole-wall:2", "face:hole-wall:3", "face:hole-wall:4"],
  "clamp-jaw.part": ["face:jaw-top", "face:jaw-base", "face:jaw-grip"],
  "guide-pin.part": ["face:pin-shaft", "face:pin-base", "face:pin-top"],
};

const CONTEXTUAL_FACES: readonly AssemblyContextualFace[] = OCCURRENCES.flatMap((occurrence) =>
  SOURCE_FACE_IDS[occurrence.sourceDocumentId].map((sourceFaceId) => ({
    id: assemblyContextualFaceId(occurrence.id, sourceFaceId),
    occurrenceId: occurrence.id,
    sourceDocumentId: occurrence.sourceDocumentId,
    sourceFaceId,
    topologyScope: "occurrence-qualified review-only semantic surface; not exact B-rep topology" as const,
  })),
);

export const R14_ASSEMBLY = Object.freeze({
  id: "bench-clamp.assembly" as const,
  label: "Bench Clamp.assembly",
  occurrences: OCCURRENCES,
  sourceReferences: SOURCE_REFERENCES,
  contextualFaces: CONTEXTUAL_FACES,
  relationships: RELATIONSHIPS,
  sceneEvidence: Object.freeze({
    cadAxisUp: "Z" as const,
    worldAxisUp: "Z" as const,
    cadZMinMm: 0,
    gridWorldZMm: 0,
    physicalBuildPlane: true,
    occurrenceCount: 4,
  }),
  reviewState: "needs_human_review" as const,
  fabricationRelease: false,
  machineActuation: false,
  claimScope: "Static browser-local Assembly review geometry and explicit relationship semantics only; not exact geometry, exact topology, authored Assembly authority, engineering approval, export, or release.",
});

export function assemblySourceReference(occurrenceId: AssemblyOccurrenceId): AssemblySourceReference {
  const reference = SOURCE_REFERENCES.find(({ parentOccurrenceId }) => parentOccurrenceId === occurrenceId);
  if (!reference) throw new Error(`unknown Assembly occurrence: ${occurrenceId}`);
  return reference;
}

export function assemblyContextualFaceId(occurrenceId: AssemblyOccurrenceId, sourceFaceId: `face:${string}`): string {
  return `contextual-face:${occurrenceId}:${sourceFaceId.slice("face:".length)}`;
}
