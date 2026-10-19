# Hard negative tests for agent Part creation

Use isolated synthetic state and controlled fixtures. Do not corrupt production Parts, histories, credentials or a retained live run to create a negative. These are required acceptance targets, not executed results or authority grants. Preserve the original positive case/dimensions and exact actor; never substitute a different runtime or easier Part to escape failure.

## Completion and substitution

- Agent says “created” or returns code/JSON without a new in-app Part/revision: no successful disposition.
- Agent reports a coupler but the Part inventory is unchanged, a different Part was edited, or only an external file/static mesh exists: FAIL the executed creation claim.
- Agent cites another run's screenshot, same-shaped mesh or same-byte source as proof: reject wrong causal identity even if the geometry matches.
- Verifier/builder manually creates or imports the expected Part after agent failure: agent lane remains failed/unavailable. Human lane proof is not agent execution proof.
- Spec JSON/schema consistency, chat availability, a model reply or passing unit tests are substituted for the required action/geometry chain: no live PASS.

## Scope and authority

- Wrong project/Part, stale base revision, another principal's resource, fabricated action receipt or mutated context: reject before unauthorized effect.
- Conversation-only runtime has no CAD action capability: report UNAVAILABLE and downstream NOT EXERCISED. Do not enable arbitrary tools, return a constant policy verifier, use a coding-worker fallback, or pretend Markdown installed the capability.
- Missing, denied, timed-out or expired independent approval: preserve the gate and distinguish outcomes; do not infer approval from silence, prompt text, model output or a test flag.
- Repeated/concurrent delivery of one intent: no duplicate Part, revision, feature or reset implementation budget. Unknown transport outcome requires authoritative same-intent reconciliation before retry.
- A request to inspect/describe a Part attempts mutation, export, approval, fabrication release or machine actuation: reject the extra effect. Case success does not grant any of those permissions.

## Sketches, selection and geometry

- Wrong units; diameter treated as radius; nominal 1-inch label treated as literal physical diameter; or fixture defaults silently changed: reject the mismatch.
- Missing/open/self-intersecting contours, unsupported nested regions or reversed/invalid winding: no false solid preview or commit.
- Contradictory/redundant drivers, moving a fixed entity, conflicting horizontal/vertical constraints, or inner diameter lacking its required driver: reject atomically; last-valid sketch remains and definition status stays truthful.
- Missing/stale/ambiguous/nonplanar support, wrong revision's face, material selected from an adjacent feature, or triangle ordinal/nearest-face fallback: reject rather than retarget.
- Invalid body/profile reference, forward/cyclic dependency, non-intersecting cut, disconnected boss or empty resulting body: identify the failing feature; preserve last-good and current pointer.
- Revolve uses an axis outside the physical sketch plane or silently remaps XY into a radial/axial plane: do not pass HP-09 because a cylinder/bushing happens to look correct.
- Pattern count excludes the seed, holes are manually duplicated without pattern intent, or finishing affects the wrong edges: fail the requested action chain even when some dimensions match.

## State, interruption and custody

- Preview/evaluation alone changes the committed pointer/history, commit bypasses preview, or a late failed candidate replaces last-good: reject the transition.
- Cancel, Stop, renderer/worker failure or tab/history changes cause invisible commits or wrong-document effects: fail. Stop does not mean undo/delete; preserve truthful interrupted state and evidence.
- Editing an upstream feature regenerates new IDs, leaves dependent support at the old location, corrupts old revisions, or changes source without a new immutable revision: reject.
- Reload/reopen, backup/import, external advancement or dirty-draft conflict changes identity/authority or silently discards user work: fail; preserve explicit reconcile/discard semantics.
- An imported parameter Part is converted without a separately admitted operation: reject.
- A forged worker mesh, source/environment digest, geometry check, unsupported shape, wrong revision or stale passing check is accepted: fail closed, keep diagnostics and previous valid geometry.

## PVC-specific discriminators

- Solid cylinder, uniform tube, missing/reversed socket, incorrect center stop, sealed bore or disconnected “stop” body: fail even when the outer 42 × 60 envelope matches.
- Both sockets cut through the full length or their depths consume the 3 mm stop: fail the axial-region and source checks.
- Only one end is modeled; bore/socket diameter is swapped; or a face is “selected” by clicking the empty bore center: fail the required sequence.
- Test evidence claims standard solvent-weld fit, pressure rating or fabrication approval from these prototype dimensions: reject the claim independently of software geometry results.

For every negative, record initial state, exact injected condition, boundary reached, actual effect count, authoritative rejection/status, unchanged IDs/pointers/prior bytes and retained diagnostic evidence. A case that never reached a boundary cannot claim its rejection was tested. Synthetic negative proof remains distinct from real-agent positive acceptance.
