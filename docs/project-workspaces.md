# Project workspaces

Piton opens `/projects` (the root `/` redirects there). Projects are stored in this browser's SQLite WASM/OPFS storage; the workstation serves the application, not shared project data. HTTPS and cross-origin isolation are required outside localhost.

## Start building

1. Enter a project name and choose **Create project**.
2. Enter a Part name and choose **Create Part**. The initial editable recipe is an L-bracket.
3. Edit any of the six millimetre parameters: leg length/width, base length/thickness, leg thickness, and hole diameter. Geometry and wall-fit constraints are validated together.
4. Choose **Propose and preview**. Inspect the old/new parameter differences and review mesh. Parameter fields are drafts until preview; preview is not committed.
5. Choose **Commit revision** after the candidate mesh is ready. The committed candidate has the same identity as its proposal preview. Accepted history is not overwritten.
6. Bookmark the document or use **Copy link**. Reload reopens committed data. Uncommitted parameter edits, structured text and previews are session-only.
7. Use revision-history links for read-only historical inspection. **Open current revision** returns to editing. Archive/restore are project-overview actions; archived Parts are read-only.

Geometry remains review-only: `review_state=needs_human_review`, `fabrication_release=false`, `machine_actuation=false`. No exact B-rep, STEP, engineering approval or manufacturing authorization is implied.

## Routes

- `/projects`: local project registry, recent changes, creation and recovery.
- `/projects/:projectId`: project overview, rename/archive/restore and Part list.
- `/projects/:projectId/documents/:documentId`: current Part editor.
- `/projects/:projectId/documents/:documentId/revisions/:revisionId`: immutable historical view.
- `/demo`: optional legacy/R14 interaction fixture. Its static assembly is not an authored Assembly.
- Existing root `?mode=import` and `?mode=reopen&ns=<uuid>` legacy custody links remain supported.

Project, document and revision-route IDs are opaque UUIDs, not names. Renames preserve bookmarks. Revision-route IDs map to immutable content identities; a revision from another document cannot be opened under the requested document. Invalid/missing resources show errors rather than silently opening a seed.

## Backup and recovery

**Export project backup** preserves the project, all Parts, history and URL identities in a fingerprinted `piton-workspace-project/v1` packet. Import it using the project list or the recovery input on a missing-resource page. The original bookmark then opens in that browser. Identical imports are idempotent; conflicting existing project identities fail without overwrite. A changed existing project is not silently rolled back by importing an older backup.

**Export Part custody** exports the complete committed Part history in legacy `piton-custody/v1` form. Importing this format creates a new workspace wrapper with new navigation IDs; use project backups to preserve bookmarks. Historical views disable this whole-current-document export to avoid implying selected-only export. Review STL is bound to the mesh currently displayed, including a successfully built, explicitly uncommitted preview; it never includes another Part or scene helpers.

**Discover legacy default project** reads existing default custody without seeding it. **Recover legacy namespace** reads a known legacy import UUID. Legacy histories and lifecycle records are retained; repeat exports of unchanged legacy custody do not produce duplicate registry entries. Existing legacy storage remains available at `/demo` or its original import link.

The UI accepts backup files up to 20 MiB. Keep exported backups before clearing site data. Changing browser, browser profile, scheme, hostname or port changes the storage origin. Links alone do not synchronize data or grant access to another browser's OPFS.

## Automation and structured changes

The editor's **Structured change request** accepts the six parameter values as JSON. It attaches current project/document/base-revision IDs, validates through the same `WorkspaceApplication.propose` boundary and presents an explicit preview before commit. Editing or invalidating a request clears previous commit readiness.

The browser exposes `window.pitonWorkspace` with registry reads and project/Part commands, `propose(input)` and `commit(input)`. A Part proposal contains exactly `projectId`, `documentId`, `expectedRevisionId`, `idempotencyKey` (UUIDs) and `parameters` (all six numeric millimetre fields). Commit requires a matching session proposal; restart requires re-proposal unless an identical command already has a durable receipt. Reusing an idempotency key with different canonical content fails; stale bases and cross-project scopes fail. Geometry build success is distinct from an authored commit and never grants approval.

Successful commands notify the mounted workbench through `subscribe(listener)`. Clean editors follow new committed data. If automation changes a document while the GUI has an unsaved draft, the draft remains visible and further authoring is blocked until **Reload latest revision** explicitly discards that draft. Out-of-order reads cannot replace newer UI state; repeated pending GUI submissions and late navigation after leaving a page are suppressed. This notification is local to the application instance, not cross-device synchronization.

This is a local typed automation boundary, not an LLM service or externally connected MCP transport. It does not run arbitrary generated source. General sketch/feature editing, new recipes, Assembly authoring, external AI transport and cross-device synchronization remain outside this bounded authoring capability.

## Storage and acceptance

Registry data is normalized into SQLite project/document/revision/import/receipt records. Complete workspace read, write and migration transactions are serialized on each repository connection; a rejected transaction does not poison later operations. Transactions compare the expected workspace version, reject concurrent stale writes, and preserve previous revision contents and route mappings. The first implementation's singleton registry is migrated transactionally if present; legacy portable custody retains its own schema version.

Run `pnpm verify`. Project browser tests cover independent projects, editable Parts, routes/reload/back-forward, historical read-only state, invalid scope rejection, structured changes, stale draft invalidation, real STL dimensions, responsive layout and bookmark recovery in a fresh browser context. Legacy behavior remains tested explicitly at `/demo`.

The production-preview checks exercise the bundled SQLite/WASM assets and actual OPFS persistence, then create a Part, edit all six dimensions, preview/commit the exact candidate, reload, download review STL, inspect historical state and recover the original bookmarks from a backup in a separate browser context. Development-server success alone is not production-startup evidence.
