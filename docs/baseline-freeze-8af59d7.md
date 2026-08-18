# Piton baseline freeze — `8af59d7`

> Historical record: this freeze predates the browser-only cutover. Commands and
> adapter capabilities recorded below are preserved as historical evidence and
> are not present in the current repository. Current verification is
> `pnpm verify:mvi`.

## Status

| field | value |
| --- | --- |
| protected_base_sha | `8af59d7ecf3253beb644a6a3c747d771cc48a3f8` |
| base meaning | `origin/main` head — `feat: ship browser-local Piton MVI (#64)` |
| frozen on branch | `task-t_628e93a-t_628e93a` (the single chain branch for this cutover) |
| frozen by | task `t_628e93a` — baseline freeze, migration inventory, authority cutover |
| authority profile | `browser-typescript/v1` — the sole writable authored authority |

Safety truths at the frozen baseline: `review_state=needs_human_review`, `fabrication_release=false`, `machine_actuation=false`.

## What this freeze records

1. The exact verification command set that defines "verified" for this repository at the frozen baseline, plus the results observed on the freeze host.
2. That browser-local TypeScript commands and immutable revision state (authority profile `browser-typescript/v1`, persisted in SQLite WASM/OPFS) are the sole writable authored authority. The Python/build123d/OCP surface is the optional external exact-CAD/reference adapter and cannot mutate browser-authored revisions.
3. Scope: this file is repository verification evidence only; it carries no product claim scope and does not imply review acceptance, engineering approval, export, fabrication release, channel promotion, or machine actuation.

## Frozen verification command set

Run from the repository root on a supported Linux host. Toolchains install only from committed lockfiles (`pnpm install --frozen-lockfile` for the browser surface; `uv sync --frozen --all-extras` for the adapter surface).

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm build`
4. `pnpm test:e2e`
5. `uv sync --frozen --all-extras`
6. `uv run --frozen python -m piton.precision_worker_launch --preflight-sandbox`
7. `uv run --frozen python -m pytest -q`
8. `uv run --frozen python scripts/verify_repo.py`

## Results observed at the frozen baseline (freeze host, 2026-08-15)

Freeze host toolchain: node v22.22.3, pnpm 11.1.3, uv 0.11.6, root-owned `/usr/bin/bwrap` (mode 755), Playwright Chromium cached and available (no e2e gap to record).

| command | result at `8af59d7` |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — 35/35 tests across 5 files |
| `pnpm build` | PASS — pre-existing >500 kB chunk-size warning only; not an error |
| `pnpm test:e2e` | PASS — 2/2 (golden path incl. seeded edit → preview → commit → OPFS reload; migrated-schema durable readback) |
| `uv sync --frozen --all-extras` | PASS |
| `uv run --frozen python -m piton.precision_worker_launch --preflight-sandbox` | PASS |
| `uv run --frozen python -m pytest -q` | PASS — 560 passed, 1 warning (deliberate duplicate-zip fault injection in `tests/security/test_worker_confinement.py`) |
| `uv run --frozen python scripts/verify_repo.py` | PASS — internal pytest rerun 560 passed; final line `piton repository verification: PASS` |

## Re-baselining rule

A future baseline freeze adds a new dated record and updates `docs/migration-inventory.md`; it never rewrites this one. Accepted history stays immutable; corrections move forward (restore-forward, never rollback mutation).

Companion artifact: `docs/migration-inventory.md` classifies every tracked file under exactly one cutover role.
