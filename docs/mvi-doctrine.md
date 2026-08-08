# Piton canonical MVI doctrine

## Origin and ancestor prototype

Piton was named after the OpenDesign R14 Bench Clamp Fixture prototype
that produced the controlling current verified interaction vocabulary and
the original Stage 0/Stage 1 design. Every Piton doc is a derivative of
that prototype’s exact behavioral baseline plus the post-prototype
exhaustive review and admission corrections.

- Project: `8da9ea71-1dce-454a-bc4a-7e835eadfdd5`
- Conversation: `76d3d331-cb2e-4a40-aca7-f6737ea538fe`
- Authoring revision: `r14-05729d28`
- Artifact URL: https://silas-workstation.taild7c550.ts.net:8443/api/projects/8da9ea71-1dce-454a-bc4a-7e835eadfdd5/raw/index.html?revision=r14-05729d28
- Conversation URL: https://silas-workstation.taild7c550.ts.net:8443/api/conversations/76d3d331-cb2e-4a40-aca7-f6737ea538fe/files/index.html
- Local mirror root: `cad_mvi_opendesign/` (R1..R14 source pins, contracts, and
  reproducer scripts)
- Source of doctrine: `/home/silas/.hermes/profiles/nick-mercer/workspace/reports/mechanical-cad-mvi-exhaustive-final-report-2026-08-06.md`

Stage 1 in this repo implements the controlling technical decisions of
that report. R14 is the interaction fixture (review evidence), not the
production loop.

## Identity of “MVI”

There are two distinct meanings, deliberately disambiguated:

- **R14 interaction MVI** — Matt’s exact minimum interaction fixture
  (the OpenDesign R14 Bench Clamp Fixture). Evidence of capability, not
  a product claim.
- **Production Mechanical CAD MVI** — the gated Stage 1 engineering
  loop defined by this repo, the plan documents P0..P5, and the
  exhaustive report.

These are not interchangeable. Stage 1 is not implemented by R14 bytes.

## Truth boundary (controlling invariants)

```text
review_state       = needs_human_review
fabrication_release = false     (cannot be enabled by tests, workers,
                                 agents, imports, exports, or build success)
machine_actuation  = false     (no CNC, printer, laser, slicer,
                                 G-code, robot, or CAM)
```

Every other property below assumes this invariant.

## Authority (10.1)

- One writable authority per revision. Initial precision intent is an
  immutable `DesignRevision` using `source-native/v0` with a pinned
  Python/build123d source tree, entrypoint, dependency lock, and
  toolchain lock.
- Semantic Part/feature/parameter/requirement records are read-only
  query/navigation/evidence overlays. Generated text is never a second
  writable copy.
- Printable CSG uses a separate OpenSCAD source-native profile; it is
  not interchangeable with precision authority.
- Imported geometry without reproducible source is authoritative only
  as a pinned imported artifact; no feature history is invented.
- Exact query authority is a pinned exact realization plus receipt.
- Display/picking authority is a revision/build-scoped GLB plus
  artifact-local selection map.
- Approval and fabrication use their own signed records.
- Authority migration creates a new immutable revision and migration
  receipt. It never toggles authority in place and never enables
  simultaneous graph/source editing.
- A writable `mechanical-document/v1` subset is allowed only after
  30–50 real wedge sequences prove ≥80% valuable-revision coverage,
  ≥90% new-model coverage, lossless native escapes, one authority after
  every operation, migration/historical-reopen coverage, and
  topology-gate success. Failure means source remains authoritative
  indefinitely.

## Project format and custody (10.2)

- Git-friendly local directory of deterministic UTF-8 source/manifests
  and content-addressed binary assets.
- SQLite journals/query metadata and mutable refs.
- SQLite pages, one giant JSON file, viewer state, and adjacent mutable
  sidecars are not portable authority.
- Stable-format claims require: Unicode normalization, canonical
  key/record ordering, quantity grammar, duplicate rejection,
  path/symlink rules, line endings, archive metadata, unknown-record
  preservation, canonicalization version, cross-language digest
  fixtures.

## Representation taxonomy and exports (10.3)

Every derivative must name source artifact/revision, build,
toolchain/environment, units, tolerance or tessellation policy, digest,
and `claim_scope`.

- **Exact B-rep** — pinned derived realization, subject of exact
  queries under a named environment.
- **STEP** — principal exact-exchange derivative, not editable
  feature/mate round-trip authority. Emitted only from a successful
  exact realization. Receiver qualification requires a named
  receiver/version/profile and readback.
- **GLB** — review/picking only, carries an artifact-local selection
  map. `claim_scope=review-only`.
- **3MF** — preferred when additive package semantics matter.
  Package integrity, unit, model/object/build relationships required.
- **STL** — assumed-units derivative, never implies release.
- Healing, translation, normalization, tessellation, and conversion
  create new identities and receipts. Converting a mesh to an OCCT
  shell does not recover analytic intent.
- A `DraftExport` must name revision, authority profile, exact
  body/STEP digests, units, warnings, environment lock, validation
  report, and visible `unreleased` state.

## Viewer contract (10.4)

CURRENT VERIFIED (R14, must remain implemented):

- Part/Assembly fixture distinction
- Source-Part vs occurrence navigation
- Per-document Smart/Face/Component selection modes
- Separation of current selection from attached context
- Model tree (implemented semantically)
- Implemented semantic selection highlights (faces,
  components/references, origins, planes, mates)
- Iso/Front/Top/Fit and roll controls
- CAD-Z=0 physical-grid mapping
- Review-mesh measurement
- Explicit exact-vs-mesh/fabrication-blocked disclosure

TARGET additions (must be implemented on top of CURRENT VERIFIED; not
claims of R14 behavior):

- Revision-pinned packets (immutable derivatives; cannot mutate source)
- Source-parameter panels
- Selected-zone callouts
- Explicit bounding-box display/reset control
- Controlled build-volume envelope
- Validation/issue overlays

The viewer consumes a pinned review artifact, selection manifest,
revision/build IDs, occurrence/entity IDs, validation overlays, and
camera presets. Raw picks translate through artifact-local maps.
Where floor contact is required, CAD Z-min=0 must be verified in
exact, review, and exported geometry, and the Three.js world mapping
must be verified independently.

## One application service and command admission (10.5)

- GUI, deterministic text, CLI, API, import, MCP, extensions, and
  agents adapt to one query/proposal/preview/commit/build/promote/
  review/approve/export/release application service.
- AI has no privileged mutation route. MCP is transport/discovery
  only.
- Every boundary performs runtime schema validation, unit checking,
  revision conditioning, strict idempotency, scope/effect/capability/
  policy checks, and server-derived identity. Caller-supplied actor,
  grant, or policy data is untrusted assertion.
- Same idempotency key and same canonical request returns the stored
  receipt; same key with different content fails.
- Stale base returns a typed conflict; no blind retry or silent
  rebase.
- Preview is ephemeral; commit creates exactly one authored revision;
  build is separate.
- Exact query results include revision, selection, value/unit,
  representation derivation, evaluator/comparator digests, tolerance,
  warnings.

## Durable lifecycle separation (10.6)

These ten concepts are distinct states. Each has its own typed record.

1. `ChangeProposal` — immutable intent against exact base. Scope,
   operations, uncertainty, provenance.
2. `ProposalDisposition` — append-only submitted/withdrawn/rejected/
   changes-requested/accepted-for-build/accepted-for-review decision
   using current-head CAS. Acceptance is not approval.
3. `DesignRevision` — immutable authored state with one authority
   profile. May exist without a successful build.
4. `BuildAttempt` — durable execution attempt. Retries are new attempts.
5. `EvidenceClosure` — immutable requirement-linked evidence over
   exact revision, successful attempt, artifacts, method, environment.
6. `ChannelPointer` — mutable workspace/candidate/review ref moved
   only by expected-head plus generation CAS.
7. `ApprovalRecord` — immutable signed scoped engineering decision
   over exact revision and evidence closure.
8. `DraftExport` — visibly unreleased deliverables and validation
   manifest.
9. `FabricationRelease` — separately signed act over exact approval,
   revision, deliverables, validation, environment, policy, releaser.
10. `ReleasedPackageProjection` — readback only, never release
    authority.

Workers cannot mutate authored state or channels. Failed builds cannot
replace last-good. Undo/rollback is restore-forward into a new revision.
Approval/release issuance facts are immutable; signed append-only
events express supersede/suspend/expire/recall/reinstate/waive/amend
without changing original bindings.

## Forbidden implications chain

Every pairing below is a documented fact, not a stylistic choice:

```text
proposal accepted  != engineering approved
preview completed  != revision committed
revision committed != build succeeded
build succeeded    != channel promoted
channel promoted   != approved
approved           != exported
exported           != released
released           != machine actuation
build success      != review acceptance, approval, export, release,
                     or machine actuation
review geometry    != exact geometry
```

The chain is exhaustive for the durable lifecycle. Any text or UI that
collapses two adjacent rows fails review.

## Evidence closure (10.7)

Every receipt binds:

- requirement/check ID
- exact revision
- successful `BuildAttempt`
- artifact digests
- checker/procedure and comparator/policy digests
- environment/toolchain
- units/tolerance/method
- result/uncertainty/warnings
- invalidation conditions

Schema, solid validity, exact geometry, references, assembly,
clearance, process heuristics, analysis, human review, approval, and
release policy are separate layers. Passing one does not imply another.
Simulation never authorizes fabrication.

## Identity and topology (10.8)

Distinguish:

- Durable semantic entity
- Source/operation identity
- Exact topology observation scoped to realization/environment/
  revision/occurrence
- Review primitive scoped to one artifact

Labels, indices, face ordinals, triangle IDs, Three.js UUIDs, and
nearest geometry are not durable identity.

Resolution order: authored datum/connector/whole feature/parameter →
exact-cardinality semantic query → proven operation lineage →
geometric signatures as repair candidates only → explicit human
repair. Outcomes are typed: resolved/preserved/split/merged/new/
deleted/ambiguous/missing/blocked. Ambiguous or missing release-
critical references **block**. Nearest-face fallback is forbidden.

Generic persistent topology is excluded from Stage 1. An operation/
reference class requires at least 100 independently labeled
representative edits, zero silent wrong release-critical rebindings,
ambiguity blocking, no nearest fallback, acceptable predeclared
unresolved rate, supported patch stability. One silent wrong binding
removes the claim.

## Worker architecture (10.9)

Start with a modular monolith:

```text
workbench / review / thin desktop
  -> editor / viewer / text / MCP adapters
  -> document and runtime contracts
  -> local daemon
       custody / commands / revisions / durable jobs / artifacts
       grants / policy / channels / approval / export / release
  -> SQLite journal/query metadata + CAS blob store
  -> isolated precision and printable workers
```

- Browser/Electron renderer has no direct filesystem, credential, SQL,
  process, kernel, approval, or release authority.
- Persist `BuildAttempt` before dispatch. Requests bind exact revision,
  immutable input manifest, recipe, toolchain, capabilities,
  resources, worker identity, lease, fence, expected outputs,
  signature. Results are authenticated, attempt-bound, signed, and
  attest actual environment/isolation and output closure.
- Worker text saying success is insufficient.
- Generated/imported/plugin geometry code is hostile by default:
  read-only immutable inputs, no network by default, no host
  home/credentials/ambient environment, bounded scratch/output,
  CPU/RAM/time/process/output quotas, attempt-scoped identity,
  project/tenant separation, authenticated transport, signatures,
  image pinning, lease/fencing, validated import.
- Receipts name the actual isolation class: `wasm`, `container`,
  `microvm`, or weaker `trusted-local`.
- Build keys include full authored state, source, dependency
  revisions, locks, runtime image, backend, units/tolerances,
  export/tessellation policy, policy version.
- Cache is acceleration only; it never carries approval/release or
  authorizes reuse of topology maps, toolpaths, drawings, simulations,
  or evidence without exact closure.

## Local-first and crash consistency (10.10)

- Local source/revisions/proposals/history/artifacts/evidence.
- Complete supported golden path disconnected.
- Same contracts locally/cloud.
- Dependency locks and local cache/mirror.
- Immutable-object/CAS-ref sync.
- Optional attested cloud workers.
- No paywall for canonical reopen, migration, rebuild, authoring, or
  export.
- Publication across blob store and SQLite uses attempt-scoped
  same-filesystem staging, validation/digest/fsync, no-clobber atomic
  promotion into CAS, parent fsync, one `BEGIN IMMEDIATE` closure
  transaction that rechecks attempt/lease/fence/input closure and
  writes manifests/refs/outbox, then restartable idempotent outbox
  delivery.
- Promotion, approval, release are separate CAS/serializable
  transactions.
- Recovery scans committing attempts, staging, CAS, outbox; incomplete
  closure never publishes.
- Fault injection surrounds sync, rename, SQL, commit, delivery.

## Capability packages (10.11)

Four isolation tiers:

1. **Schema packages** — inert declarations, JSON Schema, bounded
   invariants, declarative migrations. No native/WASM/script execution.
2. **UI packages** — inspectors, overlays, dashboards, and import/
   export UI in a separate origin/process using message/command APIs.
   No direct filesystem, network, credentials, SQL, or workers.
3. **Compute packages** — kernels, operators, solvers, exporters,
   checkers, simulation, CAM in isolated WASM/native/container/remote
   workers over immutable manifests, explicit grants, quotas, network
   policy, signed outputs.
4. **Automation packages** — MCP, CLI, agents, scripts, remote
   services out of process and untrusted, using the same
   authenticated query/proposal API as human clients.

Manifests pin identity/version/license/digest/signature, compatibility,
effects/permissions, resource/network/native/model needs,
determinism, runtime, limits, migrations, conformance, performance,
provenance, revocation, retention, qualification.

Stage 1 allows first-party immutable entries and inert/declarative
templates only; no arbitrary executable marketplace.

## Assembly scope (10.12)

Assemblies are not Stage 1 implementation scope. R14’s occurrence/
source navigation and review-only mate vocabulary remain interaction
evidence only.

Expansion order:

1. Reliable consequential single-Part revision
2. Static revision-pinned occurrences
3. Explicit transforms and one grounded occurrence
4. Named connector frame-to-frame fixed/rigid relations
5. Only proven revolute/slider joints thereafter

General face mating, broad mate catalogs, nested assembly editing,
large assemblies, contact simulation, full motion solving, and
in-context cross-Part features are excluded. Missing/ambiguous
connector endpoints block; partial resolution is not “solved”; Part
updates are explicit and impact-previewed.

## Stage 0 / Stage 1 split

### Stage 0 inputs to Stage 1

- At least 12 interviews in one segment.
- Observation of at least five real revision/release jobs.
- At least three paid or contractually committed design partners
  supplying real models and revisions.
- Baselines for reviewer time, authoring overhead, escaped changes,
  support, rebuild, handoff failure.
- Bounded build-versus-adopt comparison.
- One repeated costly workflow with credible evidence of ≥30% lower
  reviewer/release effort, or material escaped-change reduction
  without equivalent authoring overhead.

If users mainly value generation, narrow to generation/review. If an
incumbent wins, adopt/integrate/rebase/become governance companion.
If no repeated paid workflow exists, stop.

### Stage 1 (exact slice)

One consequential single Part, one bounded partner-driven parameter
mutation, one writable source-native authority, one pinned precision
worker, three to five predeclared checks selected from observed
reviewer decisions, plus the loop:

```text
inspect immutable accepted base revision
  -> normalize requirements, assumptions, units, interface parameters
  -> create immutable ChangeProposal against exact base
  -> append ProposalDisposition for build/review
  -> commit one immutable candidate DesignRevision
  -> create durable isolated BuildAttempt
  -> realize exact B-rep and STEP
  -> derive revision-pinned GLB review projection
  -> derive 3MF/STL only when requested
  -> run predeclared deterministic checks
  -> publish artifact manifest and EvidenceClosure
  -> compare candidate with exact base/last-good
  -> human engineering review
  -> issue scoped ApprovalRecord or reject/request changes
  -> optionally create visibly unreleased DraftExport
  -> keep FabricationRelease separately blocked until authorized
     human act
  -> reopen and restore-forward while disconnected
```

### Stage 1 acceptance

- 25/25 predeclared end-to-end scenarios with zero false success and
  zero false release.
- 1,000 injected fault/concurrency runs with zero missing referenced
  artifacts, stale promotion, duplicate external effects, unauthorized
  approvals/releases, or cross-project reads.
- Create, commit, realize, check, compare, review, restore, export,
  reopen disconnected.
- UI and agent surfaces produce equivalent admission, authorization,
  stale-base, idempotency, and receipt semantics.
- Failed builds preserve diagnostics and never displace last-good
  display.
- Exact and review representations remain visibly distinct.
- Unsupported topology resolution never silently binds release-
  critical references.
- Human review and separate fabrication release remain distinct.

First-render quality, chat polish, package count, task throughput,
or successful STEP emission alone do not pass.

## Browser, CDN, license, privacy, performance (13)

- Vendored exact dependency bytes with hashes and notices for any
  controlled/offline review packet.
- CSP enforced.
- Tested disconnected load.
- Recorded license obligations.
- Stage 1 defines supported browsers/OS/GPU or a signed desktop/
  daemon route.
- Model-size, startup, memory, CPU, battery, interaction-latency,
  output-size, and graceful-failure budgets.
- WCAG 2.2 AA evidence with named browser/assistive-technology
  combinations.

## Implementation boundary checklist (14)

A Stage 1 design/code review must answer yes to every applicable item.

**Authority**

- One writable authority per revision
- Python/build123d initial precision authority
- Semantic/source projections read-only
- Migration creates new revision and receipt

**Lifecycle**

- Proposal, disposition, revision, build, evidence, channel,
  approval, export, release separate
- Stale base and idempotency conflicts typed and fail closed
- Worker cannot move channel or mutate authored state
- Restore-forward replaces rollback mutation

**Geometry**

- Exact B-rep, STEP, mesh, and review projection scopes explicit
- Every derivative names revision/build/toolchain/units/tolerance or
  policy/digest
- Viewer pinned to reviewed/exported revision
- Receiver-qualified STEP distinct from file emission

**Identity**

- References include revision and occurrence scope
- Labels/indices/ordinals/triangles/Three.js IDs barred from durable
  identity
- Ambiguity blocks; no nearest-face rebinding

**Workers/security**

- Durable attempt before dispatch
- Signed, pinned, fenced, scoped, validated requests/results
- Generated-code workers networkless and credentialless by default
- Quotas and actual isolation class recorded
- Stale/late/partial/cross-project output cannot publish

**Custody/crash consistency**

- Full golden path disconnected
- Staging/fsync/atomic CAS promotion/one closure transaction/outbox
  protocol
- Fault injection proves no metadata points to missing blobs
- Sync replicates immutable objects and CAS refs, not database pages

**Review/release**

- Evidence requirement/revision/artifact/environment scoped
- Human approval immutable and scoped
- Export visibly unreleased
- Release names immutable digests, never `latest`
- Approval/release status changes are append-only signed events

**Product/UI**

- Current and attached selections visibly separate
- Exact and review measurements visibly distinct
- Last-good remains displayed on failure
- Stale proposal/context requires reconfirmation
- Preserve verified R14 interaction surfaces and separately
  implement/test the TARGET-only source-parameter panel,
  selected-zone callout, explicit bbox/reset, controlled build
  volume, issue overlays, and revision-pinned packet requirements
- Keyboard/nonvisual alternatives and responsive truth visibility
  verified

## Rollout gates (15)

- **G0** demand/build-versus-adopt: all Stage 0 evidence; otherwise
  stop/narrow/integrate.
- **G1** security: complete signed security evidence before untrusted
  code execution.
- **G2** governed source-native MVI: 25/25 end-to-end and 1,000
  fault/concurrency runs with zero critical violations.
- **G3** typed authority: 30–50 real sequences, 80% valuable-revision
  coverage, 90% new-model coverage, one authority, explicit escapes,
  migration/reopen fixtures; otherwise retain source authority.
- **G4** topology/reference class: 100 labeled edits, zero silent
  wrong release-critical binding, ambiguity blocking, no nearest
  fallback, acceptable unresolved rate, supported patch stability.
- **G5** static Assembly: only after reliable single-Part work;
  require 2–10-part partner fixtures, revision-pinned components,
  named connectors, update previews, traceable fixed/rigid relations.
- **G6** receiver-qualified STEP: one named receiver/version/profile
  and tested readback with declared losses.
- **G7** paid cohort: six months, three paid partners in one segment,
  ten revision/review/release cycles, ≥30% median effort reduction or
  material escaped-change reduction, ≥2/3 renewal intentions, gross
  margin >50%, no cloud-only canonical operation, ≥25% lower repeat
  qualification cost.
- **G8** curated executable capabilities: migration, demand, ABI,
  security, revocation, sandbox, retention, funded ownership gates;
  marketplace remains optional.
- **G9** multi-agent/domain expansion: named customer triggers,
  accountable qualified owners, improved accepted useful revisions
  per reviewer-hour/dollar, two independent tools/partners per new
  domain proving contract value.

Stage 1 deliverable corresponds to G2; P0..P5 plans in this repo map
to G0..G2 progression.

## Stop and reversal conditions (16)

- No repeated paid workflow or three committed partners → stop or
  narrow to generation/review.
- Existing product wins comparison → adopt, integrate, rebase, or
  become governance companion.
- Routine source escape, missed 80%/90% typed thresholds, or dual
  authority → retain source authority.
- Any silent wrong release-critical binding → remove that topology
  claim and use authored semantics.
- No paid demand/equivalence evidence for second backend → remain on
  one OCCT generation.
- Browser execution repeatedly misses device/offline constraints →
  use signed local daemon/desktop; do not force browser-only.
- Assurance does not reduce review effort or escaped changes →
  simplify to generation/inspection/revision/review.
- Managed margin below 50% while value passes → reduce managed-
  service scope, not local custody.
- Safe physical merge rare → keep proposal comparison and mandatory
  replan; no auto-merge claim.
- Plugin security/retention/revocation/ownership demand fails →
  remain curated indefinitely.
- Agent fan-out lowers reviewer-adjusted value → use bounded single-
  agent assistance.
- Repeat qualification cost fails to improve 25% → treat corpus as QA,
  not moat.
- Incumbent ships superior portable semantic revisions, open exact
  local execution, and governed agents → integrate, narrow, or become
  governance adapter.

## Explicit exclusions (17)

Stage 1 does not include: universal text-to-CAD; CAD replacement;
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
viewer authority.

R14 approximate source and STL remain excluded from exact/fabrication
artifacts.

## Glossary (18)

| Term | Definition |
| --- | --- |
| Accepted-for-build / accepted-for-review | a `ProposalDisposition`; authorizes a bounded next activity, not engineering approval |
| ApprovalRecord | immutable signed scoped engineering decision over one exact revision and evidence closure |
| Authoring authority | the single writable representation defining authored intent for one revision/profile |
| BuildAttempt | durable execution attempt for one exact revision and recipe; retry creates another attempt |
| Candidate | a revision or channel state under review; not approved or released by implication |
| ChangeProposal | immutable proposed intent against an exact base; not a mutation |
| ChannelPointer | mutable CAS-controlled reference such as workspace/candidate/review |
| DesignRevision | immutable authored state; may exist without a successful build |
| DraftExport | validated deliverables explicitly marked unreleased |
| EvidenceClosure | immutable requirement-linked receipts closing over exact revision, attempt, artifacts, methods, environment |
| Exact B-rep | kernel realization scoped to pinned revision/environment/tolerance; not universal authoring authority |
| FabricationRelease | distinct signed human act authorizing named immutable deliverables under policy |
| Fixture semantic review ID | application-level string/heuristic region scoped to the R14 in-memory artifact; not durable topology |
| Last-good | most recent policy-qualified displayed revision; failed builds do not replace it |
| MVI | context-dependent: “R14 interaction MVI” = Matt’s exact minimum interaction fixture; “Production Mechanical CAD MVI” = gated Stage 1 engineering loop |
| Promotion | CAS move of a channel pointer; not approval |
| Proposal draft in R14 | detached, in-memory, prepared-not-sent object; not `ChangeProposal` |
| Review mesh/projection | discretized/display artifact for visual review/picking; not exact geometry or release |
| Restore-forward | new revision recreating prior intent; accepted history is not rewritten |
| Release | `FabricationRelease`; never inferred from build, approval, export, or package projection |
| STEP | exact-exchange derivative from a successful pinned realization; not native editable history |

## Local Piton plan identifiers

The current 6-plan chain is part of this doctrine:

| Order | File | plan_id |
| --- | --- | --- |
| P0 | `plans/p0-discovery.md` | `piton-mvi-p0-discovery-category-decision-2026-08-06` |
| P1 | `plans/p1-feasibility.md` | `piton-mvi-p1-exact-cad-feasibility-receiver-2026-08-06` |
| P2 | `plans/p2-custody.md` | `piton-mvi-p2-local-custody-revision-core-2026-08-06` |
| P3 | `plans/p3-governed-alpha.md` | `piton-mvi-p3-governed-build-review-alpha-2026-08-06` |
| P4 | `plans/p4-assurance.md` | `piton-mvi-p4-assurance-accessibility-reliability-2026-08-06` |
| P5 | `plans/p5-partner-gate.md` | `piton-mvi-p5-partner-alpha-commercial-gate-2026-08-06` |

Inter-plan dependencies run P0 → P1 → P2 → P3 → P4 → P5.

## Cross-references in this repository

- `README.md` — piton overview and verification entrypoint
- `AGENTS.md` — repository agent contract, hard safety invariants
- `docs/mvi-doctrine.md` — this document
- `docs/architecture.md` — architecture boundary (must align with this
  doctrine)
- `docs/fabrication-safety.md` — fabrication safety boundary
- `docs/implementation-loop.md` — loop contract; mirrors
  `.otoxan/flows/piton-implementation-loop-v1.md`
- `docs/rollback.md` — restore-forward policy
- `.otoxan/context.md` — repository context
- `.otoxan/rules/safety.md` — eight hard safety rules
- `.otoxan/flows/piton-implementation-loop-v1.md` — implementing loop
- `.otoxan/flows/codebase_create_v1.md` — repository create record
- `flows/piton_implementation_loop_v1.json` — runtime flow spec
- `cad_mvi_opendesign/` — R1..R14 ancestor prototypes, contracts,
  reproducer scripts

## Source register

This document is the in-repo canonical mirror of `/home/silas/.hermes/profiles/nick-mercer/workspace/reports/mechanical-cad-mvi-exhaustive-final-report-2026-08-06.md` (MVI doctrine, sections 9–18). It supersedes inline text in any plan or doc where text disagrees with this file.
