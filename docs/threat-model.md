# Piton browser application threat model

## Scope and protected properties

The governed surface is the browser-local TypeScript workbench, immutable `DesignRevision` chain, SQLite WASM OPFS custody, portable custody import/export, Manifold WASM review-geometry Web Worker, Three.js review UI, npm dependency graph, GitHub Actions, and the human-review boundary. Review mesh geometry is not exact geometry.

The properties to protect are:

- one writable authored authority behind `CadApplication`;
- immutable, content-addressed revision history and exact current/accepted pointers;
- visible fail-closed persistence and transactional custody;
- request/revision binding for review geometry and build status;
- separation of proposal, commit, build, channel, review, approval, export, release, and actuation consequences;
- fixed root truth: `review_state=needs_human_review`, `fabrication_release=false`, `machine_actuation=false`, and `release_state=unreleased`.

The repository contains no server application, exact-CAD adapter, exact exporter, approval issuer, release capability, or machine-control capability.

## Trust boundaries

1. **Human/browser input -> application.** UI events and `window.pitonAgent` inputs are untrusted. Both cross the same closed `piton-command/v1` boundary at `CadApplication.executeCommand`; the adapter receives no repository port.
2. **Application -> SQLite WASM OPFS.** Authored custody crosses into an origin/profile/namespace-local database. Transactions, schema versioning, stale-base compare-and-swap, and integrity readback guard this boundary.
3. **Authored state -> geometry worker.** A worker receives bounded revision/preview inputs and returns candidate review geometry. It is not an authored-state or lifecycle authority.
4. **Portable packet -> fresh custody.** Imported JSON is hostile until closed-shape, schema, digest, chain, reference, binding, fingerprint, and safety validation succeed.
5. **Browser display -> human judgment.** Visuals and labels can influence a person but cannot authenticate engineering approval or fabrication release.
6. **Supply chain -> built application.** npm registries, package artifacts, browser/runtime binaries, and GitHub-hosted runners are external parties.
7. **CI -> repository review.** CI emits candidate-bound evidence. It cannot mint product review acceptance, approval, export, release, or machine authority.

## Threat analysis

| Threat | Current control | Residual risk |
| --- | --- | --- |
| Caller substitutes project, revision, command, unit, or parameter | Closed envelope, exact project/base identity, stale-base guard, millimetre-only quantity, finite 40–160 mm bound | A compromised browser context can still mislead a person |
| Concurrent/replayed command forks or overwrites custody | Content-addressed child revision, transaction, current-pointer compare-and-swap, canonical request digest, durable idempotency receipt | Browser/runtime defects remain possible |
| UI or `window.pitonAgent` becomes a second authority | Both receive `CadApplication`; only startup constructs the repository; adapter delegates to `executeCommand` | Same-origin script compromise can invoke admitted commands as the user context |
| OPFS failure silently falls back to mutable transient state | Cross-origin-isolation and OPFS preflight; visible startup failure; memory repository limited to tests | Browser profile/origin loss and storage eviction remain possible |
| Database migration or partial write corrupts custody | Transactional migrations/import/commit, schema-version checks, direct project/revision integrity readback | SQLite WASM/browser implementation defects remain possible |
| Stale, malformed, or failed worker output replaces current evidence | Worker generation, request/revision/preview binding, response validation, diagnostics, last-good retention | GPU/browser differences and visual deception remain |
| Review mesh is presented as exact or release-ready | Review-only labels, claim-scope separation, no exact exporter or release path | Human misunderstanding or out-of-product relabeling remains possible |
| Viewer maps the physical reference plane incorrectly | CAD Z=0/grid mapping and deterministic viewer tests | Display/camera artifacts can still confuse review |
| Portable custody smuggles unsafe revisions or lifecycle authority | Closed keys; schema/environment checks; canonical revision digest; parent-chain and pointer integrity; bounded values; fixed safety truth; lifecycle/reference/build binding; fingerprint equality | Fingerprint is integrity evidence, not sender authentication |
| Import overwrites existing custody or leaves partial state | UUID-bounded fresh namespace, empty precondition, one transaction, stable validated reopen URL | User can lose both browser profile and retained packet |
| Automation or CI claims approval/release | No approval issuance, exact export, fabrication release, or actuation implementation; root truth fixed false/unreleased | Social claims outside product controls remain |
| Secret enters source, logs, packet, or artifact | No runtime credentials required; secret literals forbidden; code/review gates | Human review and external platform controls remain necessary |
| Supply chain package/action changes unexpectedly | Exact package versions, frozen pnpm lock, pinned Node/pnpm, commit-pinned Actions, read-only CI permissions | Registries, upstream packages, browsers, and hosted runners remain external |
| Ambiguous geometry reference is resolved by proximity | No durable topology/exact export path; policy requires ambiguity to block and forbids nearest-face fallback | Future topology capabilities require a new threat review |

## Abuse and failure cases

The following do not confer additional authority: accepting a proposal, completing a preview, committing a revision, succeeding a build, moving a channel, passing tests, passing CI, exporting/importing custody, or displaying a mesh. Failed candidates and failed/stale worker results never replace accepted or last-good state. Accepted history is corrected only by restore-forward revisions, not rollback mutation.

Portable custody fingerprints detect changed canonical packet content; they do not prove who created the packet. OPFS protects browser-local persistence behavior, not host compromise. Cross-origin isolation enables the required browser primitives; it is not a general sandbox or authenticated-user boundary.

## Verification and change triggers

Run:

```bash
pnpm verify:mvi
```

Verification is candidate-bound behavior evidence only. Reassess this threat model whenever any of these change: command authority, startup/origin model, OPFS schema or migration, portable custody format, lifecycle write surface, worker protocol, geometry kernel, viewer mapping, dependency graph, CI permissions, exact-geometry support, export format, user authentication, human authorization, fabrication release, or machine interface.

Any future capability that can issue engineering approval, produce exact fabrication deliverables, set `fabrication_release=true`, or set `machine_actuation=true` requires a separate human-gated design and threat review. Those capabilities are absent today.
