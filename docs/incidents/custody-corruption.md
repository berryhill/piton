# Incident: custody corruption or missing immutable data

Custody corruption includes migration-digest mismatch, failed integrity or
foreign-key checks, a digest path with mismatching bytes, a missing referenced
blob, cross-project binding, or an ambiguous release-critical reference.

## Contain

1. Stop writes and stop all dependent build, evidence, review, and export work.
2. Preserve diagnostics using sanitized codes and immutable references only.
3. Quarantine suspect or incomplete data through the custody API; never move,
   replace, truncate, or delete `.piton` content by hand.
4. Keep the last-good revision and artifact bindings unchanged. Failed candidates
   never replace last-good.
5. Keep `review_state=needs_human_review`, `fabrication_release=false`, and
   `machine_actuation=false`.

## Diagnose

From the repository root, use read-only or fail-closed product checks:

```bash
uv run --frozen python -c 'from pathlib import Path; from piton.storage import Database; db=Database(Path(".piton/piton.sqlite3")); print(db.schema_version()); print(db.integrity_check())'
uv run --frozen python -m pytest tests/test_storage_migrations.py tests/unit/test_blob_store.py tests/integration/test_evidence_closure.py -q
```

If a digest is known through an approved reference, verify it with
`BlobStore.open_verified`; never print the bytes. If the exact reference is
missing or ambiguous, block. Nearest revision, filename, face, artifact, or
digest fallback is forbidden.

## Recover

Do not mutate accepted history and do not rewrite an applied migration. Restore
only a separately verified backup into an empty destination when the approved
restore capability exists. Otherwise preserve the damaged store for analysis and
reconstruct only from independently verified immutable source/CAS evidence.

For design intent, recovery is restore-forward: create a new revision reproducing
prior intent and bind the reason and evidence. Restore-forward does not repair a
corrupt historical record and does not permit deleting or rewriting it.

## Exit criteria

Resume only after schema, integrity, foreign-key, and exact referenced-blob
checks pass; incomplete publication state is quarantined; the expected immutable
bindings are read back; and an operator reviews the sanitized incident record.
Recovery is not human acceptance, approval, export, fabrication release, or
machine actuation.
