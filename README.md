# Piton

Piton is a runnable, browser-local Mechanical CAD MVI. It remains review-only and does not authorize fabrication.

```text
review_state = needs_human_review
fabrication_release = false
machine_actuation = false
release_state = unreleased
```

## Product surfaces

- Browser MVI — the primary runnable product. Browser-local TypeScript commands author immutable revisions; Manifold WASM generates fast review meshes in a Web Worker; SQLite WASM stores the local project in OPFS.
- Python/build123d/OCP — an optional external exact-CAD/reference adapter. It is not required by the browser editing loop and cannot mutate browser-authored revisions.
- Generated packet viewer — a disconnected, revision-pinned review artifact, not an authoring or exact-geometry surface.
- Repository verification — automated proof for these surfaces, not a substitute for launching and manually testing the product.

Piton was named after the OpenDesign R14 Bench Clamp Fixture prototype (project `8da9ea71-1dce-454a-bc4a-7e835eadfdd5`, conversation `76d3d331-cb2e-4a40-aca7-f6737ea538fe`, revision `r14-05729d28`). Canonical doctrine: [`docs/mvi-doctrine.md`](docs/mvi-doctrine.md).

## Fresh-clone quickstart

Prerequisites:

- Node.js 22.22.3
- pnpm 11.1.3
- Chromium 145+ on Linux (the currently verified browser/platform combination)

Install only from the committed lockfile and launch:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open the URL printed by Vite (normally `http://127.0.0.1:5173`). The dev server supplies the cross-origin-isolation headers required by SQLite WASM OPFS. The app fails visibly rather than falling back to transient writable state when OPFS is unavailable.

Manual smoke:

1. Confirm the seeded L-bracket and accepted immutable revision appear.
2. Orbit, pan, zoom, and use Reset / fit. Confirm the physical grid is CAD Z=0 and the status says the review mesh has Z-min 0 on the grid.
3. Inspect the source-parameter zone, bbox, build-volume context, and review-only disclosure.
4. Change Leg length from 80 mm to a bounded value between 40 and 160 mm.
5. Confirm the exact old/new diff says Preview only · not committed.
6. Commit the candidate. Confirm the accepted revision ID remains unchanged.
7. Reload the page. Confirm the candidate and parameter value reopen from SQLite WASM · OPFS.
8. Confirm fabrication_release and machine_actuation remain false.

## Browser verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

The Playwright golden path exercises launch, seeded project, Manifold WASM preview, CAD Z-min=0/grid status, immutable candidate commit, OPFS reload, and safety truth.

## Python exact-adapter verification

The existing Python foundation and optional exact-CAD adapter remain independently verified:

Run verification on a supported Linux host with a root-owned, non-group/world-writable
`/usr/bin/bwrap` and an enabled unprivileged namespace policy. The shared preflight
fails closed before the test suite when that host contract is unavailable and does not
skip or weaken the precision-worker sandbox and custody checks.

```bash
uv sync --frozen --all-extras
uv run --frozen python -m piton.precision_worker_launch --preflight-sandbox
uv run --frozen python -m pytest -q
uv run --frozen python scripts/verify_repo.py
```

## Current limitations

- One seeded single Part and one writable bounded parameter (`leg_length_mm`).
- Browser Manifold output is a review mesh, not exact B-rep or durable topology authority.
- Python exact realization is an optional external adapter and is not yet invoked from the browser workbench.
- No engineering approval issuance, fabrication release, machine actuation, printer, CNC, slicer, G-code, CAM, or deployment capability exists.
- No assembly authoring or general persistent topology.

The GitHub remote is `https://github.com/berryhill/piton.git`. Build, preview, commit, export, and test success never imply review acceptance, approval, release, or machine actuation.
