# Human review of launch artifacts

These assets prepare evidence for a person; they do not approve, export for fabrication, release, promote a channel, or actuate a machine. Every generated packet must retain `review_state=needs_human_review`, `fabrication_release=false`, and `machine_actuation=false`.

The primary runnable reviewer path is the browser workbench below. The later Python procedures cover the optional external exact-CAD/reference adapter and lifecycle-framework evidence; they supplement the browser MVI and are not its writable authored authority.

## Browser workbench review

1. From a fresh checkout, launch the exact browser graph and cross-origin-isolated local origin with the repository-native launcher. It resolves the checkout root, runs `pnpm install --frozen-lockfile`, and starts only the local Vite server:

   ```console
   pnpm launch:mvi
   ```

2. Open the Vite URL (normally `http://127.0.0.1:5173`). Confirm the page identifies persistence as `SQLite WASM · OPFS`; failure to obtain OPFS must be visible and must not fall back to transient writable state.
3. Confirm the accepted immutable revision, current revision, complete source-parameter panel, review-only disclosure, bbox, build-volume context, and root safety values. Review the R14 interaction vocabulary before changing a parameter:
   - Confirm `Part fixture` is the active consequential Stage 1 artifact. Switch to `Assembly fixture` and require its visible statement that it is review-only interaction evidence and cannot author occurrences, mates, transforms, or Assembly revisions.
   - In the Model tree, activate `Source-Part` and `Displayed occurrence` separately and require the navigation context to identify the activated entry. Exercise `Smart`, `Face`, and `Component` selection modes.
   - Exercise every fixture-local semantic highlight category: top review face, component/reference, origin, top plane, and review mate. Require the UI to state that these fixture-local review IDs are not durable topology and provide no nearest-geometry fallback.
   - Attach one selection as attached context, change and clear the current selection, and confirm the attached context remains explicitly separate and bound to the current revision.
   - Exercise the `Iso`, `Front`, and `Top` camera presets, Fit, Roll, and Reset / fit. Orbit, pan, and zoom the admitted review mesh. Require fit to contain the rendered bbox rather than assumed source dimensions.
   - Measure a selected review entity and require the result to be labeled an approximate review-mesh distance in millimetres, review-only, and not exact B-rep. Confirm `Validation / issues` discloses that exact B-rep checks have not run and makes no fabrication-suitability or release claim.
   - Verify the Manifold worker reports `CAD Z-min 0 on grid`, the viewport records CAD/build-plane Z as zero, and the physical grid is the bottom/build plane. The mesh is review geometry, not exact B-rep or durable topology.
4. Change only `leg_length_mm` to a value from 40 through 160. Before commit, require the exact old/new diff and `Preview only · not committed`; after `Commit candidate`, require a new current immutable revision while the accepted revision remains unchanged.
5. Reload the page. Require `Reopened from SQLite WASM · OPFS`, the same current revision and parameter value, and unchanged `needs_human_review`/`false`/`false`/`unreleased` safety truth. A reload alone is persistence evidence, not schema-migration evidence.
6. Run the automated browser gates from the same candidate:

   ```console
   pnpm exec playwright install chromium
   pnpm verify:mvi
   ```

   `pnpm verify:mvi` is the fail-fast canonical browser-only gate; it runs TypeScript checking, unit/component tests, the production build, and Playwright without invoking Python, uv, build123d, OCP, adapter scripts, credentials, remote services, deployment, or machine control. `tests-browser/behavior-corpus.test.ts`, `tests-browser/support/browserBehaviorCorpus.ts`, and `tests-browser/e2e/behavior-corpus.spec.ts` define and execute a closed, ordered 25-scenario browser behavior corpus and deterministic 1,000-schedule failure/concurrency campaign in Vitest and Chromium. Reviewers must require exactly 25 unique scenario identities, exactly 1,000 unique schedule identities, complete declared failure-class coverage, reproducible source/corpus/comparator/environment bindings, and zero false success, false release, stale-head replacement, duplicate authored revision, unauthorized lifecycle authority, or cross-project custody reads. Incomplete, reordered, substituted, forged, or source-stale campaign evidence must fail closed.

   `tests-browser/e2e/golden-path.spec.ts` separately opens the real SQLite WASM OPFS database and directly reads `PRAGMA user_version`, the non-internal table inventory, the project row's schema version, revision count, and current-revision match. It also seeds a separate real OPFS database at version 2, executes the product migration to version 4, verifies unchanged project/revision authority and safety fields, writes one revision-bound proposal row, closes, reopens, and proves durable lifecycle readback. `tests-browser/storage.test.ts` verifies ordered v1-to-v2, v2-to-v4, and v3-to-v4 plans, atomic rollback on an injected migration failure, and fail-closed rejection of a newer unsupported schema. The browser campaign is candidate-bound behavior evidence; it is not the separate Python `ReadinessCampaign`, does not by itself close broader Stage 1/G2 qualification, and does not approve, export, release, or actuate. No browser campaign receipt belongs in the exact-artifact evidence templates unless a later reviewed schema explicitly adds that distinct claim scope.

The remaining procedures use the optional external exact-CAD/reference adapter and are not browser launch or `verify:mvi` prerequisites.

## Review-only project receipt

This procedure emits `piton.review-export-receipt.v1`. Despite the historical
“export” name, that receipt only proves canonical project/source closure without
executing source. It does not represent a lifecycle `DraftExport`, does not bind
an exact body or STEP produced by a successful governed build, and must not be
used as evidence that deliverables were exported.

1. Work from a copy of the canonical Piton project directory. Do not run its Python source as part of receipt generation.
2. Emit a receipt outside that directory:

   ```console
   uv run --frozen python scripts/review_export.py examples/minimal-project --out /tmp/piton-review-receipt.json
   ```

3. Independently validate receipt identity and canonical project custody:

   ```console
   uv run --frozen python scripts/review_export.py validate /tmp/piton-review-receipt.json --project-dir examples/minimal-project
   ```

4. Confirm validation succeeded, then inspect every `source_closure` path and digest against the intended revision. Confirm `source_executed=false`, `channel_transition=false`, `release_state=unreleased`, and all three safety values.
5. Re-run to a second path and compare bytes. A difference is a blocking custody failure.
6. Treat the receipt only as proof that declared tracked inputs passed canonical format and digest checks. It makes no geometry, manufacturability, approval, release, or actuation claim.

## Framework-only lifecycle DraftExport receipt

`piton.draft-export-receipt.v1` is the separate canonical representation of the
`DraftExport` lifecycle record. It binds one exact revision and successful build
attempt to exact-body and STEP digests, source-native authority profile, units,
warnings, environment lock, and a validation-report digest. The validation
report must already be held by the build's evidence closure, and both artifact
digests must match that build. This contract does not replace or upgrade
`piton.review-export-receipt.v1`.

Stage 1 currently exposes the immutable Python receipt and packaged JSON Schema
only; it has no operator CLI or endpoint that writes deliverables. Canonical
serialization must validate against `piton.draft-export-receipt.v1` and retain
`review_state=needs_human_review`, `fabrication_release=false`,
`machine_actuation=false`, `release_state=unreleased`, and `unreleased=true`.
Creating or validating this receipt does not approve engineering, move a
channel, qualify a STEP receiver, release fabrication, or actuate machinery.

## Geometry/reference-build review

1. Run `uv run --frozen python scripts/build_part.py --out /tmp/l_bracket_default.step`, or use a new path under repository `dist/`. The locked invocation is required from a fresh src-layout checkout so `piton` and the exact toolchain resolve from the verified environment. The script accepts no source selector and no parameter JSON; it always uses the fixed tracked reference inputs. Repository paths outside `dist/` are rejected before geometry realization. Choose a new path: it rejects an existing or symlinked STEP or companion manifest rather than overwriting either artifact.
2. Verify the manifest is `piton.reference-build-manifest.v1`; inspect its runtime/toolchain versions, millimetre units, deterministic STEP export policy, non-manufacturing tolerance policy, fixed recipe, tracked closure, and artifact digest. Confirm both governed `design_revision_id` and `build_attempt_id` are absent (`null`) and `authored_state_mutated=false`. Recompute the domain-separated closure digest before relying on provenance.
3. Confirm the STEP `FILE_NAME` header uses the declared deterministic name and `1970-01-01T00:00:00` timestamp, then read the STEP back with an independent exact-geometry tool. This normalization only removes header volatility; it does not enlarge the artifact's claim scope.
4. Independently inspect dimensions, coordinate system, topology, tolerances, interfaces, and intended material/process assumptions. Build success and visual plausibility are not acceptance.
5. Record observations in `templates/evidence-record-v1.json`; record derived artifact custody in `templates/artifact-manifest-v1.json`. Replace placeholders, retain explicit exclusions, and never change safety fields to true.

## Governed exact + review worker packet

Use this procedure for a successful, durable `BuildAttempt` produced by the
pinned `precision_worker_one:piton.realization-and-review.v3` trusted-local
worker. Do not substitute the ungoverned reference build above.

1. Freeze one `revision_id` and one successful `attempt_id`. Obtain the worker
   result and its seven role entries: `exact_brep`, `step`,
   `inspection_receipt`, `review_glb`, `review_glb_receipt`,
   `review_selection_map`, and `review_selection_map_receipt`. Reject a v1 pin,
   a three-role packet, a retry from another attempt, any missing role, or any
   extra role.
2. Recompute SHA-256 and byte length from every BREP, STEP, GLB, JSON selection
   map, and receipt file without trusting filenames or worker success text.
   Match each value to its worker-result role. Confirm every receipt names the
   frozen revision and attempt; never use a channel name or `latest` as identity.
3. Validate the exact inspection receipt independently. It must bind the BREP
   and STEP digests, millimetre units, exact toolchain, one valid solid, and the
   successful attempt. Read the BREP with the pinned exact toolchain and read
   STEP back with the declared receiver/profile where receiver qualification is
   claimed. STEP emission alone is not qualification.
4. Validate both review receipts independently of the exact receipt. Each must
   bind its own GLB or selection-map digest and byte length to the same revision,
   attempt, source BREP digest, and exact-receipt digest. The GLB receipt must
   also bind the selection-map digest. Any cross-attempt or digest mismatch
   blocks review.
5. Load only the digest-bound GLB with its digest-bound selection map. Confirm
   `identity_scope` states artifact-local identity with no durable topology
   identity and no nearest fallback. Raw primitive/triangle indices and Three.js
   IDs may resolve picks only inside this one GLB. Missing or ambiguous bindings
   block; do not transfer them to another GLB, revision, or attempt.
6. Prove the physical build plane and the exact-to-review transform rather than
   assuming the exact BREP was authored on `Z=0`. Record the exact BREP bounding-
   box Z minimum, the receipt's `artifact_to_cad_translation_mm`, and the decoded
   GLB vertex/bounding-box `Z min = 0 mm` within tessellation tolerance. For the
   current L-bracket fixture the exact BREP minimum is `-20 mm` and the review
   projection applies a `+20 mm` artifact-space Z offset; the receipt therefore
   records `[0, 0, -20]` to map artifact coordinates back to CAD. Confirm the
   viewer transform maps artifact/CAD axes into Three.js world axes so review
   `Z=0` coincides with the visible desk/grid plane. Capture measured values,
   tolerances, tool/viewer versions, transform, and a screenshot or machine-
   readable viewer check in the evidence record. A visually nearby grid is not
   evidence, and the translated review floor must not be reported as an exact-
   geometry coordinate.
7. Copy the recomputed bindings into `templates/artifact-manifest-v1.json` and
   replace every placeholder digest, byte length, measurement, translation, and
   evidence reference. Set closure/build-plane verification complete only after
   those values pass the preceding checks; the untouched template is explicitly
   incomplete and unverified. Preserve the separate exact, GLB, and selection-
   map receipt digests. Keep
   `review_state=needs_human_review`, `fabrication_release=false`, and
   `machine_actuation=false`. A complete packet only prepares human review.

### Attempt-bound evidence-closure review

The seven worker roles above are inputs to closure, not closure evidence by
themselves. Before treating a packet as ready for human review, independently
perform a project-scoped readback of the immutable `EvidenceClosure` by its
exact `project_id` and `closure_digest`; a lookup under any other project must
fail. Then:

1. Recompute the canonical evidence-check declaration digest and verify it is
   bound to the frozen revision, attempt, and expected-output digest. Reject a
   declaration made after worker execution or one with substituted checks.
2. Recompute the worker-result digest. Verify the closure binds that digest,
   the declaration digest, and the same `generation`, monotonic `fence`, and
   live `lease_id` as the admitted worker request/result. Expired, cancelled,
   stale-fence, cross-generation, or cross-attempt results block closure.
3. Require exactly these three receipts, in declaration order:
   `exact-artifact-closure`, `one-valid-solid`, and
   `review-artifact-binding`. For every receipt independently recompute its
   digest and verify `check_id`, `status=pass`, method, units, tolerance,
   checker/comparator digests, toolchain/environment digests, exact evidence
   inputs, measurements, uncertainty, claim scope, and invalidation
   conditions. Missing, reordered, failed, blocked, or extra receipts block.
4. Recompute the closure digest from the canonical closure, including the
   ordered receipt digests and artifact bindings. Match every closure artifact
   role/digest/path/unit/claim-scope value to the seven-role worker result and
   to the independently checked files. The stored closure and a replayed close
   must be byte-identical.
5. Copy the declaration, worker-result, closure, and ordered receipt bindings
   into the `evidence_closure` section of
   `templates/artifact-manifest-v1.json`. Replace every placeholder and set
   `verification_state=verified` only after all checks above pass.

Evidence closure records execution facts only. Closure does not promote a
channel, mutate a revision, accept review, approve engineering, export,
release fabrication, or actuate machinery. Preserve
`review_state=needs_human_review`, `fabrication_release=false`,
`machine_actuation=false`, `channel_transition=false`, and
`release_state=unreleased` regardless of check or closure success.

### Assemble and validate the offline review packet

Packet assembly is a projection over one project-scoped, immutable
`EvidenceClosure` and its exact successful `PrecisionWorkerResult`. It does not
run source, mutate the accepted revision, move a channel, or create approval or
release authority.

1. Use the daemon-custodied application service to read the closure by exact
   `project_id` and `closure_digest`, then assemble to a new destination. Never
   select a closure by `latest`, channel, filename, or nearest identity:

   ```python
   packet = service.build_precision_review_packet(
       project_id,
       closure_digest,
       exact_worker_result,
       "/tmp/piton-review-packet",
   )
   ```

2. Independently read back every packet-local binding before opening the viewer:

   ```python
   from piton.review_packet import validate_review_packet

   verified = validate_review_packet("/tmp/piton-review-packet")
   assert verified.packet_digest == packet.packet_digest
   assert verified.truth == {
       "review_state": "needs_human_review",
       "fabrication_release": False,
       "machine_actuation": False,
       "release_state": "unreleased",
       "channel_transition": False,
   }
   ```

3. Require exactly this packet file inventory: `review-packet.json`,
   `semantic-selection-map.json`, `index.html`, `viewer.js`, `viewer.css`,
   `THIRD_PARTY_NOTICES.txt`, and the seven files under `artifacts/` named by the
   packet. The packet and semantic map must validate against
   `piton.review-packet.v1` and `piton.semantic-selection-map.v1`; extra fields,
   missing roles, digest/length drift, ambiguous bindings, and nearest-face
   fallbacks block review.
4. Open the local `index.html` directly in a disconnected browser. Do not serve
   it from a network origin and do not add dependencies. Confirm the CSP retains
   `default-src 'none'` and `connect-src 'none'`, the visible loaded state names
   the exact revision/build/packet identities, all source-parameter zones are
   available, selected-zone callouts/highlights work, bbox and build-volume
   context render, and reset/roll/view controls remain available.
5. Record the viewer-asset digests, notices digest, semantic-map custody,
   disconnected/CSP result, and visible loaded-state result in the artifact
   manifest and evidence record. A viewer load is review evidence only; it is
   not review acceptance, exact-geometry proof, approval, export, fabrication
   release, or machine actuation.

### Record browser-qualification diagnostics

Use `qualify_browser_observation` only to preserve one immutable diagnostic
receipt outside the packet. The observation must name the exact source-fixed
browser/OS/kernel/software-renderer/viewport/device-scale/CPU/memory/tool row;
nearest-platform substitution and omitted measurements fail closed. Keep the
browser context offline, abort and count request events, open packet-local
`index.html` by `file:` URL, exercise every declared interaction and golden-path
step, verify CAD `Z=0` on the physical grid, inject the three declared graceful
failure cases, and record every source-fixed budget measurement.

```python
from piton.browser_qualification import (
    qualify_browser_observation,
    validate_browser_qualification,
)

receipt = qualify_browser_observation(
    "/tmp/piton-review-packet",
    observed_browser_run,
    "/tmp/piton-browser-qualification.json",
)
verified_receipt = validate_browser_qualification(
    "/tmp/piton-browser-qualification.json"
)
assert verified_receipt == receipt
assert verified_receipt["schema"] == "piton.browser-qualification-receipt.v1"
assert verified_receipt["status"] == "failed"
assert "provenance.controlled_browser_execution_missing" in verified_receipt[
    "failed_checks"
]
assert verified_receipt["truth"]["fabrication_release"] is False
assert verified_receipt["truth"]["machine_actuation"] is False
```

The current API ingests caller-supplied observations and therefore cannot prove
that a controlled browser harness actually executed them. It deliberately
records `provenance.controlled_browser_execution_missing`; caller literals,
passing measurements, or a recomputed digest cannot remove that failure. Treat
`piton.browser-qualification-receipt.v1` as derived review qualification evidence
only, never as successful platform qualification, review acceptance, approval,
export, release, channel transition, or actuation. The packet remains
immutable and the receipt remains outside it with
`review_state=needs_human_review`, `fabrication_release=false`,
`machine_actuation=false`, `release_state=unreleased`, and
`channel_transition=false`.

### Admit framework-only human-review work

After packet validation succeeds, construct an immutable intake from the
exact identities already returned by the daemon-custodied closure and the
validated packet. Do not select any identity by channel, `latest`, filename,
or geometric proximity:

```python
from piton import HumanReviewIntake

intake = HumanReviewIntake(
    intake_id="review-intake-one",
    project_id=closure.project_id,
    revision_id=closure.revision_id,
    attempt_id=closure.attempt_id,
    evidence_closure_digest=closure.closure_digest,
    review_packet_digest=verified.packet_digest,
    review_scope=("Inspect exact/review geometry correspondence",),
    questions=("Are the source parameters acceptable for the stated intent?",),
)
admitted = service.intake_human_review(intake, "/tmp/piton-review-packet")
assert admitted is intake
assert admitted.project_id == verified.project_id
assert admitted.revision_id == verified.revision_id
assert admitted.attempt_id == verified.build_attempt_id
assert admitted.evidence_closure_digest == verified.evidence_closure_digest
assert admitted.review_packet_digest == verified.packet_digest
assert admitted.review_state == "needs_human_review"
assert admitted.fabrication_release is False
assert admitted.machine_actuation is False
```

The canonical `to_primitive()` representation is governed by the packaged
`piton.human-review-intake.v1` schema. Intake admission is deliberately
non-persistent and has no disposition field: it records no review decision and
cannot mutate a revision, channel, build attempt, evidence closure, command
receipt, approval, export, release, or machine state. Confirm those durable
row counts are unchanged when auditing an integration. Treat an identity,
digest, packet-truth, or schema mismatch as a blocking custody failure.

### Close a framework packet as needs_human_review

After intake and packet validation, create the immutable closure from exact
custodied values only and ask the service to re-read both authorities:

```python
from piton import FrameworkPacketClosure

framework_closure = FrameworkPacketClosure(
    closure_id="framework-packet-closure-one",
    project_id=closure.project_id,
    revision_id=closure.revision_id,
    attempt_id=closure.attempt_id,
    evidence_closure_digest=closure.closure_digest,
    review_packet_digest=verified.packet_digest,
    worker_result_digest=verified.worker_result_digest,
    declaration_digest=verified.declaration_digest,
    generation=verified.generation,
    fence=verified.fence,
    lease_id=verified.lease_id,
    exact_brep_digest=verified.artifacts["exact_brep"]["digest"],
    step_digest=verified.artifacts["step"]["digest"],
    review_glb_digest=verified.artifacts["review_glb"]["digest"],
    review_selection_map_digest=verified.artifacts["review_selection_map"]["digest"],
)
closed = service.close_framework_packet(
    framework_closure, "/tmp/piton-review-packet"
)
assert closed is framework_closure
assert closed.review_state == "needs_human_review"
assert closed.fabrication_release is False
assert closed.machine_actuation is False
assert closed.release_state == "unreleased"
assert closed.channel_transition is False
```

The service performs exact project-scoped `EvidenceClosure` readback, validates
the packet file inventory and bytes again, and rejects any mismatch in project,
revision, attempt, closure, packet, worker result, declaration,
generation/fence/lease, exact B-rep/STEP, or review-only GLB/selection-map
digests. The operation is non-persistent and does not modify packet bytes.
Framework closure is not review acceptance, engineering approval, channel
promotion, export, fabrication release, or machine actuation.

### Verify P3 governed-alpha admission and P4 policy binding

Use the following procedure only after the project-scoped evidence and framework
packet checks above pass. The templates contain structurally valid representative
records, but their zero/`REPLACE_WITH_...` P3 identities are not evidence and
must be replaced from the exact custodied records.

1. Construct `GovernedAlphaEvidence` from those exact identities. Independently
   validate its canonical primitive against `piton.governed-alpha-evidence.v1`,
   recompute every digest from the named object or packet, and require these
   scopes without reinterpretation: exact B-rep `exact-realization`, STEP
   `exact-exchange`, review GLB `review-only`, and review selection map
   `review-only`. Require `review_state=needs_human_review`,
   `fabrication_release=false`, `machine_actuation=false`,
   `release_state=unreleased`, and `channel_transition=false`.
2. Put exactly that primitive in one repository-native `EvidenceArtifact`. Issue
   the P3 exit receipt with `status=completed`, `disposition=advance`, human
   authority, and the exact P2 predecessor receipt ID and recomputed receipt
   digest. Then verify successor admission against the actual P2 object, not a
   caller assertion:

   ```python
   from piton import GovernedAlphaEvidence
   from piton.portfolio import (
       Authority, Disposition, EvidenceArtifact, ExecutionStatus,
       P3ReviewEvidenceBundle, Phase, issue_phase_exit_receipt,
       receipt_digest, verify_successor_admission,
   )

   governed = GovernedAlphaEvidence.from_primitive(
       manifest["governed_alpha_evidence"]
   )
   artifact = EvidenceArtifact.from_content(
       artifact_id="p3-governed-alpha",
       repository_path="evidence/alpha/p3-governed-alpha.json",
       content=governed.to_primitive(),
   )
   review_evidence = P3ReviewEvidenceBundle(
       project_id=evidence_closure.project_id,
       current_revision_id=evidence_closure.revision_id,
       current_attempt_id=evidence_closure.attempt_id,
       evidence_closure=evidence_closure,
       framework_packet_closure=framework_packet_closure,
       review_packet=review_packet,
       review_packet_directory=packet_directory,
   )
   p3 = issue_phase_exit_receipt(
       receipt_id="p3-exit", phase=Phase.P3,
       status=ExecutionStatus.COMPLETED,
       disposition=Disposition.ADVANCE, authority=Authority.HUMAN,
       predecessor_receipt_id=p2.receipt_id,
       predecessor_receipt_digest=receipt_digest(p2), predicates={},
       evidence=(artifact,), safety=p2.safety,
       p3_review_evidence=review_evidence,
   )
   admission = verify_successor_admission(
       p3, successor=Phase.P4, predecessor=p2,
       p3_review_evidence=review_evidence,
   )
   assert not p3.successor_authorized
   assert not admission.admitted
   assert any(
       "trusted durable human authorization issuance/verification is not implemented"
       in reason for reason in admission.reasons
   )
   ```

3. Obtain P4 policy authority from installed source, never from the request,
   template, evidence producer, or phase receipt. Round-trip the canonical
   primitive through `P4AssurancePolicy.from_primitive`, validate it against
   `piton.p4-assurance-policy.v1`, and recompute its digest. Verify both template
   `policy_id` and `policy_digest` against `DEFAULT_P4_ASSURANCE_POLICY`.
4. Parse exactly one `P4AssuranceEvidence`, validate it against
   `piton.p4-assurance-evidence.v1`, and require its `policy_digest` to equal the
   recomputed default-policy digest. Require `evaluated_requirement_ids` to be
   byte-for-byte equal and in the same order as the policy requirements; set or
   list equivalence is insufficient. Exercise the installed binding API:

   ```python
   from piton import (
       DEFAULT_P4_ASSURANCE_POLICY,
       P4AssuranceEvidence,
       P4AssurancePolicy,
       validate_p4_evidence_policy_binding,
   )

   policy = DEFAULT_P4_ASSURANCE_POLICY
   round_tripped = P4AssurancePolicy.from_primitive(policy.to_primitive())
   assert round_tripped.digest == policy.digest
   assert manifest["p4_assurance"]["policy_id"] == policy.policy_id
   assert manifest["p4_assurance"]["policy_digest"] == policy.digest
   evidence = P4AssuranceEvidence.from_primitive(
       manifest["p4_assurance"]["evidence"]
   )
   reasons = validate_p4_evidence_policy_binding(policy, evidence)
   assert reasons == (), reasons
   assert evidence.evaluated_requirement_ids == tuple(
       requirement.requirement_id for requirement in policy.requirements
   )
   assert evidence.result in {"hold", "rework", "stop", "reject"}
   ```

`P3ReviewEvidenceBundle` is intentionally caller-provided review evidence, not
trusted daemon custody. Its deep identity, digest, and packet checks are useful
for review but cannot confer successor authority. Trusted durable human
authorization is unavailable in this Stage-1 slice. The implemented Linux-local
`LocalDaemonCommandAdapter` derives a connected AF_UNIX peer UID from
kernel-owned `SO_PEERCRED`, resolves only server-mapped UIDs, and admits closed
typed commands. Reviewers must not treat that transport identity as durable
human-authorization issuance, custody, verification, approval, release, or
machine authority. Unknown UIDs, unavailable peer credentials, extra envelope
or payload fields, and unsupported commands fail closed. The standalone
`verify_portfolio_admission.py` command and application service therefore cannot
turn serialized human/P3 claims, database rows, caller objects, or local peer
identity into human authority.

The P4 result vocabulary is intentionally fail-closed and cannot self-declare
advancement. When manual evidence is unavailable,
`emit_unavailable_p4_receipts` returns one closed `P4AssuranceReceipt` per
source-fixed requirement in exact declaration order. Validate each receipt
against `piton.p4-assurance-receipt.v1`; it must preserve the policy and
requirement bindings and fix `availability=unavailable`,
`threshold_passed=false`, and `evidence_refs=[]`. An unavailable receipt records
a gap and never counts as completed evaluation. `P4AssurancePolicy`,
`P4AssuranceEvidence`, schema validity, a
matching policy digest, completed checks, or CI success cannot grant review,
approval, export, release, or machine authority. `DEFAULT_P4_ASSURANCE_POLICY`
is source-fixed policy authority; a caller-created policy that validates and
matches its own evidence is still unauthorized.

**Stop review** on any missing or extra record/field; placeholder P3 identity;
non-canonical bytes; schema or digest failure; wrong exact predecessor; absent
human P3 authority; reordered, omitted, duplicated, or substituted P4
requirement; method, comparator, threshold, environment, invalidation condition,
policy identity, or policy digest drift; scope widening; a result outside the
fail-closed vocabulary; stale/cross-project/cross-revision/cross-attempt packet
binding; or any value other than `needs_human_review`/`false`/`false` for the
three root truths. Do not select a fallback policy, use a prior policy digest,
or continue pending later reconciliation.

### Close readiness evidence with G2 unaccepted

Use only one explicitly supplied `ReadinessCampaign` and its canonical digest;
do not resolve a campaign or candidate through `latest`, a filename, a channel,
a nearest identity, or inference:

```python
from piton import close_readiness_packet

readiness_closure = close_readiness_packet(
    candidate_commit=campaign.candidate_commit,
    readiness_campaign_digest=campaign.digest,
    campaign=campaign,
)
assert readiness_closure.run_count == 1000
assert not any(readiness_closure.counters.values())
assert readiness_closure.review_state == "needs_human_review"
assert readiness_closure.g2_accepted is False
assert readiness_closure.fabrication_release is False
assert readiness_closure.machine_actuation is False
```

The closure API independently calls `verify_readiness_campaign` and fails closed
unless all 1,000 ordered seeds, outcomes, distinct schedule identities, aggregate
zero counters, exact input bindings, and readiness-only truths are consistent.
Validate the canonical primitive against packaged
`piton.readiness-packet-closure.v1`. This is evidence closure only. It does not
accept G2, complete Stage 1, mutate source or revision authority, grant review or
engineering approval, export, release, promote a channel, or actuate a machine.
Stop review on any candidate/digest mismatch, incomplete or forged campaign,
unknown field, non-canonical safety value, or attempted G2 acceptance.

## Restore-forward request (no rollback mutation)

1. Preserve the accepted project and history byte-for-byte. Prepare the desired prior design as a new canonical candidate directory with truthful source digests.
2. Supply the separately preserved accepted canonical project directory. The command validates that directory and derives its digest; it does not accept a caller-provided digest.
3. Emit a packet outside both accepted and candidate directories:

   ```console
   uv run --frozen python scripts/restore_forward.py emit path/to/candidate path/to/validated-accepted-project --out /tmp/restore-forward.json
   ```

4. Validate packet identity and candidate custody:

   ```console
   uv run --frozen python scripts/restore_forward.py validate /tmp/restore-forward.json --project-dir path/to/candidate
   ```

5. Check that accepted and candidate digests differ and that `operation=restore_forward_new_revision`, `history_rewrite=false`, and `accepted_state_mutation=false`.
6. A human may separately decide whether to admit the candidate as a new revision. The packet itself cannot mutate accepted state or grant acceptance, approval, release, channel promotion, or machine authority.

Stop review on any digest mismatch, schema failure, missing input, symlink in authoritative paths, unexpected source execution, safety mutation, or request to rewrite accepted history.
