# Piton MVI architecture boundary

## Authority

Piton has one product surface and one writable authored authority: browser-local TypeScript commands operating on immutable `DesignRevision` records persisted by SQLite WASM in OPFS. `browser-src/App.tsx` reaches that authority through `CadApplication.executeCommand`; `window.pitonAgent` is an untrusted adapter to the same closed command boundary, not a second authority.

The repository contains no server application, Python package, external exact-CAD adapter, or exact-geometry export implementation.

## Geometry

A pinned Manifold WASM Web Worker realizes revision-scoped review meshes. Review geometry:

- is not exact B-rep geometry;
- cannot mint or mutate authored revisions;
- cannot replace accepted or last-good state after a stale or failed result;
- keeps CAD Z=0 on the physical viewer grid;
- cannot imply review acceptance, engineering approval, export, fabrication release, or machine actuation.

## Stage 1 wedge

The implemented wedge is one consequential Part, one bounded `leg_length_mm` mutation, one browser-local writable authority, predeclared checks, review artifacts, and human review. Lifecycle records remain distinct. Proposal acceptance, revision commit, build success, channel movement, approval, export, release, and machine actuation never collapse into one another.

## Storage and command admission

SQLite WASM in OPFS is the durable browser-local store. Commands use a closed `piton-command/v1` envelope, exact project identity, millimetre units, a 40–160 mm bound, stale-base protection, and idempotency-key conflict checks. OPFS failure is visible and does not silently fall back to transient writable state.

## Safety root truth

```text
review_state = needs_human_review
fabrication_release = false
machine_actuation = false
release_state = unreleased
```

No implemented command issues engineering approval, exports fabrication deliverables, releases a package, or actuates a machine. Canonical doctrine: [`mvi-doctrine.md`](mvi-doctrine.md).
