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
`precision_worker_one:piton.realization-and-review.v3` worker under the honestly
declared weaker `trusted-local` isolation class. It verifies attempt-bound exact
and review output closure. Request issuance also freezes three deterministic
attempt-bound checks; the daemon can atomically publish their immutable receipts
and one project-scoped `EvidenceClosure` only after exact custody readback.
A frozen `FrameworkPacketClosure` can then confirm, without persistence, that
one independently validated packet and its separate exact/review artifact
digests remain `needs_human_review`; it cannot record a human decision.
P3 portfolio admission additionally requires one closed, repository-native
`GovernedAlphaEvidence` record binding the exact project, revision, build
attempt, evidence closure, framework/review packets, and separately scoped
exact B-rep, STEP, GLB, and selection-map artifacts. These deep checks validate
review evidence only and cannot confer advancement. Trusted durable human
authorization issuance and verification are unavailable in this Stage-1 slice;
every human-authority advancement fails closed. Local Linux command admission
is implemented separately: `LocalDaemonCommandAdapter` derives the connected
peer UID from kernel-owned AF_UNIX `SO_PEERCRED`, resolves it through a copied
server-owned UID-to-principal mapping, rejects unknown UIDs and extra fields,
and admits only closed typed commands into `PitonApplicationService`. This
secretless local identity boundary is not durable human-authorization issuance,
custody, or verification and cannot grant approval, release, or machine
authority. P4 assurance thresholds,
named environments, methods, comparators, and invalidation conditions are
predeclared in an immutable, content-digested `P4AssurancePolicy`; later P4
evidence must bind that exact digest and cannot self-declare advancement.
This defines admission and readiness policy only. It does not claim that P3
human review was accepted or that P4 assurance was executed or passed.
This does not prove network or credential isolation and does not grant authored-
state, channel, human-review, approval, export, fabrication-release, or machine-
actuation authority.

## Repository verification

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

The GitHub remote is attached as `origin` at `https://github.com/berryhill/piton.git`. This repository remains review-only: no deployment, production approval, fabrication release, or machine actuation is authorized.
