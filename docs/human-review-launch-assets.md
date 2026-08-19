# Human-review launch assets

These assets prepare evidence for a person; they do not approve, export for fabrication, release, promote a channel, or actuate a machine. Every review retains `review_state=needs_human_review`, `fabrication_release=false`, and `machine_actuation=false`.

## Browser workbench review

1. Install the exact locked dependencies with `pnpm install --frozen-lockfile`.
2. Install Chromium once with `pnpm exec playwright install chromium`.
3. Run the canonical gate with `pnpm verify:mvi`.
4. Launch with `pnpm launch:mvi` and open the URL printed by Vite.
5. Confirm the seeded L-bracket, source-parameter zone, bbox, build-volume context, and review-only disclosure.
6. Confirm CAD Z=0 sits on the physical grid.
7. Preview and commit one bounded `leg_length_mm` mutation, then reload and verify OPFS readback.
8. Confirm accepted state remains distinct from the committed candidate and all release/actuation fields remain false.

The test gate is automated candidate evidence, not a substitute for this visual human review. The repository does not contain an exact-CAD adapter, disconnected packet generator, engineering-approval issuer, fabrication exporter, release path, or machine-control path.
