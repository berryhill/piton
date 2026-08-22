# Piton browser application architecture

## Current claim

Piton Stage 1 is one local-first browser application. Its only writable authored authority is browser-local TypeScript operating on immutable `DesignRevision` records. SQLite WASM in OPFS provides durable browser-local custody. A pinned Manifold WASM Web Worker produces revision-scoped review mesh geometry; review geometry is not exact geometry.

The current repository has no server application, Python application, external exact-CAD adapter, exact-geometry exporter, fabrication-release issuer, or machine-control path.

## Application path and authority

The concrete startup and command path is:

```text
index.html
  -> browser-src/main.tsx
     -> resolveStartup(...)
     -> openProjectRepository(namespace)
     -> new CadApplication(repository)
     -> browser-src/App.tsx
        -> CadApplication.executeCommand(input)
           -> SqliteOpfsProjectRepository.executeCommand(...)
              -> immutable DesignRevision + current pointer + command receipt
```

`browser-src/main.tsx` constructs the writable repository once and gives `browser-src/App.tsx` a `CadApplication`, never the repository port. The application boundary validates the closed `piton-command/v1` envelope, exact project and base revision identities, idempotency key, command kind, millimetre unit, and the 40–160 mm `leg_length_mm` bound before requesting a transaction.

`window.pitonAgent` is an untrusted automation adapter. `AgentCadAdapter.execute` delegates unknown input to the same `CadApplication.executeCommand` method used by the workbench. It receives no repository reference and creates no second command, persistence, review, approval, export, release, or actuation authority.

## Authored state and custody

`BrowserProject` contains an accepted revision pointer, a current revision pointer, and an immutable ordered revision chain. A command derives a content-addressed child `DesignRevision`; it never edits an existing revision. The repository inserts the child and compare-and-swaps the current pointer in one SQLite transaction. A stale base or conflicting idempotency key fails without replacing current state.

SQLite WASM uses an OPFS-backed database scoped to browser origin, browser profile, and namespace. Schema migrations run transactionally before the repository opens. Startup fails visibly if cross-origin isolation, OPFS, the SQLite worker, migration, or integrity readback is unavailable; no memory or local-storage fallback is allowed to become product authority. `MemoryProjectRepository` is test infrastructure only.

Portable custody uses the closed `piton-custody/v1` JSON packet. It carries the immutable revisions, accepted/current pointers, optional revision-bound build status, lifecycle projection, schema/environment metadata, and a canonical SHA-256 fingerprint. Import validates the packet and writes it transactionally into a fresh UUID-derived OPFS namespace. It never overwrites an existing namespace.

## Geometry and evidence path

The geometry path is separate from authored custody:

```text
DesignRevision / bounded preview parameters
  -> revision- and request-bound worker message
  -> pinned Manifold WASM Web Worker
  -> validation gate
  -> Three.js review mesh and build status
```

Workers realize review geometry and execution evidence only. They cannot mint a `DesignRevision`, move accepted/current or channel pointers, write lifecycle decisions, issue approval, export exact geometry, set release truth, or actuate a machine. Responses are bound to the request, worker generation, base revision, and preview digest. Stale, malformed, or failed results retain diagnostics and do not replace accepted or last-good geometry. The viewer maps CAD Z=0 to the physical grid/build plane.

## Lifecycle separation

The schema models distinct proposals, dispositions, build attempts, evidence closures, channel pointers, approval records, draft exports, fabrication-release receipts, and released-package projections. Their presence does not collapse their meanings:

```text
proposal accepted != engineering approved
preview completed != revision committed
revision committed != build succeeded
build succeeded != channel promoted
channel promoted != approved
approved != exported
exported != released
released != machine actuation
```

Stage 1 caller writes are narrowly admitted and stale-base checked. Approval records can only represent rejection or deferral. Draft exports remain unreleased. Fabrication-release and released-package records are fixed-false rejection/projection shapes, not grants. Review meshes are not export deliverables.

## Root safety truth

Every authored revision and relevant lifecycle projection preserves:

```text
review_state=needs_human_review
fabrication_release=false
machine_actuation=false
release_state=unreleased
```

A successful command, preview, commit, build, test, CI run, custody export/import, or channel move cannot change that truth. Any future exact-CAD, approval, export, release, or actuation capability requires a separately reviewed architecture and human-gated authority design. Canonical doctrine: [`mvi-doctrine.md`](mvi-doctrine.md).
