import { describe, expect, it } from "vitest";
import {
  activateFixtureDocument,
  attachCurrentFixtureSelection,
  clearAttachedFixtureContext,
  closeFixtureDocument,
  createFixtureSession,
  openFixtureDocument,
  prepareFixtureChangeRequest,
  setFixtureTreeInteraction,
  type FixtureDocumentId,
  type FixtureSession,
} from "../src/fixture";

function select(
  session: FixtureSession,
  documentId: FixtureDocumentId,
  selectionId: string,
): FixtureSession {
  const active = session.activeDocumentId === documentId
    ? session
    : activateFixtureDocument(openFixtureDocument(session, documentId), documentId);
  return setFixtureTreeInteraction(active, documentId, { selectionId, focusId: selectionId });
}

describe("R14/F detached context and local Change Request draft", () => {
  it.each([
    ["base-plate.part", "face:top", "face"],
    ["base-plate.part", "base-plate.part:feature:1", "feature"],
    ["bench-clamp.assembly", "component:clamp-jaw:1", "component"],
    ["bench-clamp.assembly", "association:component:clamp-jaw:1:source", "document_reference"],
    ["bench-clamp.assembly", "mate:jaw-spacing", "mate"],
  ] as const)("attaches supported %s selection %s as %s", (documentId, selectionId, entityKind) => {
    const selected = select(createFixtureSession(), documentId, selectionId);
    const attached = attachCurrentFixtureSelection(selected, documentId, "revision-accepted");

    expect(attached.requestSession.attachedContext).toMatchObject({
      documentId,
      entityId: selectionId,
      entityKind,
      revisionId: "revision-accepted",
    });
    expect(Object.isFrozen(attached.requestSession.attachedContext)).toBe(true);
  });

  it("detaches attachment from later selection, clearing, tab switching, close, and reopen", () => {
    let session = select(createFixtureSession(), "base-plate.part", "face:top");
    session = attachCurrentFixtureSelection(session, "base-plate.part", "revision-accepted");
    const snapshot = session.requestSession.attachedContext;

    session = setFixtureTreeInteraction(session, "base-plate.part", { selectionId: "base-plate.part:origin" });
    session = setFixtureTreeInteraction(session, "base-plate.part", { selectionId: null });
    session = activateFixtureDocument(session, "bench-clamp.assembly");
    session = closeFixtureDocument(session, "base-plate.part");
    session = openFixtureDocument(session, "base-plate.part");

    expect(session.requestSession.attachedContext).toBe(snapshot);
    expect(session.requestSession.attachedContext?.entityId).toBe("face:top");
  });

  it("rejects missing, unsupported, stale, unknown, and ambiguous selection context", () => {
    const initial = createFixtureSession();
    expect(() => attachCurrentFixtureSelection(initial, "bench-clamp.assembly", "revision-accepted"))
      .toThrow("current selection required");

    const unsupported = select(initial, "bench-clamp.assembly", "document:bench-clamp.assembly");
    expect(() => attachCurrentFixtureSelection(unsupported, "bench-clamp.assembly", "revision-accepted"))
      .toThrow("selection kind is not attachable");
    expect(() => attachCurrentFixtureSelection(unsupported, "base-plate.part", "revision-accepted"))
      .toThrow("stale or inactive fixture document context");

    const forged = {
      ...initial,
      documentStates: {
        ...initial.documentStates,
        "bench-clamp.assembly": { ...initial.documentStates["bench-clamp.assembly"], selection: "forged:entity" },
      },
    };
    expect(() => attachCurrentFixtureSelection(forged, "bench-clamp.assembly", "revision-accepted"))
      .toThrow("missing or forged selection identity");
  });

  it("replaces and clears attached context without mutating a prepared draft", () => {
    let session = select(createFixtureSession(), "base-plate.part", "face:top");
    session = attachCurrentFixtureSelection(session, "base-plate.part", "revision-accepted");
    session = prepareFixtureChangeRequest(session, "  Increase the selected leg by 5 mm.  ");
    const draft = session.requestSession.preparedDraft;

    session = select(session, "bench-clamp.assembly", "component:clamp-jaw:1");
    session = attachCurrentFixtureSelection(session, "bench-clamp.assembly", "revision-candidate");
    expect(session.requestSession.preparedDraft).toBe(draft);
    expect(session.requestSession.attachedContext?.entityId).toBe("component:clamp-jaw:1");

    session = clearAttachedFixtureContext(session);
    expect(session.requestSession.attachedContext).toBeNull();
    expect(session.requestSession.preparedDraft).toBe(draft);
    expect(draft).toEqual({
      status: "prepared-not-sent",
      prompt: "Increase the selected leg by 5 mm.",
      context: expect.objectContaining({ entityId: "face:top" }),
      transportConnected: false,
    });
    expect(Object.isFrozen(draft)).toBe(true);
    expect(Object.isFrozen(draft?.context)).toBe(true);
  });

  it("rejects blank prompts or absent context and exposes no send or authority state", () => {
    expect(() => prepareFixtureChangeRequest(createFixtureSession(), "Change it"))
      .toThrow("attached context required");

    let session = select(createFixtureSession(), "base-plate.part", "face:top");
    session = attachCurrentFixtureSelection(session, "base-plate.part", "revision-accepted");
    expect(() => prepareFixtureChangeRequest(session, " \n\t ")).toThrow("nonblank prompt required");

    session = prepareFixtureChangeRequest(session, "Change it");
    const record = session.requestSession.preparedDraft as unknown as Record<string, unknown>;
    for (const forbidden of ["sent", "revision", "reviewState", "approval", "export", "fabricationRelease", "machineActuation"]) {
      expect(record).not.toHaveProperty(forbidden);
    }
    expect(record.transportConnected).toBe(false);
  });
});
