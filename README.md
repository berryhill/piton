# Piton

Piton is the local-first Mechanical CAD MVI.

Piton was named after the OpenDesign R14 Bench Clamp Fixture prototype
that produced the controlling current-verified interaction vocabulary and
the original Stage 0/Stage 1 design.

- Project: `8da9ea71-1dce-454a-bc4a-7e835eadfdd5`
- Conversation: `76d3d331-cb2e-4a40-aca7-f6737ea538fe`
- Authoring revision: `r14-05729d28`
- Artifact URL: https://silas-workstation.taild7c550.ts.net:8443/api/projects/8da9ea71-1dce-454a-bc4a-7e835eadfdd5/raw/index.html?revision=r14-05729d28
- Conversation URL: https://silas-workstation.taild7c550.ts.net:8443/api/conversations/76d3d331-cb2e-4a40-aca7-f6737ea538fe/files/index.html
- Local ancestor mirror: `cad_mvi_opendesign/` (R1..R14 source pins, contracts, reproducer scripts)
- Source doctrine: `/home/silas/.hermes/profiles/nick-mercer/workspace/reports/mechanical-cad-mvi-exhaustive-final-report-2026-08-06.md`

Canonical MVI doctrine (one writable authority for in-repo text):
[`docs/mvi-doctrine.md`](docs/mvi-doctrine.md). It is the in-repo mirror of
the report’s Stage 1 doctrine (sections 9–18). Where text in any plan or
doc disagrees with `docs/mvi-doctrine.md`, the doctrine wins.

Current repository state: foundation scaffold only. It is not a production CAD system and it does not authorize fabrication.

```text
review_state = needs_human_review
fabrication_release = false
machine_actuation = false
```

## First product slice

One source-native Python/build123d Part, one bounded parameter mutation, one pinned exact-geometry worker, three to five predeclared checks, revision-pinned review artifacts, human review, and an optional visibly unreleased draft export.

The current custody scaffold includes capability-gated durable build admission
with server-derived attempt identity and exact project-scoped reads.
`PitonApplicationService` executes the pinned
`precision_worker_one:piton.realization-and-review.v2` worker under the honestly
declared weaker `trusted-local` isolation class. It verifies attempt-bound exact
and review output closure. Request issuance also freezes three deterministic
attempt-bound checks; the daemon can atomically publish their immutable receipts
and one project-scoped `EvidenceClosure` only after exact custody readback.
This does not prove network or credential isolation and does not grant authored-
state, channel, human-review, approval, export, fabrication-release, or machine-
actuation authority.

## Repository verification

```bash
uv run --frozen python -m pytest -q
uv run --frozen python scripts/verify_repo.py
```

The GitHub remote is attached as `origin` at `https://github.com/berryhill/piton.git`. This repository remains review-only: no deployment, production approval, fabrication release, or machine actuation is authorized.
