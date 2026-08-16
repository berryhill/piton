# Piton Stage 1 threat model

Version: 1.2
Status: review baseline
Owner: Piton maintainers
Security gate: `piton.first-party-supply-chain-gate.v1`
Canonical product doctrine: `docs/mvi-doctrine.md`

This model covers the current local-first Stage 1 scaffold. It is a review artifact, not a production-security certification. Its root truths are always `review_state=needs_human_review`, `fabrication_release=false`, and `machine_actuation=false`. A passing build, security gate, or review packet cannot change those truths.

## Scope and security objectives

The governed scope is: the runnable browser-local TypeScript workbench and its sole writable authored-revision authority; SQLite WASM/OPFS custody; the Manifold WASM geometry worker; the optional external Python exact-CAD/reference and lifecycle-framework adapter; immutable project inputs; npm/PyPI/CI build dependencies; review packets; schemas and templates; and the operator and human-review boundary.

Security objectives:

1. Preserve one writable authored authority and immutable accepted history.
2. Bind every consequence-bearing operation to an exact project, revision, attempt, artifact, policy, and trusted authority where applicable.
3. Fail closed on stale, ambiguous, partial, cross-project, or tampered inputs and outputs.
4. Keep workers and review surfaces outside authored-state, approval, export, release, and actuation authority.
5. Make third-party executable inputs explicit, exact, hash-bound, reviewable, and replaceable.
6. Preserve local operation and diagnostics without allowing a failed candidate to displace last-good.
7. Never treat generated evidence, CI success, or caller assertions as human authority.

Out of scope for this version: deployed multi-tenant services, arbitrary third-party capability marketplaces, production secret distribution, trusted durable human authorization issuance, fabrication release, and machine actuation. Adding any one of these invalidates this baseline.

## Assets

- Authored intent in immutable browser-local TypeScript `DesignRevision` records; optional pinned Python source bytes belong to the external exact-CAD/reference adapter.
- Immutable project inputs: project identity, accepted base revision, source manifest, parameter values, units, recipes, toolchain locks, and digests.
- Local custody: SQLite records, CAS/artifact bytes, attempt-scoped staging, coordinator generation/fence/lease state, channel pointers, and last-good references.
- Exact and derivative artifacts: B-rep, STEP, inspection receipt, review GLB, artifact-local selection map, optional 3MF/STL, and their digests.
- Precision-worker request/result contracts, implementation pin, declared isolation class, resource bounds, and sanitized diagnostics.
- Evidence declarations, check receipts, evidence closures, review packets, framework closures, and governed-alpha evidence.
- Repository schemas and templates used to validate or communicate lifecycle state.
- Dependency declarations, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `pyproject.toml`, `uv.lock`, browser WASM/worker assets, GitHub Actions references, build bootstrap tools, CI workflow, and package artifacts.
- Human/operator decisions, identities, scopes, review dispositions, approvals, and future release grants.
- Root safety truths and the separation between proposal, revision, build, channel, review, approval, export, release, and actuation.

## Trust boundaries

TB-1 — Client/adapter to daemon. Requests and caller-created DTOs are untrusted data. Daemon command admission derives identity from kernel-owned Unix peer credentials and a composition-root-controlled server-owned UID mapping. Its closed command schema rejects caller-supplied identity, credential, grant, policy, approval, release, and machine-actuation fields. Only daemon custody establishes project currency, attempt identity, and capabilities.

TB-2 — Authored source to precision worker. Source may be hostile executable code. The current worker truthfully reports weaker `trusted-local` isolation; it is not networkless, credentialless, containerized, or sandboxed by implication.

TB-3 — Worker staging to durable custody. Partial, stale, late, symlinked, cross-project, or digest-mismatched output is untrusted until exact closure and atomic publication complete.

TB-4 — Exact geometry to review derivatives. GLB and selection maps are review-only projections. Triangle, primitive, filename, ordinal, and viewer IDs are artifact-local and cannot become durable topology identity.

TB-5 — Repository source to external supply chain. PyPI artifacts, GitHub-hosted runners, GitHub Actions, the Python bootstrap environment, and package registries are external. Exact pins and hashes reduce mutability but do not make publishers first party.

TB-6 — Schemas/templates to lifecycle services. A valid JSON document or repository template is inert evidence/data; it cannot mint daemon custody, human identity, approval, release, or actuation authority.

TB-7 — Review packet/viewer to operator. HTML/JS, labels, screenshots, measurements, and loaded-state assertions are untrusted communication surfaces until independently bound to exact packet bytes and revision/attempt identities.

TB-8 — CI/automation to protected repository. CI can report deterministic verification for one commit. It cannot authorize merge, human review, engineering approval, export, release, or machine actuation.

TB-9 — Local filesystem/process boundary. Other same-user processes and filesystem mutation are outside Python object integrity. Descriptor-relative no-follow custody and digest readback mitigate only implemented paths.

TB-10 — Human judgment to durable consequence. Authenticated durable human authorization issuance is not implemented. Caller-selected names, enums, database-like rows, signatures references, or agent statements cannot cross this boundary.

TB-11 — Browser app to browser platform and JavaScript supply chain. The Vite/React workbench relies on a cross-origin-isolated context, OPFS, SQLite WASM and its worker/proxy, Manifold WASM in a geometry Web Worker, Three.js/WebGL, and packages installed by pnpm. Browser storage, renderer/worker messages, generated meshes, registry packages, and browser implementation are not human, exact-geometry, approval, release, or actuation authorities. The application fails visibly instead of silently substituting transient writable custody when OPFS is unavailable.

## Actors

- Maintainer/operator: changes source and policy, reviews exact diffs, and may authorize repository publication under external repository controls.
- Human engineering reviewer: inspects exact scoped evidence and may later issue a separately designed durable decision; this capability is currently absent.
- Local daemon/application service: trusted to derive currency from custody, serialize admitted writes, and validate exact bindings.
- Precision worker: bounded evidence producer; never an authored-state or lifecycle authority.
- Browser workbench: hosts the sole bounded TypeScript authored-revision command boundary and SQLite WASM/OPFS custody, while remaining without credential, native-process, human-approval, fabrication-release, or actuation authority. Manifold/Three.js output is review-only.
- Disconnected packet viewer: untrusted review client with no filesystem, credential, SQL, process, authored-revision, approval, release, or actuation authority.
- CI runner: ephemeral external verifier for an exact commit with read-only repository permission.
- Package/action publisher and registry: external supply-chain actor, trusted only for availability after identity/version/hash checks.
- Adapter, CLI, automation, or agent: untrusted requester using the same admission boundary as a human client.
- Local attacker: a process able to race paths, replace files, inject environment state, consume resources, or read same-user data.
- Repository contributor: may propose changes to source, workflows, locks, tests, schemas, templates, or this policy, but cannot self-approve their consequence.

## Entry points

- Project-directory import and manifest/source-file loading.
- Change proposal intake and bounded parameter mutation.
- Revision commit, build-attempt admission, request issuance, worker execution, and evidence closure.
- Artifact staging, digest verification, CAS publication, SQLite transactions, recovery, and readback.
- Review packet generation/loading, semantic selection, measurements, and human-review intake.
- Schema/template parsing and launch-asset validation.
- `pyproject.toml`, `uv.lock`, package downloads, build isolation, wheel construction, and clean install.
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, frozen pnpm installation, Vite build/serve boundaries, cross-origin-isolation headers, browser module/WASM loading, SQLite worker/OPFS database opening and migration, and Manifold geometry-worker messages.
- `.github/workflows/*.yml`, pinned action execution, pull-request events, and repository merge controls.
- CLI arguments, daemon command admission over a connected local Unix socket, output paths, environment variables, local clocks, and filesystem links.
- Future operator identity, approval, export, release, synchronization, and capability-package APIs.

## Threat register

| ID | Threat and affected boundary | Mitigations in the current slice | Validation evidence | Residual risk | Owner | Invalidation condition |
| --- | --- | --- | --- | --- | --- | --- |
| TM-01 | Caller substitutes source, base revision, parameters, or a lookalike `DesignRevision`, creating dual authority (TB-1). | Browser-local TypeScript commands derive immutable authored revisions; the daemon reads exact project-scoped adapter inputs; revision identity derives from canonical manifest content; bounded mutation is pure; Python exact realizations cannot mutate browser-authored state. | `tests-browser/domain.test.ts`, `tests/test_revision_identity.py`, `tests/test_source_mutation.py`, `tests/test_revision_repository.py`. | Compromise of browser storage, daemon/process, or writable repository can alter policy code. | Custody owner | New writable authoring format, mutable revision record, or caller-selected current revision. |
| TM-02 | Immutable project inputs are tampered with, stale, cross-project, or path-escaped (TB-1/TB-9). | Manifest digest verification, project-scoped reads, exact IDs, bounded roots, no-follow descriptor traversal, stale-base checks, and no nearest fallback. | `tests/test_project_format.py`, `tests/contract/test_precision_worker_custody.py`, `tests/integration/test_custody_application_service.py`. | Same-user host compromise remains. The Bubblewrap launch boundary does not elevate the worker above its declared `trusted-local` isolation class or prove complete network or credential isolation. | Custody owner | New import format, sync transport, output root, or project identity scheme. |
| TM-03 | Crash/race publishes partial artifacts, stale output, missing blobs, or moves last-good after failure (TB-3). | Durable attempt before dispatch; generation/fence/lease; attempt staging; digest/size closure; atomic no-replace publication; closure transaction; failed attempts retain diagnostics and cannot move channels. | `tests/fault/test_blob_publication.py`, `tests/integration/test_evidence_closure.py`, `tests/test_build_attempt_admission.py`. | Full 1,000-run fault/concurrency acceptance target is not yet claimed. | Storage owner | Storage backend, filesystem, transaction protocol, CAS layout, or recovery logic changes. |
| TM-04 | Hostile source or dependency escapes the precision worker and accesses network, credentials, filesystem, or resources (TB-2/TB-5). | Worker declares `trusted-local`; the daemon launches the immutable worker snapshot through a fixed, root-owned, non-group/world-writable Bubblewrap executable with read-only inputs, a bounded writable output, reduced environment, and an unshared network namespace; exact request/output custody and no elevated lifecycle authority remain enforced. | `tests/contract/test_worker_contracts.py`, `tests/geometry/test_precision_worker.py`, `tests/test_sandbox_preflight.py`, `scripts/doctor.py`. | Bubblewrap is implemented but does not establish a stronger isolation claim: `network_isolation_proven=false` and `credential_isolation_proven=false`. Treat hostile executable geometry as blocked; G1 is incomplete. | Worker/security owner | Any untrusted/generated/imported executable source is admitted, or claimed isolation class changes. |
| TM-05 | Worker forges success, replays another attempt, omits outputs, or attempts to mutate revision/review/release state (TB-2/TB-3). | Frozen request/result, exact project/revision/attempt/request/toolchain bindings, seven-role closure, independent receipts, re-read custody, and workers without repository/lifecycle mutation APIs. | `tests/contract/test_worker_contracts.py`, `tests/integration/test_evidence_closure.py`, `tests/test_exact_realization.py`. | A compromised trusted-local host can tamper before independent closure; result signatures are not implemented. | Worker/custody owner | Worker API, output role set, signature model, remote execution, or coordinator protocol changes. |
| TM-06 | Review geometry, selection IDs, or measurements are presented as exact geometry or silently rebound (TB-4/TB-7). | Explicit `review-only` scope, artifact-local identity, no durable triangle IDs, exact/review digest separation, packet identity closure, build-plane evidence, and no nearest-face fallback. | `tests/test_mesh_derivatives.py`, `tests/test_review_packet.py`, `tests/test_framework_packet_closure.py`. | Visual deception, browser compromise, GPU differences, and incomplete accessibility/browser qualification remain. | Review-surface owner | Viewer dependency, world mapping, selection mapping, packet schema, or exact/review conversion changes. |
| TM-07 | Schema-valid or template-complete data is mistaken for daemon custody, human decision, approval, export, or release (TB-6). | Closed schemas reject unknown fields and freeze safety values; templates are incomplete/unverified; validators rebind to custody; lifecycle concepts remain distinct. | `tests/test_launch_assets.py`, `tests/test_human_review_intake.py`, `tests/test_framework_packet_closure.py`. | Social/operator error remains possible outside product controls. | Schema/lifecycle owner | Schema, template, validation route, or lifecycle implication changes. |
| TM-08 | Mutable, substituted, typosquatted, unhashed, or unreviewed Python/action dependency executes in build or CI (TB-5/TB-8). | First-party Python gate requires exact direct pins, complete PyPI lock records with SHA-256 distribution hashes, only the local editable project, approved workflow inventory, approved actions pinned to 40-hex commits, read-only contents permission, exact bootstrap pins, and frozen lock sync. | `tests/test_supply_chain_gate.py`; `verify_first_party_supply_chain`; `scripts/verify_repo.py`; CI runs repository proof. | PyPI/GitHub publisher compromise, malicious correctly hashed releases, mutable `ubuntu-latest`, build isolation behavior, and no artifact signatures/SLSA attestations or vulnerability feed. | Supply-chain owner | Dependency/action/workflow/runner/registry/build-backend/tool version or installation command changes. |
| TM-09 | CI or an agent manufactures human authority, merges a stale head, leaks a credential, or implies security/fabrication approval (TB-8/TB-10). | Read-only CI permission; exact-head proof; one task-owned PR; operator grant bound to task/exact final head; no secret literals; distinct final gate; success implications explicitly forbidden. | `tests/test_implementation_loop.py`, `.otoxan/flows/piton-implementation-loop-v1.md`, `.github/workflows/ci.yml`. | GitHub account/branch-protection compromise and external secret handling are outside repository proof. | Repository operator | CI permissions, publication flow, branch protection, identity provider, or merge authorization model changes. |
| TM-10 | A person or caller-supplied record claims review, approval, export, release, or machine authority without authenticated durable issuance (TB-10). | All human-authority advancement fails closed; P3/P4 validity is evidence only; `fabrication_release=false`; `machine_actuation=false`; review remains `needs_human_review`. | `tests/test_assurance_admission_boundary.py`, `tests/test_assurance_policy.py`, `tests/test_lifecycle.py`. | Durable authenticated human issuance is intentionally absent, so advancement remains unavailable. | Identity/lifecycle owner | Human identity, signature, approval, export, release, or machine interface is introduced. |
| TM-11 | Secrets enter source, fixtures, logs, artifacts, reports, prompts, or worker diagnostics. | Secret references only; bounded sanitized diagnostics; generated workers receive no claimed credential grant; repository review scans remain required. | Worker diagnostic tests and repository review. | No first-party secret scanner or protected runtime secret custody is implemented in this slice. | Security owner | Any credentialed integration, remote worker, signing service, registry credential, or deployment is introduced. |
| TM-12 | Denial of service through pathological CAD, decompression, giant manifests, worker hangs, disk exhaustion, or repeated retries. | Bounded contracts/resource declarations, attempt isolation, leases, output roots, and bounded implementation-loop retries. | Worker contract and implementation-loop tests. | Comprehensive CPU/memory/disk/process enforcement and performance budgets are incomplete. | Worker/operations owner | External/untrusted workload admission, concurrency, artifact-size limits, or runtime budget changes. |
| TM-13 | A local client forges principal identity or embeds authority-shaped fields in a daemon command, bypassing the sole custody service (TB-1/TB-9/TB-10). | The adapter accepts only connected `AF_UNIX` sockets, derives UID from kernel-owned Unix peer credentials, resolves it through a copied server-owned UID mapping, rejects unknown UIDs, parses a closed command schema, and routes typed commands through the one application service. | `tests/integration/test_daemon_command_admission.py`; `scripts/verify_repo.py` requires the daemon source and acceptance test. | Processes sharing one mapped OS UID are intentionally indistinguishable; socket creation/permissions, process supervision, and a durable authenticated human-principal issuer are not implemented by this adapter. | Daemon/security owner | Socket transport, peer-credential mechanism, UID/principal mapping ownership, admitted command inventory/schema, composition root, or application-service route changes. |
| TM-14 | Browser dependency, worker, renderer, or storage-version drift substitutes code, loses custody, replays stale geometry, collapses lifecycle facts, or upgrades review output into authority (TB-3/TB-4/TB-11). | Exact browser dependency versions and committed pnpm lock; frozen pnpm install in CI; cross-origin-isolated Vite boundary; OPFS-required startup; atomic SQLite `PRAGMA user_version` migration/readback with rejection of newer unsupported schemas; distinct strict lifecycle tables and closed runtime-validated records; append-only fact writes; channel expected-version CAS; inert approval/export/release custody; immutable revision integrity and transactional stale-head checks; request-scoped Manifold worker gate; review-only mesh disclosure. | `tests-browser/storage.test.ts`, `tests-browser/worker.test.ts`, `tests-browser/App.test.tsx`, and `tests-browser/e2e/golden-path.spec.ts`, including a real version-2 OPFS migration and durable lifecycle-row reopen. | npm registry/publisher, browser, GPU, Vite development server, and same-origin code compromise remain; pnpm lock/frozen install does not prove package code benign or provide signatures/provenance. | Browser/storage/supply-chain owner | Browser dependency/lock/package-manager, Vite headers, OPFS/VFS filename, schema/migration, lifecycle contract/repository API, worker protocol, Manifold/Three.js version, or authority/disclosure changes. |

No threat-register row is closed solely because a test passes. Tests establish current implementation evidence at one candidate head; human review decides whether residual risk is acceptable for the stated non-production scope.

## First-party supply-chain gate

`src/piton/supply_chain.py` is the repository-native policy and verifier. “First-party” describes who controls the gate and allowlist, not who publishes every dependency. Third-party packages remain third party.

The Python gate fails closed unless:

- `pyproject.toml`, `uv.lock`, and each approved workflow are regular non-symlink files reached through real repository directories;
- every direct runtime, verification, build, CAD, and build-backend requirement uses exact `name==version` syntax;
- every direct dependency is present in `uv.lock`;
- every registry package comes only from the declared PyPI simple index and has at least one SHA-256-bound distribution from the approved artifact origin;
- the only editable package is this repository at `.`;
- workflow inventory is exactly predeclared;
- every workflow is byte-for-byte bound to its separately predeclared SHA-256 content digest, so an unreviewed permission, command, step, trigger, runner, environment, or other workflow mutation fails closed even when a structural scanner does not recognize its syntax;
- every action is on the first-party allowlist and pinned to its exact approved immutable 40-hex commit;
- workflow repository permission remains `contents: read`;
- CI performs `uv sync --frozen --all-extras`; and
- every inline or multiline workflow command that invokes `pip install` or `uv tool install` is in the exact reviewed install-command inventory; bootstrap packages are exactly pinned and the only other allowed install consumes the locally built wheel.

The deterministic receipt records input digests and preserves review/release safety state. It has no signing, approval, channel, export, release, or actuation effect. Changes to the policy and its tests in the same pull request still require independent human diff review; the gate cannot authenticate its own policy change.

The browser package boundary is separate: `package.json` fixes direct browser and development dependency versions, `pnpm-lock.yaml` closes the resolved graph/integrity metadata, `packageManager` fixes pnpm, and CI uses `pnpm install --frozen-lockfile` before typecheck, unit tests, build, and Playwright. This is deterministic dependency-admission evidence, not an extension of the Python verifier and not proof that registry packages, browser code, WASM, or generated bundles are benign, signed, reproducible, approved, or releasable.

## Validation evidence

Run at the exact candidate head:

```bash
uv run --frozen python -m pytest -q tests/test_supply_chain_gate.py
uv run --frozen python scripts/verify_repo.py
uv run --frozen python -m pytest -q
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

The focused tests prove the current repository passes and representative mutations fail: mutable action tag, unapproved action publisher, non-exact direct dependency, missing locked artifact hash, symlinked policy input, and an unapproved install hidden in a multiline workflow run block. `tests/integration/test_daemon_command_admission.py` separately proves the current secretless local command boundary derives its principal from the peer UID, rejects unmapped peers and authority-shaped fields, and reaches the one typed custody service. `scripts/verify_repo.py` executes the supply-chain gate in CI and requires the threat model, gate source, daemon source, and both acceptance-test surfaces to exist.

Evidence interpretation:

- Pass = declared repository inputs conform to version 1 policy.
- Fail = stop build/review publication until the policy/input mismatch is reviewed and corrected.
- Pass does not mean dependency code is benign, vulnerability-free, reproducible across all hosts, signed, attested, approved, exported, released, or safe to actuate machinery.

## Residual risks

1. Precision execution remains `trusted-local`; hostile executable geometry is not safely admitted.
2. GitHub-hosted `ubuntu-22.04` is externally administered; the label may move to updated runner images within that release line.
3. Commit-pinned actions and hash-pinned packages can still contain malicious or vulnerable code.
4. Build isolation may download declared build requirements; exact versions and lock presence do not provide offline mirrors, signatures, or bit-for-bit environment attestation.
5. No continuous vulnerability intelligence, SBOM attestation, Sigstore/TUF verification, SLSA provenance, or dependency-license gate is implemented.
6. No first-party secret scanner proves repository history or external logs are free of credentials.
7. Same-user host/process compromise can defeat application-level boundaries.
8. Browser/GPU/accessibility matrices and performance/resource acceptance targets are incomplete.
9. Durable authenticated human authorization does not exist; this safely blocks advancement but leaves the product flow incomplete.
10. The required 25/25 end-to-end and 1,000 fault/concurrency Stage 1 gates are not claimed complete.
11. Local processes sharing an authorized UID share its mapped daemon principal; the adapter does not provide per-process or per-human authentication.
12. Browser dependencies have exact declarations and a frozen pnpm lock, but no repository-native npm policy verifier, package signatures, provenance attestations, or offline first-party mirror.

## Owners

- Threat-model and supply-chain policy: Piton maintainers.
- Source/revision and lifecycle authority: custody/lifecycle owner.
- Filesystem, SQLite, CAS, and recovery: storage owner.
- Precision worker, isolation, and resource enforcement: worker/security owner.
- Exact/review representation and packet UX: review-surface owner.
- CI, branch protection, and publication grants: repository operator.
- Human identity, review, approval, and future release issuance: identity/lifecycle owner plus an authorized human engineering owner.

An owner label assigns remediation responsibility; it does not confer approval or release authority.

## Invalidation conditions

Re-review and issue a new threat-model version before relying on this baseline if any of these changes:

- writable authoring authority, revision identity, parameter mutation, or imported-source policy;
- project manifest, schema, template, lifecycle state, or forbidden implication;
- local database/CAS, sync, staging, path custody, recovery, or transaction protocol;
- worker implementation pin, request/result contract, output roles, isolation class, network/credential policy, remote execution, or resource limits;
- exact kernel, browser/Node/pnpm/Python version, build backend, direct/transitive dependency, npm/PyPI registry, pnpm/uv lock format, action, workflow, runner, or CI permission;
- review packet, viewer asset, semantic map, topology identity, coordinate mapping, measurement, or derivative format;
- authentication, daemon socket/peer credentials, server-owned UID mapping, command admission schema, secrets, signing, operator grant, human-review decision, approval, export, fabrication release, or machine interface;
- deployment, multi-user/multi-tenant operation, cloud custody, plugin/capability marketplace, external API, or untrusted code admission;
- a silent wrong binding, cross-project read, missing referenced artifact, secret exposure, unauthorized lifecycle transition, or supply-chain compromise is observed.

On invalidation, stop the affected capability, preserve diagnostics without promoting failed state, rotate/revoke exposed credentials when applicable, restore forward rather than rewrite accepted history, update mitigations/tests/evidence, and retain `review_state=needs_human_review`, `fabrication_release=false`, and `machine_actuation=false`.
