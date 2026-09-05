export type FixtureContextEntityKind =
  | "face"
  | "feature"
  | "component"
  | "document_reference"
  | "mate";

export interface AttachedFixtureReviewContext {
  readonly documentId: string;
  readonly entityId: string;
  readonly entityKind: FixtureContextEntityKind;
  readonly entityLabel: string;
  readonly revisionId: string;
}

export interface LocalChangeRequestDraft {
  readonly status: "prepared-not-sent";
  readonly prompt: string;
  readonly context: AttachedFixtureReviewContext;
  readonly transportConnected: false;
}

export interface FixtureRequestSession {
  readonly attachedContext: AttachedFixtureReviewContext | null;
  readonly preparedDraft: LocalChangeRequestDraft | null;
}

export function createFixtureRequestSession(): FixtureRequestSession {
  return { attachedContext: null, preparedDraft: null };
}

export function detachFixtureReviewContext(
  context: AttachedFixtureReviewContext,
): AttachedFixtureReviewContext {
  return Object.freeze({ ...context });
}

export function prepareLocalChangeRequestDraft(
  prompt: string,
  attachedContext: AttachedFixtureReviewContext | null,
): LocalChangeRequestDraft {
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length === 0) throw new Error("nonblank prompt required");
  if (!attachedContext) throw new Error("attached context required");

  return Object.freeze({
    status: "prepared-not-sent" as const,
    prompt: trimmedPrompt,
    context: detachFixtureReviewContext(attachedContext),
    transportConnected: false as const,
  });
}
