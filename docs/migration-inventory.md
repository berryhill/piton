# Piton browser-only migration inventory

## Purpose

Piton has exactly one writable authored authority: the browser-local TypeScript workbench under authority profile `browser-typescript/v1`. The former Python application, package, scripts, tests, exact-adapter fixture, verification job, and dependency/toolchain estate are removed. Git history preserves prior implementation evidence; those removed surfaces are not current product capabilities.

This inventory carries no product claim scope and does not imply review acceptance, engineering approval, export, fabrication release, channel promotion, or machine actuation.

## Current roles

| role | tracked surface | authority |
| --- | --- | --- |
| `primary-writable-authority-browser` | `browser-src/**`, `index.html` | Sole writable authored authority |
| `browser-verification` | `tests-browser/**`, `.github/workflows/ci.yml`, package/toolchain configuration, `launch-browser-mvi.sh` | Candidate verification only |
| `docs-governance` | `README.md`, `AGENTS.md`, `docs/**`, `.otoxan/**`, `flows/**` | Advisory text; doctrine wins conflicts |
| `schemas-templates` | `schemas/**`, `templates/**` | Inert claim-scope and evidence vocabulary |
| `historical-evidence` | `evidence/**` | Immutable Stage 0 fixtures; no runtime authority |

## Removed estate

The current tracked tree contains none of the following:

- `src/**`;
- `scripts/**`;
- `tests/**` (the removed application test suite; browser tests remain under `tests-browser/**`);
- `examples/minimal-project/**`;
- tracked `*.py` files;
- `pyproject.toml`, `uv.lock`, or `.python-version`;
- a Python/exact-adapter CI job;
- the adapter-specific `schemas/piton-project-v1.schema.json`.

The canonical repository gate is now only:

```bash
pnpm verify:mvi
```

## Safety

```text
review_state = needs_human_review
fabrication_release = false
machine_actuation = false
release_state = unreleased
```

Removing the external adapter narrows capability. It does not promote browser review meshes to exact geometry and does not add approval, export, release, or machine authority.
