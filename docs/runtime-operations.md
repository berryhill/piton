# Piton runtime operations

Piton runs entirely in the browser workbench. There is no repository server daemon or external exact-CAD runtime.

## Launch

```bash
pnpm install --frozen-lockfile
pnpm launch:mvi
```

Use the Vite URL printed by the launcher. Cross-origin isolation is required for SQLite WASM OPFS. If OPFS is unavailable, the application must fail visibly rather than create transient writable authority.

## Verification

```bash
pnpm exec playwright install chromium
pnpm verify:mvi
```

The command runs type checking, unit/component tests, the production build, and Playwright. A pass is candidate-bound verification evidence only; it is not review acceptance, engineering approval, export, fabrication release, or machine actuation.

## Recovery

Browser custody is local to the browser profile and origin. The browser-local SQLite WASM OPFS durable store is the only recovery surface implemented in Stage 1: the workbench reopens the existing SQLite project on `application.open()` and additionally exposes a closed portable custody contract under format `piton-custody/v1`. The portable custody packet is a self-contained UTF-8 JSON document that carries the immutable `DesignRevision` chain, the project's accepted/current pointers, an optional `build_status` snapshot bound to that chain, and a frozen lifecycle projection. It does not carry Manifold review meshes or transient viewer state. Every revision must have valid bounded parameters, a valid timestamp, fixed review-only safety truth, and `id === rev-{sha256(canonicalRevisionBody)}`. Lifecycle records are closed-shape validated, project/revision/reference bound, and pinned to false fabrication/machine truth. Optional build status must bind to the imported project and current revision. The expected packet fingerprint (sha256 of canonical JSON) must match before admission. Import is fresh-custody only: `?mode=import` allocates a bounded UUID-derived OPFS namespace, rejects any unsafe packet without mutating it, writes one valid packet transactionally, and installs a stable `?mode=reopen&ns=<uuid>` URL. Later commits and reloads use that same imported authority; existing OPFS custody is never overwritten. Export and import make zero network calls and surface named, visible failures. Accepted revision history is immutable; recovery is restore-forward, never mutation of accepted history. Failed or stale candidates cannot replace accepted or last-good state.

## Root truth

```text
review_state = needs_human_review
fabrication_release = false
machine_actuation = false
release_state = unreleased
```
