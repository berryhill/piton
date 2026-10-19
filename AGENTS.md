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

## Part-creation acceptance routing

For Part creation, sketch/feature actions, agent modeling integration, geometry verification or completion reporting, read `.hermes/README.md`, `.hermes/part-creation-happy-path-hard-acceptance.md`, `.hermes/solidworks-part-actions.md`, `.hermes/part-creation-cases.json` and `.hermes/part-creation-negative-tests.md` in full before defining acceptance or changing behavior.

The agent must produce the requested Part in the application through admitted browser-owned actions. A meaningful description, code block or external mesh is not Part creation. Human-control proof and real-agent action proof are separate lanes; report unavailable capability and unexercised stages instead of weakening a case.

These files are explicit acceptance targets, not auto-loaded rules or runtime capability grants. They do not change safety/authority gates, enable tools in conversation-only sessions, or prove that an existing worker loaded them. `.hermes/audit-baseline.md` records pinned findings, not standing current-runtime facts.

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
