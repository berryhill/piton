# Browser agent parity and portable custody

Piton exposes one writable browser application boundary: `CadApplication.executeCommand`.
The React workbench and the untrusted `AgentCadAdapter` both submit the same closed
`piton-command/v1` envelope. The adapter has no repository, SQLite, OPFS, geometry
worker, approval, release, credential, filesystem, or machine authority.

The command admits only `set-leg-length` with an explicit finite millimetre quantity
inside the existing 40–160 mm bound. Project identity, expected current revision,
exact envelope keys, and an idempotency key are required. A replay with identical
canonical content returns its stored receipt; conflicting content or a stale base
fails without adding a revision. Receipts retain root truth:
`review_state=needs_human_review`, `fabrication_release=false`,
`machine_actuation=false`, and `release_state=unreleased`.

“Export portable custody” downloads a logical `piton-portable-custody/v1` packet.
It contains a canonical manifest, project pointers, the ordered immutable revision
history, and supported durable lifecycle records. Each logical record has a path,
media type, UTF-8 byte length, and SHA-256 digest. The canonical closure deliberately
excludes raw SQLite/OPFS bytes, preview/review geometry, caches, viewer state,
credentials, exact geometry, approval, release, and actuation claims. It is not a
lifecycle `DraftExport` or a STEP/STL/3MF/GLB export.

Accepted-for-build and accepted-for-review proposal dispositions are also excluded.
Portable admission cannot replay the historical compare-and-swap context that made
such a disposition valid in its source custody, so reopen accepts only
`changes_requested` dispositions. A portable packet cannot mint stale acceptance.

`CadApplication.reopenPortableCustody` validates the complete packet before asking
the repository to publish it. Unknown versions, non-canonical JSON, unsafe or
duplicate paths, inventory/digest/length mismatch, invalid revision identities,
broken pointers/references, changed authority, or changed safety truth fail closed.
Publication is accepted only by empty custody and is transactional in SQLite; it
never merges into or replaces an existing project. Review meshes are not imported
and must be regenerated as revision-bound derivatives after reopen.
