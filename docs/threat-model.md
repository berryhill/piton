# Piton browser threat model

## Scope

The governed surface is the browser-local TypeScript workbench, SQLite WASM OPFS custody, the Manifold WASM review-geometry worker, npm dependencies, GitHub Actions, review UI, and the human-review boundary. The repository contains no server application, exact-CAD adapter, fabrication exporter, release capability, or machine-control capability.

## Trust boundaries

- UI and `window.pitonAgent` inputs are untrusted and cross the same closed `piton-command/v1` application boundary.
- Browser-authored immutable revisions are distinct from worker-produced review meshes.
- OPFS custody is origin/profile local; transient fallback cannot become writable authority.
- npm registries and GitHub-hosted runners are external supply-chain boundaries.
- CI reports candidate verification only and cannot mint human authority.
- Human judgment remains outside automated consequence. No authenticated engineering-approval or fabrication-release issuance exists.

## Principal threats and controls

| Threat | Current controls | Residual risk |
| --- | --- | --- |
| Caller substitutes project, revision, or parameter | Exact project identity, stale-base guard, closed keys, millimetre unit, 40–160 mm bound | Compromised browser context can still deceive a person |
| Stale or failed mesh replaces current evidence | Revision/request binding and last-good retention | GPU/browser differences and visual deception remain |
| Review geometry is presented as exact | Explicit review-only disclosures and claim-scope separation | Human misunderstanding remains possible |
| OPFS failure silently creates mutable state | Visible fail-closed startup behavior | Browser profile loss remains possible |
| Dependency or CI action changes unexpectedly | Exact package versions, frozen pnpm lock, commit-pinned actions, read-only CI permission | Third-party packages and runners remain external |
| Automation implies approval or release | Root truth fixed false/unreleased; no issuance or machine path | Social claims outside product controls remain possible |
| Secret enters source or output | Secret literals forbidden; no runtime credential requirement | Repository review remains necessary |
| Untrusted portable custody packet smuggles unsafe revision content | Closed envelope keys, `format === piton-custody/v1`, `schema_version === CURRENT_SCHEMA_VERSION`, per-revision `id === rev-{sha256(canonical body)}`, every revision must satisfy SAFETY_TRUTH, parent chain integrity, fingerprint equality with the expected value, visible named error on rejection, OPFS untouched on failure | A user can still choose to paste a tampered packet; visible rejection is the only safeguard |

## Verification

```bash
pnpm verify:mvi
```

Verification never implies review acceptance, engineering approval, export, fabrication release, or machine actuation. Reassess this model whenever command authority, OPFS schema, worker implementation, dependency graph, CI workflow, review geometry, export formats, human authorization, release, or machine interfaces change.
