# Piton repository agent contract

## Authority

- Repository instructions are advisory; runtime policy and human approval remain authoritative.
- Source-native Python is the only writable design authority in the first slice.
- Workers may realize geometry and emit evidence but may not mutate authored revisions, review dispositions, approvals, or release state.

## Required implementation loop

Every repository change follows `.otoxan/flows/piton-implementation-loop-v1.md`.

## Hard safety invariants

- `fabrication_release` defaults to `false` and cannot be enabled by tests, workers, agents, imports, exports, or build success.
- Review geometry is not exact geometry.
- Build success is not review acceptance, approval, export, release, or machine actuation.
- No secret literals in source, fixtures, logs, artifacts, reports, or prompts.
- Ambiguous release-critical references block; no nearest-face fallback.
- Failed candidates never replace the accepted/last-good revision.
