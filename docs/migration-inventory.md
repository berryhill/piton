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
| `primary-writable-authority-browser` | `browser-src/**`, `tests-browser/**`, `index.html` | 22 |
| `browser-entry-chain` | `src/main.tsx`, `src/App.tsx` | 2 |
| `review-artifacts-viewer` | `src/piton/viewer_assets/**` | 4 |
| `external-exact-cad-adapter` | `src/**` (minus viewer assets and entry shims), `scripts/**`, `tests/**`, `examples/**` | 143 |
| `verification-ci` | `.github/**`, toolchain pins and lockfiles at the root | 12 |
| `docs-authority-text` | `README.md`, `AGENTS.md`, `docs/**`, `.otoxan/**`, `flows/**` | 20 |
| `schemas-templates` | `schemas/**`, `templates/**` | 18 |
| `evidence` | `evidence/**` | 29 |

## Machine-checked classification rules

The fenced block below is the classification source of truth. `tests/test_cutover_artifacts.py` recomputes the tracked file list with `git ls-files` and enforces that every tracked file matches exactly one role, that the single writable-authority role matches exactly `browser-src/**`, `tests-browser/**`, and `index.html`, and that the pinned browser-authority statements remain intact. Pattern semantics: `some/dir/**` matches everything under that directory; any other pattern is an exact path or glob relative to the repository root. `files_at_publication` counts are an informational snapshot at publication (base `8af59d7` plus this change), not a pinned invariant; the load-bearing checks are recomputed live.

```json cutover-roles-v1
{
  "schema": "piton/cutover-roles/v1",
  "base_sha": "8af59d7ecf3253beb644a6a3c747d771cc48a3f8",
  "candidate_head_note": "Classification applies to every tracked file at the candidate HEAD that first adds this inventory (base 8af59d7 plus this change: two docs/ files and one tests/ file).",
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
      "files_at_publication": 22,
      "statement": "Sole writable authored authority: browser-local TypeScript commands and immutable revision state persisted in SQLite WASM/OPFS. index.html is the Vite root entry of this workbench."
    },
    {
      "role": "browser-entry-chain",
      "includes": ["src/main.tsx", "src/App.tsx"],
      "excludes": [],
      "files_at_publication": 2,
      "statement": "Vite root-entry forwarding shims into browser-src/ (index.html -> src/main.tsx -> browser-src/main.tsx; src/App.tsx re-exports browser-src/App). Browser product-surface glue with no independent authored-revision authority."
    },
    {
      "role": "review-artifacts-viewer",
      "includes": ["src/piton/viewer_assets/**"],
      "excludes": [],
      "files_at_publication": 4,
      "statement": "Static review-viewer assets; review-only."
    },
    {
      "role": "external-exact-cad-adapter",
      "includes": ["src/**", "scripts/**", "tests/**", "examples/**"],
      "excludes": ["src/piton/viewer_assets/**", "src/main.tsx", "src/App.tsx"],
      "files_at_publication": 143,
      "statement": "Optional pinned external exact-CAD/reference and lifecycle adapter (Python/build123d/OCP), its scripts, its tests, and the minimal example fixture. Read-only relative to browser-authored revisions; adapter-internal schema consts such as piton-project-v1 authority.writable=source-native-python describe the adapter's own project format and are not product authority."
    },
    {
      "role": "verification-ci",
      "includes": [".github/**", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "vite.config.ts", "playwright.config.ts", "pyproject.toml", "uv.lock", ".python-version", ".gitignore"],
      "excludes": [],
      "files_at_publication": 12,
      "statement": "Toolchain pins, lockfiles, and CI wiring for both surfaces; no authored-revision authority."
    },
    {
      "role": "docs-authority-text",
      "includes": ["README.md", "AGENTS.md", "docs/**", ".otoxan/**", "flows/**"],
      "excludes": [],
      "files_at_publication": 20,
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

- **Browser entry chain (`src/main.tsx`, `src/App.tsx`).** The boundary trace for this task first recorded these as "tracked 0-byte vestigial files." Live inspection corrects that record: they are small functional forwarding shims (29 and 45 bytes) that are load-bearing for the Vite root entry — `index.html` loads `src/main.tsx`, which imports `browser-src/main.tsx`, and `src/App.tsx` re-exports `browser-src/App`. They are browser product-surface glue classified under `browser-entry-chain`: outside the writable-authority role (they hold no authored-revision semantics), not adapter code, and not deletable without a contract change.
- **Review viewer assets (`src/piton/viewer_assets/**`).** Static review-only viewer assets; given their own role so the adapter role stays code/tests/fixtures.
- **Adapter-internal schema consts.** `schemas/piton-project-v1.schema.json` pins `authority.writable` to the const `source-native-python`, and the matching emission/validation sites live in `src/piton/project_format.py`, `src/piton/realization.py`, `src/piton/qualification.py`, `src/piton/feasibility.py`, `src/piton/mesh_derivatives.py`, `examples/minimal-project/piton.project.json`, and `scripts/install_verify.py`. These describe the adapter's own project format, are schema-const-pinned (qualification rejects reworded values), and are not product-authority claims. Rewording them would break the adapter round-trip; they stay classified under `external-exact-cad-adapter`.
- **Verification scripts.** `scripts/verify_repo.py`, `scripts/doctor.py`, and `scripts/install_verify.py` are adapter-language repository verification tooling. Per the task contract they classify under `external-exact-cad-adapter`; they gate CI but hold no authored-revision authority.
- **`.github/CODEOWNERS`.** Intentionally unconfigured; grants no authority.
- **`evidence/**`.** Immutable Stage 0 research fixtures plus the convention README; per `evidence/README.md`, generated evidence stays untracked unless a reviewed task explicitly adds an immutable fixture.

## Counts at publication

Total tracked files at the candidate HEAD: 250 — the 247 files of base `8af59d7` plus the two `docs/` artifacts and one `tests/` gate this change adds. Per-role counts appear in the roles block above.

Companion artifact: `docs/baseline-freeze-8af59d7.md` records the frozen verification command set and results.
