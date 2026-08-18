# Piton cutover migration inventory

| field | value |
| --- | --- |
| base_sha | `8af59d7ecf3253beb644a6a3c747d771cc48a3f8` (`origin/main` head — `feat: ship browser-local Piton MVI (#64)`) |
| added by | task `t_628e93a` on the chain branch `task-t_628e93a-t_628e93a` |
| safety truths | `review_state=needs_human_review`, `fabrication_release=false`, `machine_actuation=false` |

## Purpose

Every tracked file at the candidate HEAD is classified under exactly one cutover role. Exactly one role is writable authored authority: the browser-local TypeScript workbench (authority profile `browser-typescript/v1`). Everything else — including the entire Python/build123d/OCP surface — is non-writable for authored revisions. This document is repository governance text: it carries no product claim scope and does not imply review acceptance, engineering approval, export, fabrication release, channel promotion, or machine actuation.

## Roles (summary)

| role | surface | files at publication |
| --- | --- | --- |
| `primary-writable-authority-browser` | `browser-src/**`, `tests-browser/**`, `index.html` | 31 |
| `review-artifacts-viewer` | `src/piton/viewer_assets/**` | 4 |
| `pre-cutover-python-legacy` | `src/**` (minus viewer assets and entry shims), `scripts/**`, `tests/**`, `examples/**` | 148 |
| `verification-ci` | `.github/**`, `tools/**`, toolchain pins, lockfiles, and the browser launcher at the root | 14 |
| `docs-authority-text` | `README.md`, `AGENTS.md`, `docs/**`, `.otoxan/**`, `flows/**` | 23 |
| `schemas-templates` | `schemas/**`, `templates/**` | 18 |
| `evidence` | `evidence/**` | 29 |

## Machine-checked classification rules

The fenced block below is the classification source of truth. `tests/test_cutover_artifacts.py` recomputes the tracked file list with `git ls-files` and enforces that every tracked file matches exactly one role, that the single writable-authority role matches exactly `browser-src/**`, `tests-browser/**`, and `index.html`, and that the pinned browser-authority statements remain intact. Pattern semantics: `some/dir/**` matches everything under that directory; any other pattern is an exact path or glob relative to the repository root. `files_at_publication` counts are a machine-checked snapshot of the current candidate tree; the checks recompute both classification and counts from `git ls-files`.

```json cutover-roles-v1
{
  "schema": "piton/cutover-roles/v1",
  "base_sha": "8af59d7ecf3253beb644a6a3c747d771cc48a3f8",
  "candidate_head_note": "Classification applies to every tracked file at the current candidate HEAD, including the direct browser entry, canonical browser-only verification gate, closed 25-scenario browser behavior corpus, deterministic 1,000-replay browser failure-class campaign over 15 predeclared failure scenarios, local launcher, and their documentation and acceptance tests.",
  "safety": {
    "review_state": "needs_human_review",
    "fabrication_release": false,
    "machine_actuation": false
  },
  "roles": [
    {
      "role": "primary-writable-authority-browser",
      "authority_profile": "browser-typescript/v1",
      "includes": ["browser-src/**", "tests-browser/**", "index.html"],
      "excludes": [],
      "files_at_publication": 31,
      "statement": "Sole writable authored authority: browser-local TypeScript commands and immutable revision state persisted in SQLite WASM/OPFS. index.html is the Vite root entry of this workbench."
    },
    {
      "role": "review-artifacts-viewer",
      "includes": ["src/piton/viewer_assets/**"],
      "excludes": [],
      "files_at_publication": 4,
      "statement": "Static review-viewer assets; review-only."
    },
    {
      "role": "pre-cutover-python-legacy",
      "includes": ["src/**", "scripts/**", "tests/**", "examples/**"],
      "excludes": ["src/piton/viewer_assets/**"],
      "files_at_publication": 148,
      "statement": "Pre-cutover Python/build123d/OCP legacy, its scripts, tests, and minimal example fixture, retained only for staged retirement and historical comparison. It is not a current product, backend, adapter, verification authority, or writable authority; legacy schema consts such as piton-project-v1 authority.writable=source-native-python describe only the retired project format."
    },
    {
      "role": "verification-ci",
      "includes": [".github/**", "tools/**", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "vite.config.ts", "playwright.config.ts", "launch-browser-mvi.sh", "pyproject.toml", "uv.lock", ".python-version", ".gitignore"],
      "excludes": [],
      "files_at_publication": 14,
      "statement": "Toolchain pins, lockfiles, CI wiring, and the local browser-only launcher; no authored-revision authority."
    },
    {
      "role": "docs-authority-text",
      "includes": ["README.md", "AGENTS.md", "docs/**", ".otoxan/**", "flows/**"],
      "excludes": [],
      "files_at_publication": 23,
      "statement": "Authority and governance text; docs/mvi-doctrine.md is canonical and wins conflicts."
    },
    {
      "role": "schemas-templates",
      "includes": ["schemas/**", "templates/**"],
      "excludes": [],
      "files_at_publication": 18,
      "statement": "Shared receipt/packet schemas and evidence templates; claim-scope vocabulary only, no authority."
    },
    {
      "role": "evidence",
      "includes": ["evidence/**"],
      "excludes": [],
      "files_at_publication": 29,
      "statement": "Immutable Stage 0 research fixtures and the evidence-directory convention README."
    }
  ]
}
```

## Special classifications and corrections

- **Direct browser entry and launcher.** `index.html` loads `browser-src/main.tsx` directly. The obsolete `src/main.tsx` and `src/App.tsx` forwarding shims were removed, so no alternate browser entry remains. `launch-browser-mvi.sh` is browser-only operator/verification wiring and has no authored-revision authority.
- **Review viewer assets (`src/piton/viewer_assets/**`).** Static review-only viewer assets; given their own role so the pre-cutover legacy role stays code/tests/fixtures.
- **Legacy schema consts.** `schemas/piton-project-v1.schema.json` pins `authority.writable` to the const `source-native-python`, and the matching emission/validation sites live in `src/piton/project_format.py`, `src/piton/realization.py`, `src/piton/qualification.py`, `src/piton/feasibility.py`, `src/piton/mesh_derivatives.py`, `examples/minimal-project/piton.project.json`, and `scripts/install_verify.py`. These describe only the pre-cutover project format, are schema-const-pinned (qualification rejects reworded values), and are not current product-authority claims. Rewording them would break historical round-trip checks; they stay classified under `pre-cutover-python-legacy` pending their downstream retirement task.
- **Verification scripts.** `scripts/verify_repo.py`, `scripts/doctor.py`, and `scripts/install_verify.py` are pre-cutover repository verification tooling. They classify under `pre-cutover-python-legacy`, do not qualify the browser product, and hold no authored-revision authority. The current fixed-tree historical-evidence verifier under `tools/**` classifies as verification wiring and likewise holds no authored-revision authority.
- **`.github/CODEOWNERS`.** Intentionally unconfigured; grants no authority.
- **`evidence/**`.** Immutable Stage 0 research fixtures plus the convention README; per `evidence/README.md`, generated evidence stays untracked unless a reviewed task explicitly adds an immutable fixture.

## Counts at publication

Total tracked files at the candidate HEAD: 267. Per-role counts appear in the summary table and machine-readable roles block above; acceptance tests bind both representations to the current tracked-file classification.

Companion artifact: `docs/baseline-freeze-8af59d7.md` records the frozen verification command set and results.
