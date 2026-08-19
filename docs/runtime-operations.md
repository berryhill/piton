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

Browser custody is local to the browser profile and origin. Follow [`browser-portable-custody.md`](browser-portable-custody.md) for the implemented portable custody boundary. Accepted revision history is immutable; recovery is restore-forward, never mutation of accepted history. Failed or stale candidates cannot replace accepted or last-good state.

## Root truth

```text
review_state = needs_human_review
fabrication_release = false
machine_actuation = false
release_state = unreleased
```
