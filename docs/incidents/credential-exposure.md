# Incident: suspected credential exposure

A credential value must never be pasted, logged, printed, echoed, returned in a
report, or copied into an incident record. Record only an approved secret
reference and existence/status evidence.

## Immediate containment

1. Stop the affected worker and block new launches that share its custody path.
2. Do not inspect environment values or reproduce the suspected secret.
3. Preserve sanitized timestamps, attempt references, worker pins, and affected
   secret references. Quarantine retained output through approved custody.
4. Keep `fabrication_release=false` and `machine_actuation=false`; exposure or
   containment cannot grant any lifecycle authority.

## Rotation and revocation

Use the organization-approved secret store and identity provider, outside Piton,
to rotate the referenced credential and revoke the exposed credential, derived
tokens, and active sessions. Never place a replacement value in a command line,
source file, fixture, prompt, report, or chat. If approved tooling cannot consume
a protected reference without rendering the value, stop and escalate.

## Retained material

Search approved metadata indexes for affected attempt and artifact references,
not content. Scrub retained renderings where operationally possible, including
worker output, logs, reports, and cached views that could contain the value.
Preserve a sanitized inventory of what was removed or could not be removed.
Never weaken immutable design custody to edit bytes in place; quarantine or
replace through a new governed artifact where applicable.

## Verification before resumption

Verify all runtime paths are reference-only: source and configuration contain
secret references, workers receive only explicitly approved protected custody,
and telemetry contains only allowlisted counters/codes. Verify revoked sessions
cannot authenticate and the replacement reference resolves only at the approved
boundary. Never reproduce a secret value as verification evidence.

Resume only after rotation/revocation, rendering scrub review, reference-only
path verification, and operator approval. If any secret value entered retained
source, logs, artifacts, reports, or prompts, keep the worker stopped until those
surfaces are remediated and the credential is rotated again if necessary.
