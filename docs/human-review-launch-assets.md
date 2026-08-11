# Human review of launch artifacts

These assets prepare evidence for a person; they do not approve, export for fabrication, release, promote a channel, or actuate a machine. Every generated packet must retain `review_state=needs_human_review`, `fabrication_release=false`, and `machine_actuation=false`.

## Review-only project receipt

This procedure emits `piton.review-export-receipt.v1`. Despite the historical
“export” name, that receipt only proves canonical project/source closure without
executing source. It does not represent a lifecycle `DraftExport`, does not bind
an exact body or STEP produced by a successful governed build, and must not be
used as evidence that deliverables were exported.

1. Work from a copy of the canonical Piton project directory. Do not run its Python source as part of receipt generation.
2. Emit a receipt outside that directory:

   ```console
   python scripts/review_export.py examples/minimal-project --out /tmp/piton-review-receipt.json
   ```

3. Independently validate receipt identity and canonical project custody:

   ```console
   python scripts/review_export.py validate /tmp/piton-review-receipt.json --project-dir examples/minimal-project
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

1. Run `python scripts/build_part.py --out /tmp/l_bracket_default.step`, or use a new path under repository `dist/`. The script accepts no source selector and no parameter JSON; it always uses the fixed tracked reference inputs. Repository paths outside `dist/` are rejected before geometry realization. Choose a new path: it rejects an existing or symlinked STEP or companion manifest rather than overwriting either artifact.
2. Verify the manifest is `piton.reference-build-manifest.v1`; inspect its runtime/toolchain versions, millimetre units, deterministic STEP export policy, non-manufacturing tolerance policy, fixed recipe, tracked closure, and artifact digest. Confirm both governed `design_revision_id` and `build_attempt_id` are absent (`null`) and `authored_state_mutated=false`. Recompute the domain-separated closure digest before relying on provenance.
3. Confirm the STEP `FILE_NAME` header uses the declared deterministic name and `1970-01-01T00:00:00` timestamp, then read the STEP back with an independent exact-geometry tool. This normalization only removes header volatility; it does not enlarge the artifact's claim scope.
4. Independently inspect dimensions, coordinate system, topology, tolerances, interfaces, and intended material/process assumptions. Build success and visual plausibility are not acceptance.
5. Record observations in `templates/evidence-record-v1.json`; record derived artifact custody in `templates/artifact-manifest-v1.json`. Replace placeholders, retain explicit exclusions, and never change safety fields to true.

## Governed exact + review worker packet

Use this procedure for a successful, durable `BuildAttempt` produced by the
pinned `precision_worker_one:piton.realization-and-review.v2` trusted-local
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

## Restore-forward request (no rollback mutation)

1. Preserve the accepted project and history byte-for-byte. Prepare the desired prior design as a new canonical candidate directory with truthful source digests.
2. Supply the separately preserved accepted canonical project directory. The command validates that directory and derives its digest; it does not accept a caller-provided digest.
3. Emit a packet outside both accepted and candidate directories:

   ```console
   python scripts/restore_forward.py emit path/to/candidate path/to/validated-accepted-project --out /tmp/restore-forward.json
   ```

4. Validate packet identity and candidate custody:

   ```console
   python scripts/restore_forward.py validate /tmp/restore-forward.json --project-dir path/to/candidate
   ```

5. Check that accepted and candidate digests differ and that `operation=restore_forward_new_revision`, `history_rewrite=false`, and `accepted_state_mutation=false`.
6. A human may separately decide whether to admit the candidate as a new revision. The packet itself cannot mutate accepted state or grant acceptance, approval, release, channel promotion, or machine authority.

Stop review on any digest mismatch, schema failure, missing input, symlink in authoritative paths, unexpected source execution, safety mutation, or request to rewrite accepted history.
