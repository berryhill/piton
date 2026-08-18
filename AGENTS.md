# Piton repository agent contract

## Origin

Piton was named after the OpenDesign R14 Bench Clamp Fixture prototype that produced the controlling current-verified interaction vocabulary and original Stage 0/Stage 1 design.

- Project: `8da9ea71-1dce-454a-bc4a-7e835eadfdd5`
- Conversation: `76d3d331-cb2e-4a40-aca7-f6737ea538fe`
- Authoring revision: `r14-05729d28`
- Artifact URL: https://silas-workstation.taild7c550.ts.net:8443/api/projects/8da9ea71-1dce-454a-bc4a-7e835eadfdd5/raw/index.html?revision=r14-05729d28
- Local ancestor mirror: `cad_mvi_opendesign/` (R1..R14 source pins, contracts, reproducer scripts)
- Source doctrine report: `/home/silas/.hermes/profiles/nick-mercer/workspace/reports/mechanical-cad-mvi-exhaustive-final-report-2026-08-06.md`

Canonical MVI doctrine: `docs/mvi-doctrine.md`. Where any plan or document disagrees with it, the doctrine wins.

## Authority

- Repository instructions are advisory; runtime policy and human approval remain authoritative.
- Browser-local TypeScript commands and immutable revision state are the sole writable product authority in the runnable first slice.
- The repository contains no Python application or external exact-CAD adapter.
- Workers may realize review geometry and emit evidence but may not mutate authored revisions, review dispositions, approvals, or release state.

## Required implementation loop

Every repository change follows `.otoxan/flows/piton-implementation-loop-v1.md`.

## Hard safety invariants

- `fabrication_release` defaults to `false` and cannot be enabled by tests, workers, agents, imports, exports, or build success.
- `machine_actuation` defaults to `false` and is not implemented in Stage 1.
- `review_state` defaults to `needs_human_review`.
- Proposal accepted ≠ engineering approved.
- Preview completed ≠ revision committed.
- Revision committed ≠ build succeeded.
- Build succeeded ≠ channel promoted.
- Channel promoted ≠ approved.
- Approved ≠ exported.
- Exported ≠ released.
- Released ≠ machine actuation.
- Review geometry is not exact geometry.
- No secret literals in source, fixtures, logs, artifacts, reports, or prompts.
- Ambiguous release-critical references block; no nearest-face fallback.
- Failed candidates never replace accepted/last-good state.
- Restore-forward replaces rollback mutation; accepted history is immutable.
