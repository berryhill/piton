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
