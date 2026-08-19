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

Browser custody is local to the browser profile and origin. The browser-local SQLite WASM OPFS durable store is the only recovery surface implemented in Stage 1: the workbench reopens the existing SQLite project on `application.open()` and additionally exposes a closed portable custody contract under format `piton-custody/v1`. The portable custody packet is a self-contained UTF-8 JSON document that carries the immutable `DesignRevision` chain, the project's accepted/current pointers, an optional `build_status` snapshot bound to that chain, and a frozen lifecycle projection. It does not carry Manifold review meshes, transient viewer state, or any fabrication / machine fields. Every revision in the packet must satisfy `id === rev-{sha256(canonicalRevisionBody)}`; the packet is re-verified by `assertPortableCustodyPacket` on reopen, and the expected fingerprint (sha256 of the canonical JSON) must match before the import is admitted. Import is fresh-custody only: it replaces the in-memory project state and reloads from the packet; the OPFS store is not deleted by import, and the next `application.open()` reasserts whatever OPFS currently holds. Export and import make zero network calls; both flows surface named, visible failure messages on rejection and leave OPFS untouched. Accepted revision history is immutable; recovery is restore-forward, never mutation of accepted history. Failed or stale candidates cannot replace accepted or last-good state.

## Root truth

```text
review_state = needs_human_review
fabrication_release = false
machine_actuation = false
release_state = unreleased
```
