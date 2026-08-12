# Piton local runtime operations

Piton Stage 1 is local-first. Health and telemetry are operational observations,
not design or lifecycle authority. They never imply review acceptance, approval,
export, release, or actuation. At every point in this runbook:

```text
review_state=needs_human_review
fabrication_release=false
machine_actuation=false
```

Telemetry is process-local, aggregate, allowlisted, and secretless. No telemetry
exporter exists in the alpha. `/health/live`, `/health/ready`, and authorized
local `/health/detail` are closed routes on `LocalDaemonHealthAdapter`. The
adapter requires a connected AF_UNIX socket, derives the peer UID from
kernel-owned credentials, and permits detail only when that UID appears in the
composition-root-owned `detail_principal_ids_by_uid` mapping. Request content
cannot assert or override detail authorization. `LocalHealthService` deliberately
has no public detailed-health method that accepts caller-provided authority.

## Safe first response

1. Stop admission of new work if readiness is `not_ready`; do not delete state.
2. Keep downstream work queued while diagnosis is repairable.
3. Capture only sanitized codes, command exit status, and approved references.
4. Never print environment values, credentials, source, paths from untrusted
   payloads, raw exceptions, artifact bytes, or principal identities.
5. Preserve failed attempts and diagnostics. Never replace last-good.

Run from the repository root with the project root supplied as an ordinary,
operator-reviewed path argument:

```bash
uv run --frozen python -c 'import os, socket; from piton.service import LocalDaemonHealthAdapter; server, client = socket.socketpair(); adapter = LocalDaemonHealthAdapter.open(".", detail_principal_ids_by_uid={os.getuid(): "operator_local"}); print(adapter.handle(server, "/health/ready")); print(adapter.handle(server, "/health/detail")); server.close(); client.close()'
uv run --frozen python -m pytest tests/unit/test_telemetry.py tests/integration/test_health.py tests/operations/test_runbooks.py -q
```

If readiness is `ready`, resume only the locally authorized workload. If it is
`not_ready`, use the allowlisted detail code and the decision tree below. If a
check itself crashes, treat it as not-ready and preserve the failure without
copying raw exception text into telemetry.

## Incident decision tree

### not-ready

If detail reports `migrations_pending`, stop writes and follow migration failure.
If it reports `migration_invalid` or `database_invalid`, follow custody
corruption. If it reports `database_busy`, follow DB busy. If it reports
`cas_unavailable`, follow disk full and corrupt or missing blob. If it reports
`recovery_incomplete`, follow stuck committing. If several codes occur, stop
writes and resolve every branch before rerunning readiness.

### DB busy

```bash
uv run --frozen python -c 'from pathlib import Path; from piton.storage import Database; db=Database(Path(".piton/piton.sqlite3")); print(db.integrity_check())'
```

If the bounded busy timeout expires, stop new writes and identify the
operator-owned Piton process through the service manager. Do not kill an unknown
process and do not remove SQLite WAL/SHM files. If the known process is healthy,
let its transaction finish and rerun readiness. If ownership is uncertain,
escalate as custody corruption.

### disk full

```bash
df -P .
du -sh .piton
```

If capacity is exhausted, stop new builds. Remove nothing from `.piton` by hand.
Free space only outside Piton custody under operator approval, then rerun the DB
integrity and readiness checks. If any write was interrupted, follow stuck
committing.

### timeout/escape suspicion

Stop the affected worker and block new worker launches. Preserve its attempt
scope and sanitized result. Verify the declared isolation boundary and pinned
worker before resumption. If filesystem, process, or network escape is plausible,
treat custody as untrusted; do not accept generated evidence or move channels.

### expired lease

Do not extend or rewrite the old lease. Confirm the attempt remains failed or
blocked, then use the daemon coordinator to issue a new generation/fence/lease
under normal admission. Never reinterpret an expired result as current.

### stuck committing

Stop new publication writes. Run readiness. If `recovery_incomplete` remains,
restart only through the normal composition root so
`recover_incomplete_publications` can quarantine incomplete owned state. Verify
that no evidence closure or channel movement was inferred before resumption.
Never delete a committing row or rename an artifact manually.

### corrupt or missing blob

Stop writes and reads that depend on the digest. Verify with the custody API:

```bash
uv run --frozen python -c 'from pathlib import Path; from piton.storage import Database; print(Database(Path(".piton/piton.sqlite3")).integrity_check())'
```

Do not substitute a nearest filename, digest, revision, face, or artifact. Retain
and quarantine suspect bytes through approved custody paths, then follow
`docs/incidents/custody-corruption.md`.

### migration failure

Stop writes. Do not edit an applied migration or its digest. Compare the installed
migration chain to source and run:

```bash
uv run --frozen python -m pytest tests/test_storage_migrations.py -q
uv run --frozen python -c 'from pathlib import Path; from piton.storage import Database; db=Database(Path(".piton/piton.sqlite3")); print(db.schema_version()); print(db.integrity_check())'
```

If the database is newer, tampered, or non-contiguous, do not downgrade in place.
Restore a verified copy into an empty destination when that capability is
approved, or escalate as custody corruption.

### outbox lag

Check only bounded aggregate telemetry and authorized database tooling. If
pending delivery attempts rise, pause the local consumer, verify CAS custody of
each referenced payload, and resume idempotently. Delivery lag does not authorize
recreating an evidence closure, changing a revision, or moving a channel.

### backup failure

Backup/restore is not yet implemented in this slice. Keep the corresponding
support claim blocked. Preserve existing custody and diagnostics; never claim a
filesystem copy is a verified backup and never overlay live custody.

### dependency revocation

Stop admission for the affected pinned dependency or worker. Preserve exact lock
and attempt evidence. Update source-native lock authority only through a new
reviewed revision and rerun all invalidated checks; never silently replace a
pinned package.

### browser asset mismatch

Stop serving the mismatched review asset. Rebuild from pinned local bytes, verify
the artifact inventory and digests, and reopen the exact revision packet. A
browser asset fix cannot change exact geometry or human review state.

## Exit criteria

Resume only when readiness is `ready`, all relevant codes are cleared, exact
custody checks pass, and the incident-specific boundary has been reviewed.
Readiness is not review acceptance, engineering approval, export, fabrication
release, or machine actuation.
