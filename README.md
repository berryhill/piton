# Piton

Piton is a runnable, browser-local Mechanical CAD MVI. It remains review-only and does not authorize fabrication.

```text
review_state = needs_human_review
fabrication_release = false
machine_actuation = false
release_state = unreleased
```

## Product surface

The browser MVI is the application. Browser-local TypeScript commands author immutable revisions, Manifold WASM generates revision-scoped review meshes in a Web Worker, and SQLite WASM stores the local project in OPFS. Generated review geometry is not exact geometry, and no build or verification result grants review acceptance, approval, export, release, or machine actuation.

Piton was named after the OpenDesign R14 Bench Clamp Fixture prototype (project `8da9ea71-1dce-454a-bc4a-7e835eadfdd5`, conversation `76d3d331-cb2e-4a40-aca7-f6737ea538fe`, revision `r14-05729d28`). Canonical doctrine: [`docs/mvi-doctrine.md`](docs/mvi-doctrine.md).

## Fresh-clone quickstart

Prerequisites:

- Node.js 22.22.3
- pnpm 11.1.3
- Chromium 145+ on Linux (the currently verified browser/platform combination)

```bash
pnpm launch:mvi
```

Open the URL printed by Vite (normally `http://127.0.0.1:5173`). The server supplies the cross-origin-isolation headers required by SQLite WASM OPFS. The app fails visibly rather than falling back to transient writable state when OPFS is unavailable.

## Manual smoke

1. Confirm the seeded L-bracket and accepted immutable revision appear.
2. Orbit, pan, zoom, and use Reset / fit. Confirm CAD Z=0 sits on the physical grid.
3. Inspect the source-parameter zone, bbox, build-volume context, and review-only disclosure.
4. Change Leg length from 80 mm to a bounded value between 40 and 160 mm.
5. Confirm the exact old/new diff says Preview only · not committed.
6. Commit the candidate. Confirm the accepted revision ID remains unchanged.
7. Reload. Confirm the candidate and parameter value reopen from SQLite WASM OPFS.
8. Confirm `fabrication_release` and `machine_actuation` remain false.
9. Click "Export portable custody" in the model panel; capture the downloaded `.piton-custody.json` file.
10. Reopen the workbench on a different browser profile (or after wiping OPFS) and "Import portable custody…" from the file picker, drag-and-drop, or clipboard paste. Confirm the imported project restores the committed value, accepted revision ID, and root truth.

## Verification

Install Chromium once with `pnpm exec playwright install chromium`, then run:

```bash
pnpm verify:mvi
```

The canonical gate runs TypeScript checking, unit/component tests, the production build, and Playwright in sequence. The browser test surface includes the closed ordered 25-scenario behavior corpus and deterministic 1,000-replay failure-class campaign. These results are candidate-bound browser behavior evidence only.

## Current limitations

- One seeded single Part and one writable bounded parameter (`leg_length_mm`).
- Manifold output is review mesh geometry, not exact B-rep or durable topology authority.
- No exact-CAD adapter or exact-geometry export is included in this repository.
- No engineering approval issuance, fabrication release, machine actuation, printer, CNC, slicer, G-code, CAM, or deployment capability exists.
- No assembly authoring or general persistent topology.

The GitHub remote is `https://github.com/berryhill/piton.git`. Build, preview, commit, export, and test success never imply review acceptance, approval, release, or machine actuation.
