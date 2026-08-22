# Piton browser runtime operations

## Operating boundary

Piton runs as a browser-local TypeScript application served by Vite. Authored `DesignRevision` custody stays in SQLite WASM in OPFS. The Manifold WASM Web Worker produces review mesh geometry, which is not exact geometry. There is no repository server daemon, Python runtime, external exact-CAD process, fabrication exporter, release service, or machine interface to operate.

## Prerequisites and launch

Use the repository-pinned toolchain: Node.js 22.22.3 and pnpm 11.1.3. Install dependencies without changing the lockfile, then launch:

```bash
pnpm install --frozen-lockfile
pnpm launch:mvi
```

Open the Vite URL printed by the launcher, normally `http://127.0.0.1:5173`. The launcher/Vite headers must provide cross-origin isolation for SQLite WASM OPFS. Treat the visible `Piton failed to open` screen as a failed startup; do not work around it with transient storage.

## Startup modes

`browser-src/startup.ts` admits three modes:

| mode | URL shape | custody behavior |
| --- | --- | --- |
| `open-or-seed` | default URL | Opens namespace `piton`; seeds one project only when empty |
| `import-fresh` | `?mode=import` | Allocates a UUID-derived namespace and waits for a validated packet |
| `reopen-existing` | `?mode=reopen&ns=<uuid>` | Reopens that exact imported namespace; missing custody fails visibly |

Keep the full reopen URL when working with imported custody. Browser origin changes, profile deletion, site-data deletion, or storage eviction can make OPFS custody unavailable.

## Operator smoke check

1. Confirm the persistence label reads `SQLite WASM · OPFS`.
2. Confirm the seeded/current Part, accepted revision, and current revision are visible.
3. Confirm CAD Z=0 sits on the viewer grid/build plane and the bbox/build-volume context is present.
4. Preview one bounded `leg_length_mm` change between 40 and 160 mm; confirm it says preview-only and not committed.
5. Commit the candidate; confirm a new immutable `DesignRevision` becomes current while the accepted revision remains unchanged.
6. Reload the same URL and confirm current revision and parameter read back from OPFS.
7. Confirm the root truth below remains unchanged.

## Portable custody and restore-forward recovery

Export produces a self-contained UTF-8 `piton-custody/v1` JSON packet. Retain the packet outside the browser profile when it is needed for recovery. The packet includes revisions, accepted/current pointers, optional build status, lifecycle projection, schema/environment metadata, and a SHA-256 fingerprint; it excludes Manifold review meshes and transient viewer state.

Recovery is restore-forward:

1. Open `?mode=import` on the same supported origin.
2. Select the retained packet through the workbench. The importer verifies the packet's embedded fingerprint against its canonical content; this is integrity evidence, not an independently supplied fingerprint or sender-authentication claim.
3. Let closed-shape, schema, digest, chain, lifecycle, build-binding, and fixed-safety checks finish.
4. Retain the generated `?mode=reopen&ns=<uuid>` URL.
5. Reload that exact URL and confirm direct project/revision readback.
6. Make later changes as new immutable revisions; never mutate accepted history.

Import writes one validated packet transactionally into an empty namespace. Fingerprint mismatch, unsafe fields, invalid references, stale build binding, unsupported schema, or an occupied namespace fails without partial custody. Export and import make no network calls. A packet is custody data, not approval, exact geometry, fabrication release, or machine instruction.

## Failure response

| Symptom | Operator action | Authority consequence |
| --- | --- | --- |
| Cross-origin isolation or OPFS unavailable | Stop; relaunch with `pnpm launch:mvi` on the supported origin | No writable fallback is permitted |
| SQLite worker startup/migration/readback fails | Preserve the browser profile and error; do not clear site data before retaining any available custody packet | Startup remains failed; no revision is committed |
| Command reports stale current revision | Reload current custody, inspect the new base, and submit a new bounded command | Failed candidate does not replace current state |
| Idempotency conflict | Use a new key only for genuinely new command content | Existing receipt/revision remains authoritative |
| Geometry worker fails or returns stale/malformed output | Keep last-good review geometry, record diagnostics, and retry the preview | No authored revision or review disposition changes |
| Portable import fails | Preserve the source packet; correct provenance or choose a new fresh import attempt | Existing namespaces are not overwritten |
| Browser profile/origin custody is lost | Import a retained portable packet into fresh custody | Recovery creates forward custody; it does not rewrite history |

Do not call browser cache clearing, OPFS deletion, editing SQLite directly, or changing current/accepted pointers “rollback.” Accepted history is immutable; corrections use restore-forward.

## Deterministic verification

Install the pinned Playwright Chromium when required, then run the canonical gate:

```bash
pnpm exec playwright install chromium
pnpm verify:mvi
```

`pnpm verify:mvi` runs TypeScript checking, unit/component tests, a production build, and Playwright. CI runs the same gate with frozen dependencies and read-only repository permission. Record the exact Git candidate SHA with results. A pass is candidate verification evidence only; it does not grant human review acceptance, engineering approval, exact export, fabrication release, or machine actuation.

## Root truth and escalation

```text
review_state=needs_human_review
fabrication_release=false
machine_actuation=false
release_state=unreleased
```

Stop and escalate rather than improvise if custody integrity is ambiguous, a secret appears, review geometry is represented as exact, a release-critical reference is ambiguous, or any request attempts to bypass human review or enable fabrication/machine authority.
