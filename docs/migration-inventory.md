# Piton browser-only migration inventory

## Purpose and cutover result

Piton has completed the repository cutover to one browser application under authority profile `browser-typescript/v1`. Browser-local TypeScript commands operating on immutable `DesignRevision` records are the sole writable authored authority. SQLite WASM in OPFS is durable browser-local custody. Manifold WASM produces review mesh geometry, which is not exact geometry.

The former Python application, external exact-CAD adapter, server/daemon scripts, Python tests, and Python dependency estate are removed from the tracked tree. Git history preserves their historical existence but does not make them current product capability.

## Current tracked estate

| role | tracked surface | current consequence |
| --- | --- | --- |
| Browser application | `index.html`, `browser-src/main.tsx`, `browser-src/App.tsx`, `browser-src/components/**`, `browser-src/styles.css` | Interactive product surface; reaches authority only through `CadApplication` |
| Authored command/domain authority | `browser-src/application.ts`, `browser-src/domain.ts`, `browser-src/agentAdapter.ts`, `browser-src/lifecycle.ts` | Closed browser-local TypeScript commands, immutable revisions, safety validation; `window.pitonAgent` is untrusted adapter only |
| Durable custody and migration | `browser-src/storage/**`, `browser-src/startup.ts` | SQLite WASM OPFS repository, transactional schema migration, fresh portable import and exact namespace reopen |
| Review geometry and viewer | `browser-src/geometry/**`, `browser-src/components/Viewport.tsx` | Revision-scoped review mesh/evidence only; no exact or authored authority |
| Browser verification | `tests-browser/**`, `playwright.config.ts`, `tsconfig.json`, `vite.config.ts` | Candidate behavior evidence only |
| Toolchain and operations | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `launch-browser-mvi.sh`, `.github/workflows/ci.yml` | Pinned build/test/launch surfaces; no product approval or release authority |
| Governance | `README.md`, `AGENTS.md`, `docs/**`, `.otoxan/**`, `flows/**`, `.github/CODEOWNERS`, `.gitignore` | Advisory/operational contract; `docs/mvi-doctrine.md` wins conflicts |
| Historical evidence | `evidence/**`, `docs/historical-evidence-manifest.json`, `tools/verify-historical-evidence.mjs` | Stage 0 evidence and integrity tooling; no runtime or writable authority |

Only application startup constructs `SqliteOpfsProjectRepository`. `browser-src/App.tsx` and `window.pitonAgent` receive `CadApplication`, not the repository. Geometry workers may realize revision-bound review geometry and emit evidence but cannot mutate authored revisions, lifecycle disposition, accepted/current/channel pointers, approval, release, or machine state.

## Removed estate

The current tracked tree contains none of the retired application estate:

- `src/**`;
- `scripts/**`;
- `tests/**` (browser tests remain under `tests-browser/**`);
- `examples/minimal-project/**`;
- `src/piton/storage/migrations/**`;
- `src/piton/viewer_assets/**`;
- root `schemas/**` or `templates/**` support assets;
- tracked `*.py` files;
- `pyproject.toml`, `uv.lock`, or `.python-version`;
- Python setup, pytest, `uv`, exact-adapter, or server jobs in CI.

Repository acceptance tests in `tests-browser/repository-estate.test.ts` inspect the live Git tracked set and CI text so these retired surfaces cannot silently return as a second application.

## Historical evidence

Git commits, baseline records, reports, and `evidence/**` may describe older Python, daemon, exact-CAD, or worker designs. Read those as historical evidence in their original claim scope only. They do not override current source, grant compatibility behavior, or authorize running a removed implementation.

`docs/baseline-freeze-8af59d7.md` is an immutable cutover-era record. It is not a current runtime manifest. New corrections move forward in current documentation and revisions; accepted history is not rewritten.

## No compatibility authority

There is no compatibility bridge, dual-write mode, Python shadow authority, external exact-CAD fallback, server synchronization service, or migration path that can mutate current browser custody. Portable `piton-custody/v1` import is the only implemented cross-custody mechanism. It validates current-format browser data and writes it to a fresh OPFS namespace; it is not a compatibility adapter for retired Python state.

Reintroducing Python tooling for an unrelated inert repository task would not by itself create product authority, but any executable adapter, server, importer, or command path touching authored custody requires a new explicit authority trace, migration plan, threat review, and acceptance tests. It must never create simultaneous writable authorities.

## Canonical verification and claim scope

The only current repository gate is:

```bash
pnpm verify:mvi
```

It runs browser TypeScript checking, unit/component tests, production build, and Playwright. Verification, historical evidence, review geometry, and portable custody success do not imply exact geometry, human review acceptance, engineering approval, export, fabrication release, or machine actuation.

The current safety boundary remains:

```text
review_state=needs_human_review
fabrication_release=false
machine_actuation=false
release_state=unreleased
```

Removing the old estate narrowed capability. It did not promote review meshes to exact geometry and did not add approval, export, release, or machine authority.
