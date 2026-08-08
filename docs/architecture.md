# Piton MVI architecture boundary

## Origin

Piton was named after the OpenDesign R14 Bench Clamp Fixture prototype
(project `8da9ea71`, conversation `76d3d331`, authoring revision
`r14-05729d28`). The exhaustive report at
`/home/silas/.hermes/profiles/nick-mercer/workspace/reports/mechanical-cad-mvi-exhaustive-final-report-2026-08-06.md`
is the controlling source doctrine. The in-repo canonical mirror is
[`docs/mvi-doctrine.md`](mvi-doctrine.md). Where this file disagrees
with `docs/mvi-doctrine.md`, the doctrine wins.

## Current authority

- Authored intent: immutable source-native Python revision.
- Exact realization: pinned build123d/OCP worker result scoped to revision and environment.
- Review representation: revision/build-scoped GLB plus artifact-local selection map (`claim_scope=review-only`).
- Exchange: STEP derived from a successful exact realization (must be receiver-qualified under a named receiver/version/profile; emit only does not pass).
- Optional additive derivatives: 3MF/STL, always labeled derivative and unreleased.
- Printable CSG: separate OpenSCAD source-native authority profile (not interchangeable with precision authority).
- Imported geometry without reproducible source: authoritative only as a pinned imported artifact; no feature history is invented.
- Human state: request changes or accept for MVI review (acceptance is not engineering approval).
- Fabric/release state: distinct `DraftExport` (visibly unreleased), `ApprovalRecord` (signed scoped), `FabricationRelease` (separate signed human act); none implemented in Stage 1.

## Stage 1 wedge

One consequential single Part, one bounded partner-driven parameter
mutation, one writable source-native authority, one pinned precision
worker, three to five predeclared checks selected from observed reviewer
decisions.

## Stage 1 durable lifecycle (ten distinct concepts)

`ChangeProposal` → `ProposalDisposition` → `DesignRevision` → `BuildAttempt` → `EvidenceClosure` → `ChannelPointer` → `ApprovalRecord` → `DraftExport` → `FabricationRelease` → `ReleasedPackageProjection`.

No two of these collapse. The forbidden implications chain is in `docs/mvi-doctrine.md`.

## Stage 1 viewer contract

**CURRENT VERIFIED** (R14 must continue to be implemented): Part/Assembly
fixture distinction; source-Part vs occurrence navigation;
Smart/Face/Component selection modes; current-vs-attached selection
separation; Model tree; implemented semantic selection highlights;
Iso/Front/Top/Fit and roll controls; CAD-Z=0 physical-grid mapping;
review-mesh measurement; exact-vs-mesh/fabrication-blocked disclosure.

**TARGET additions** (must be implemented on top of CURRENT VERIFIED):
revision-pinned packets; source-parameter panels; selected-zone callouts;
explicit bbox/reset control; controlled build-volume envelope;
validation/issue overlays.

## Stage 1 worker architecture

Modular monolith with isolated precision and printable workers. Browser/
Electron renderer has no filesystem/credential/SQL/process/kernel/
approval/release authority. Persist `BuildAttempt` before dispatch.
Receipts name the actual isolation class (`wasm`, `container`,
`microvm`, or weaker `trusted-local`). Generated/imported/plugin
geometry code is hostile by default. Cache is acceleration only.

## Stage 1 custody

Git-friendly local directory of deterministic UTF-8 source/manifests and
content-addressed binary assets. SQLite journals/query metadata and
mutable refs. SQLite pages, one giant JSON file, viewer state, and
adjacent mutable sidecars are not portable authority. Full golden path
disconnected. No-clobber atomic CAS promotion, one `BEGIN IMMEDIATE`
closure transaction, restartable idempotent outbox.

## Capability packages

Four isolation tiers: schema (inert), UI (separate origin/process),
compute (isolated workers), automation (out of process, untrusted).
Stage 1 allows first-party immutable entries and inert/declarative
templates only; no arbitrary executable marketplace.

## Stage 1 non-goals

Stage 1 does not implement: universal text-to-CAD; CAD replacement;
graph-authoritative MechanicalDocument; broad feature vocabulary;
full sketch solver; assemblies-first; mechanisms; broad mates;
generic stable topology; silent reference repair; arbitrary STEP
feature recognition/editing; native feature/mate round trip; second
precision kernel; silent backend fallback; generic kernel
equivalence; advanced surfacing; sheet metal; drawings/GD&T/MBD;
FEA/CFD; CAM; slicing; machine actuation; real-time multiplayer;
broad semantic auto-merge; arbitrary executable marketplace;
autonomous approval/release/certification; cloud-required custody;
paywalled canonical reopen/rebuild/migration/export; static HTML/
viewer authority. R14 approximate source and STL remain excluded from
exact/fabrication artifacts.

## Browser, CDN, license, privacy, performance

Any controlled/offline review packet vendors exact dependency bytes
with hashes and notices, applies CSP, tests disconnected load, and
records license obligations. Stage 1 defines supported browsers/
OS/GPU or a signed desktop/daemon route; budgets for model-size,
startup, memory, CPU, battery, interaction-latency, output-size,
graceful failure; WCAG 2.2 AA evidence with named browser/
assistive-technology combinations.
