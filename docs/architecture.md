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

### Bounded source-native mutation boundary

Adapters submit an immutable `ChangeProposal`; they do not select or assert the
current revision. `PitonApplicationService.derive_change_candidate(project_id,
proposal, ctx)` reads the exact project-scoped workspace head from daemon
custody, holds the write-serialization transaction through verified manifest
readback and pure single-parameter derivation, and returns an unpersisted
candidate. The former public `piton.apply_change_proposal` entry point is
intentionally removed because its caller-supplied current-revision argument
could not establish daemon-owned currency. Derivation does not move a channel,
commit a revision, approve a proposal, export, release, or actuate machinery.

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

### Durable build admission and coordinator state

The daemon admits an exact-revision build attempt by committing two records in
one `BEGIN IMMEDIATE` transaction before worker dispatch:

- immutable `build_attempts` facts bind the exact project/revision pair,
  request and toolchain digests, worker identity, and declared isolation class;
- mutable `build_coordinator_state` records execution state, generation, fence,
  and lease fields without changing the immutable attempt.

The dispatch seam receives only the committed immutable attempt. A dispatch
failure leaves that attempt durably readable for diagnosis and recovery. Retry
requires a new coordinator-derived UUID (with deterministic factory injection
only for tests); callers cannot supply an attempt identity. Admission requires
an opaque daemon-issued capability that cannot be constructed from caller
assertions or request digests, and the issuance helper is not part of the public
storage API. Attempt and state reads require the exact project and attempt IDs.
SQLite enforces exact project/revision custody, lowercase SHA-256 hex digests,
and rejects duplicate `INSERT`/`INSERT OR REPLACE` before immutable facts can be
replaced.
Neither admission nor coordinator state grants authored-revision, channel,
review, approval, export, fabrication-release, or machine-actuation authority.
The root truths remain `review_state=needs_human_review`,
`fabrication_release=false`, and `machine_actuation=false`.

### Pinned precision-worker contracts

`PrecisionWorkerRequest` is a frozen canonical record. The existing
`PitonApplicationService` composition root owns the trusted attempt coordinator,
exact-input repository, bounded `.piton/build-attempts` output root, and clock.
Its `issue_precision_worker_request` and `run_precision_worker` methods read the
exact durable attempt and current running lease/generation/fence; callers cannot
supply attempt/coordinator DTOs, revisions, realization inputs, or output paths.
The run path re-reads custody and requires byte-identical canonical request
bindings before geometry execution. Caller-constructed contract records remain
data, not execution authority. The application service rejects an expired lease
against its timezone-aware trusted clock before request creation and again before
execution.

Attempt output custody walks `.piton/build-attempts/<project>/<attempt>` from the
trusted control root with directory file descriptors and `O_NOFOLLOW`. A symlink
or non-directory ancestor blocks before geometry and an existing attempt scope is
never overwritten. Geometry is staged under the pinned project directory and
published with atomic no-replace rename. Failed descriptor-relative staging is
retained for later bounded quarantine/recovery; execution never performs
pathname-based recursive cleanup that could delete an attacker-swapped entry.

The worker module does not own repositories, clocks, request issuance, or output-root
selection. It exposes bounded binding validation, realization, and result
verification over an already-composed immutable request. Python name deletion and
closure cells are not treated as an authority boundary.
The request binds the exact project, revision, source manifest, recipe,
Python/build123d/OCP toolchain, capability/resource/output manifests, request
signature reference, and `precision_worker_one` implementation pin. The first
implementation truthfully reports `trusted-local`; it does not claim container,
microVM, WASM, network, credential, or result-signature isolation that is not
implemented.

`PrecisionWorkerResult` is a frozen, canonical, attempt/request-bound execution
fact. Success requires exact closure over all seven roles from
`precision_worker_one:piton.realization-and-review.v2`: exact BREP, STEP, exact
inspection receipt, review GLB, artifact-local review selection map, GLB receipt,
and selection-map receipt. Every file has a verified size and SHA-256 digest.
The exact inspection receipt independently binds the BREP and STEP to the exact
revision and successful build attempt. Separate GLB and selection-map receipts
independently bind each review artifact to that same revision/attempt and to the
source exact-BREP and exact-receipt digests; the GLB receipt additionally binds
the selection-map digest. Triangle/primitive IDs remain local to that one GLB
and never become durable topology identity. Thus exact geometry and review
geometry close together without collapsing their claim scopes: review geometry
is not exact geometry, and closure is not human acceptance, approval, export,
release, or actuation. Failed and blocked results retain only bounded sanitized
diagnostics and cannot claim output closure. Request and result verification
performs no SQL write, CAS publication, coordinator update, channel movement,
review decision, approval, export, release, or actuation.
Every request, result, and exact receipt preserves the root truth boundary.

### Predeclared checks and evidence closure

Request issuance durably binds exactly three source-fixed checks to the admitted
attempt before worker execution: exact artifact closure, one-valid-solid receipt
observation, and review-artifact binding. Each declaration fixes checker and
comparator digests, method, units, tolerance, evidence roles, claim scope, and
invalidation conditions. Callers cannot submit or substitute a check list.

`close_precision_worker_evidence` re-reads the exact project, revision, attempt,
running generation/fence/lease, declaration, canonical worker result, and all
seven artifact bytes. It then emits three deterministic immutable check receipts.
One daemon-owned transaction records verified artifact metadata, ordered receipt
links, the immutable `EvidenceClosure`, and the successful coordinator state. A
missing, duplicate, undeclared, failed, stale, tampered, or partially published
fact blocks closure and moves no channel. Project-scoped readback reconstructs
and revalidates the successful attempt, declaration, receipts, artifact metadata,
claim scopes, environment, units, tolerances, warnings, uncertainty, and root
truths. Evidence closure remains review preparation only: it is not human
acceptance, approval, export, fabrication release, or machine actuation.

### Framework-only human-review intake

`HumanReviewIntake` is an immutable, public Python contract whose canonical
primitive is validated by the packaged `piton.human-review-intake.v1` JSON
schema. `PitonApplicationService.intake_human_review(intake,
packet_directory)` admits review work only after rebinding the intake's exact
project, revision, build-attempt, evidence-closure, and review-packet
identities to daemon-custodied closure state and independently validated
packet bytes. There is no `latest`, channel, filename, nearest-face, or other
fallback identity.

The method is intentionally read-only and non-persistent: it returns the same
frozen intake after validation and writes no revision, channel, attempt,
closure, receipt, review disposition, approval, export, release, or machine
state. An admitted intake therefore remains
`review_state=needs_human_review`, `fabrication_release=false`, and
`machine_actuation=false`; admission is not a human decision or lifecycle
transition.

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
