# Human review of launch artifacts

These assets prepare evidence for a person; they do not approve, export for fabrication, release, promote a channel, or actuate a machine. Every generated packet must retain `review_state=needs_human_review`, `fabrication_release=false`, and `machine_actuation=false`.

## Review-only project receipt

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
