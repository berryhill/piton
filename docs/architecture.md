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

- Authored intent: immutable browser-local TypeScript revision under
  `browser-typescript/v1`, persisted in SQLite WASM/OPFS with an explicit current
  pointer and an immutable accepted base.
- Interactive realization: pinned Manifold WASM worker mesh scoped to one request
  and revision. It is review geometry; stale/failed results cannot replace last-good.
- Optional external exact realization: pinned Python/build123d/OCP worker result
  scoped to revision and environment. It is an adapter, not writable product authority.
- Review representation: revision/build-scoped GLB plus artifact-local selection map (`claim_scope=review-only`).
- Exchange: STEP derived from a successful exact realization (must be receiver-qualified under a named receiver/version/profile; emit only does not pass).
- Optional additive derivatives: 3MF/STL, always labeled derivative and unreleased.
- Printable CSG: separate OpenSCAD source-native authority profile (not interchangeable with precision authority).
- Imported geometry without reproducible source: authoritative only as a pinned imported artifact; no feature history is invented.
- Human state: request changes or accept for MVI review (acceptance is not engineering approval).
- Fabric/release state: distinct `DraftExport` (visibly unreleased), `ApprovalRecord` (signed scoped), and `FabricationRelease` (separate signed human act). Stage 1 implements only the immutable, canonical `DraftExport` framework receipt (`piton.draft-export-receipt.v1`); it implements no deliverable-writing endpoint, engineering-approval issuance, fabrication release, or machine actuation.

## Stage 1 wedge

One consequential single Part, one bounded partner-driven parameter
mutation, one writable browser-local TypeScript authority, one optional pinned precision
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

### Local daemon command admission

`LocalDaemonCommandAdapter` is the implemented Linux-local transport boundary
for typed custody commands. It accepts a connected AF_UNIX socket, derives the
peer UID from kernel-owned `SO_PEERCRED`, and resolves that UID through a copied,
server-owned UID-to-principal mapping. Unknown UIDs fail closed. The command
envelope, every command payload, source-tree records, and parameter mappings are
closed before the adapter invokes the sole `PitonApplicationService`; callers
cannot add identity, credentials, grants, policy, approval, release,
`fabrication_release`, or `machine_actuation` claims.

The adapter is Linux-specific and intentionally has no fallback identity path
when AF_UNIX peer credentials are unavailable. Socket creation and permissions,
lifecycle management, and provisioning of the server-owned UID mapping remain
deployment/composition responsibilities. Peer identity is command-admission
evidence only: it is not durable human-authorization issuance, custody, or
verification and cannot imply review acceptance, engineering approval, export,
fabrication release, or machine actuation.

## Stage 1 durable lifecycle (ten distinct concepts)

`ChangeProposal` → `ProposalDisposition` → `DesignRevision` → `BuildAttempt` → `EvidenceClosure` → `ChannelPointer` → `ApprovalRecord` → `DraftExport` → `FabricationRelease` → `ReleasedPackageProjection`.

No two of these collapse. The forbidden implications chain is in `docs/mvi-doctrine.md`.

The browser OPFS schema version 3 gives every concept a distinct strict SQLite
table and a distinct closed TypeScript record. Caller writes are limited to
current-head-CAS proposals and dispositions plus revision-bound admitted build
attempts; expected-version CAS controls channel movement. Successful/terminal
attempt states and evidence closure require trusted coordinator custody, which
the browser repository does not mint or accept from callers. Approval-, export-,
fabrication-release-, and released-package-shaped tables are likewise inert
under Stage 1: the repository has no issuance path for them, and release/actuation
columns are constrained to false. Mutable `build_status` remains preview status
and is not a `BuildAttempt`.

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
closure cells are not treated as an authority boundary. Before launch, the daemon
copies the admitted source package and lockfiles into a private symlink-free snapshot,
verifies the revision-bound source and lock digests, closes every snapshot file into
an input-bundle digest, and passes only sandbox-internal input and output paths.
The request binds the exact project, revision, source manifest, recipe,
Python/build123d/OCP toolchain, capability/resource/output manifests, request
signature reference, and `precision_worker_one` implementation pin. The first
implementation remains `trusted-local`, not container, microVM, or WASM. The daemon
launches that snapshot through Bubblewrap with a read-only input mount, read-only
runtime mounts, a writable build-attempt root, private process/network namespaces,
an empty temporary home, and a closed environment. The child cannot attest this
boundary from ambient variables. Both the child and parent-visible result conservatively
retain `network_isolation_proven=false`; successful namespace setup is not promoted
into a durable authority claim in this slice. Broad read-only runtime mounts remain
unmanifested, so `credential_isolation_proven` also remains false. No result-signature
claim is made.

`PrecisionWorkerResult` is a frozen, canonical, attempt/request-bound execution
fact. Success requires exact closure over all seven roles from
`precision_worker_one:piton.realization-and-review.v3`: exact BREP, STEP, exact
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

Publication is a durable two-boundary protocol. Before any artifact metadata is
visible, the daemon rechecks the exact attempt, project, revision, worker-result
digest, generation, fence, current live lease, declared role, media type, byte
length, digest, and storage address, then records
`artifact_publications.state=committing`. Verified bytes are fsynced and promoted
without replacement to `.piton/objects/sha256/`; only then may one
`BEGIN IMMEDIATE` transaction insert artifact references, receipts, the closure,
and an `evidence.closure.committed` outbox row and transition the publication to
`committed`. The event payload is itself CAS-custodied. Pending rows retain
`delivered_at=NULL` and monotonic `delivery_attempts`, so delivery can resume
idempotently after restart without recreating or changing the closure.

On startup, `recover_incomplete_publications` scans durable `committing` rows.
An attempt that never reached the closure transaction is failed closed, its owned
output scope is moved under
`.piton/quarantine/startup-incomplete-publication`, and its publication becomes
`quarantined`; no closure, channel, review acceptance, approval, export, or
release is inferred. Operators retain quarantine and diagnostics for inspection
rather than deleting or selecting a nearest artifact. Recovery never mutates
authored revisions or review/release state and always preserves
`fabrication_release=false` and `machine_actuation=false`.

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

### Framework-packet closure

`FrameworkPacketClosure` is a frozen, canonical, non-persistent confirmation
that one exact validated packet remains ready for human review. Its packaged
`piton.framework-packet-closure.v1` schema rejects unknown fields and fixes
`review_state=needs_human_review`, `fabrication_release=false`,
`machine_actuation=false`, `release_state=unreleased`, and
`channel_transition=false`. `PitonApplicationService.close_framework_packet`
re-reads the exact project-scoped `EvidenceClosure`, independently validates the
packet file inventory and bytes, and requires exact agreement for project,
revision, attempt, closure, packet, worker result, declaration,
generation/fence/lease, exact B-rep/STEP, and review-only GLB/selection-map
digests. Closure is not review acceptance, engineering approval, channel
promotion, export, fabrication release, or machine actuation.

### Readiness-packet closure with G2 unaccepted

`ReadinessPacketClosure` is a frozen, canonical, readiness-evidence-only record
binding one explicit 40-hex candidate commit to the canonical digest of one
explicitly supplied `ReadinessCampaign`. `close_readiness_packet` independently
runs `verify_readiness_campaign`; it rejects incomplete or inconsistent ordered
seed coverage, schedule identities, outcomes, aggregate counters, input binding,
and root truth. It performs no `latest`, filename, channel, nearest-identity, or
inferred candidate lookup. The packaged `piton.readiness-packet-closure.v1`
schema fixes exactly 1,000 runs and every critical counter to zero while fixing
`review_state=needs_human_review`, `g2_accepted=false`,
`fabrication_release=false`, and `machine_actuation=false`. This closure records
readiness evidence only: it does not accept G2, complete Stage 1, mutate authored
source or revisions, grant human review, export, release, channel transition, or
machine authority.

### P3 governed-alpha and P4 assurance authority

P3 admission is controlled by one closed `GovernedAlphaEvidence` record, not by
free-form launch notes or worker success text. The record binds one project,
derived revision, durable successful build attempt, `EvidenceClosure`,
`FrameworkPacketClosure`, review packet, and four derivative identities. Its
claim scopes are fixed: exact B-rep is `exact-realization`, STEP is
`exact-exchange`, and the GLB and artifact-local selection map are each
`review-only`. It also fixes `review_state=needs_human_review`,
`fabrication_release=false`, `machine_actuation=false`,
`release_state=unreleased`, and `channel_transition=false`. A P3 phase-exit
receipt requires exactly one repository-native artifact containing that closed
record, exact P2 predecessor ID/digest binding, completed execution, and an
advance disposition. These checks validate a review-evidence candidate only.
`P3ReviewEvidenceBundle` is caller-provided evidence, is not daemon custody, and
cannot mint or confer successor authority even when every identity, digest, and
packet byte is self-consistent.

Trusted durable human authorization issuance and verification are not
implemented in this Stage-1 slice. Every `Authority.HUMAN` advancement therefore
fails closed with an explicit reason; caller-selected enums, records, verifier
objects, database rows, and P3 evidence bundles are never authority. The local
daemon adapter now derives mapped AF_UNIX peer identity and admits closed typed
commands, but that transport identity does not issue, custody, or verify durable
human authorization. Until a separate durable human-authority mechanism lands,
P4 cannot be admitted from P3.

P4 has a separate, source-native policy authority. `P4AssurancePolicy` freezes
policy identity, ordered requirements, method/comparator digests, thresholds,
named environments, and invalidation conditions before evaluation.
`DEFAULT_P4_ASSURANCE_POLICY` is the only policy authority accepted by portfolio
admission; a caller-supplied lookalike policy has no authority. One closed
`P4AssuranceEvidence` record binds `policy_digest` and the exact ordered
`evaluated_requirement_ids`. `validate_p4_evidence_policy_binding` recomputes the
canonical default-policy digest and requires both bindings to match exactly.
When a predeclared manual evaluation is unavailable,
`emit_unavailable_p4_receipts` emits one closed `P4AssuranceReceipt` per policy
requirement in declaration order. Each receipt binds the policy, method,
comparator, threshold, environments, and invalidation conditions while fixing
`availability=unavailable`, `threshold_passed=false`, and `evidence_refs=[]`.
These receipts record missing evidence; they do not satisfy a requirement or
advance review, approval, export, release, channel, or actuation state.
The evidence result is deliberately limited to `hold`, `rework`, `stop`, or
`reject`; it cannot self-declare advancement. P4 remains a human judgment gate,
and policy/evidence validity never implies review acceptance, approval, export,
release, channel transition, or actuation.

Admission and review stop on a missing/extra record or field; a schema,
canonicalization, identity, predecessor, policy-digest, requirement-order, or
claim-scope mismatch; any changed policy input without fresh evidence; any
non-human judgment authority; or any root-truth escalation. No fallback policy,
nearest identity, stale packet, or prior digest may be substituted.

## Stage 1 custody

Git-friendly local directory of deterministic UTF-8 source/manifests and
content-addressed binary assets. SQLite journals/query metadata and
mutable refs. SQLite pages, one giant JSON file, viewer state, and
adjacent mutable sidecars are not portable authority. Full golden path
disconnected. No-clobber atomic CAS promotion, one `BEGIN IMMEDIATE`
closure transaction, restartable idempotent outbox.

Portable project backup consists of deterministic canonical JSON metadata and
immutable CAS payloads. Its manifest binds schema/version, creation metadata,
project identity, the exact metadata/object inventory, media types, byte lengths,
digests, safety state, and explicit claim-scope exclusions. Raw SQLite database,
WAL, SHM, cache, staging, quarantine, viewer state, and mutable sidecars are
excluded. A completed backup returns an authenticated `BackupIdentity` issued by
the custody signing process; restore requires that identity to be pinned outside
the backup directory and rejects caller-recomputed checksums or forged identities.

Restore validates the complete closure before publication, refuses to replace an
existing project, promotes exact payloads by no-clobber CAS identity, and inserts
portable metadata in one transaction against the current schema. Failed metadata
publication can leave only harmless unreferenced CAS bytes. Retention is a separate
authenticated operation: dry-run is the default, and application may prune only
verified unreferenced CAS objects absent from metadata authority. Project deletion
is admitted through an authenticated typed, idempotent command and records a
tombstone; it does not erase immutable revision/evidence history or referenced CAS.
None of these custody operations changes authored revisions, human-review state,
fabrication release, export authority, or machine-actuation authority.

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

### Browser-qualification evidence boundary

`piton.browser-qualification-receipt.v1` is a closed, derived diagnostic
receipt for one exact packet digest and one exact declared browser row. The
reader recomputes packet custody, rejects missing or substituted environment
fields, applies source-fixed size/startup/interaction/memory/CPU/failure
budgets, and records disconnected-network, visible-identity, interaction,
build-plane, golden-path, and failure-injection observations. It has no
authored-source, revision, lifecycle, review-decision, channel, export, release,
or machine authority.

The current API accepts caller-supplied observations only. Such observations
cannot prove controlled browser execution, so every emitted receipt includes
`provenance.controlled_browser_execution_missing` and remains `status=failed`.
This is derived review qualification evidence, not a successful supported-row
qualification. A future controlled harness requires a separate source-fixed
admission boundary; callers cannot remove this failure with a flag or
self-consistent digest. Regardless of diagnostic completeness, the receipt
retains `review_state=needs_human_review`, `fabrication_release=false`,
`machine_actuation=false`, `release_state=unreleased`, and
`channel_transition=false`.
