# Hard acceptance: an agent creates a real Part in the application

The hard outcome is a named, editable parametric Part in the requested Piton project, with actual sketch/feature history, evaluated geometry and a persisted immutable revision. The agent saying it made a Part, returning OpenSCAD/TypeScript/JSON, writing a file, showing a static mesh, or explaining dimensions is NOT that outcome.

Read [the action contract](solidworks-part-actions.md), [the frozen case catalog](part-creation-cases.json) and [negative cases](part-creation-negative-tests.md) in full before defining acceptance. This document defines tests; it does not itself authorize execution, broaden an agent's capabilities or enable fabrication.

## Discovery and frozen preconditions

1. Resolve the requested owning application and installed source/build/runtime identity. The current workstation discovery anchor is `https://silas-workstation.taild7c550.ts.net:8445/`; confirm it rather than making it a universal default.
2. Resolve the authenticated principal, exact project, active document, current revision and actual admitted action interface. A chat connection, model reply, exposed browser helper or advertised tool name does not prove a model can perform a CAD action.
3. Use a fresh isolated browser/data namespace and synthetic project, or an explicitly owner-approved project. Record its actual Part inventory before effects. Do not delete or overwrite user Parts to manufacture an empty precondition.
4. Freeze the repository revision, raw case-definition digest, case/variant, exact user request, dimensions/units, intended project and action budget before execution. Do not edit expectations after seeing the agent's output.
5. Each run starts with its named output Part absent. `setup_case` means the actor performs that setup's normal application actions in THIS run's fresh Part; it is not direct-store seeding, importing a prebuilt result or reusing another run's Part. Setup aliases and receipts are namespaced by case/variant/step and bound to actual returned IDs.
6. Permit at most two admitted modeling attempts for one case/intent, without multiplying that budget through outer retries. The implementation must enforce this; Markdown is not a budget mechanism. Read authoritative state before retrying an interrupted or unknown action. Do not rotate idempotency keys or create a new Part to disguise an ambiguous result.

## Two independent lanes

### Human-control lane

Perform the complete case through normal modeling controls. Prove the selected SolidWorks-equivalent plane/face, entities, dimensions/relations, feature parameters and edit/rebuild behavior. Controls-only means no mandatory advanced-source typing, console mutation, imported precomputed mesh or file-based geometry substitution.

A human lane may use explicitly authorized browser automation; this does not turn it into an agent lane. Isolated unit fixtures and in-memory repositories are separate evidence tiers.

### Agent-application lane

Send the frozen request to the actual configured agent through the application. The agent must perform the same semantic actions through an authenticated, scoped, supported application interface. A typed action adapter or MCP interface is acceptable when actually implemented and admitted; these documents do not invent an API or require one transport.

The engineering builder, controller or verifier must not manually create the expected Part on the agent's behalf. Do not substitute a coding worker with arbitrary filesystem access for an agent whose application actions were unavailable. The browser application validates and applies admitted actions; detached geometry workers do not own authored state.

Record any meaningful clarification for underspecified intent, then proceed under the resolved request. Do not repeatedly request the same consent. Preserve actual independent gates, expected-revision checks and explicit preview/commit transitions. Routine CAD commit is not engineering approval or fabrication release.

If a case's required action is unavailable, state the exact boundary and mark it UNAVAILABLE. If independently gated, mark BLOCKED and retain the real gate. Never set a policy verifier to true, bypass a tool restriction or invent action receipts to make an acceptance case pass.

## The primary PVC coupler case

HP-08 reproduces the motivating failure class. Its fully specified request asks for an in-application straight slip coupler labelled nominal 1-inch PVC:

- Length 60 mm; outer diameter 42 mm.
- Two sockets, each diameter 33.6 mm and depth 28.5 mm.
- Center stop length 3 mm; continuous center opening diameter 26.6 mm.
- One connected review solid; no pressure, solvent-weld, standard fitting or validated-clearance claim.

Required SolidWorks-style sequence:

1. Create a fresh Part in the intended project and select Front/XY.
2. Start a sketch, view normal to it, create concentric outer and inner circles, constrain their centers and set the driving diameters.
3. Exit the sketch; Boss-Extrude the annular region 60 mm; independently inspect preview, then explicitly commit.
4. Select the actual top material face by named semantic support; create a second centered diameter-33.6 sketch and blind Cut-Extrude 28.5 mm into the body; preview and commit.
5. Select the opposite material face; repeat the inward blind socket cut, targeting the current body result; preview and commit.
6. Independently inspect both sockets and the center stop. Reopen the same Part/revision and verify retained intent and geometry.

The face-selection point must be on material, not inside the opening. Nominal “1-inch” is a label, not an instruction to replace diameters with a literal inch conversion. The 33.4 mm pipe-OD reference came from the supplied example; this fixture does not certify a plumbing standard. Its numbers are predeclared software-test inputs.

The catalog supplies the analytic volume and cross-sections. Volume/bounds alone are insufficient: a solid cylinder or missing center stop can pass a weak bounding-box check. Also verify the exact socket/opening diameters and axial regions, plus the authored sketch/cut chain.

Returning the same OpenSCAD code from the example still fails application creation, even if a separate renderer makes an identical-looking mesh.

## Required case set

| Case | Shape/action target |
| --- | --- |
| HP-01 | Origin-anchored 80 × 50 × 6 plate; run Front/XY, Top/XZ and Right/YZ variants |
| HP-02 | Concentric annular spacer, OD 30 / ID 10 / length 12 |
| HP-03 | Plate plus a second-sketch blind circular pocket |
| HP-04 | Plate plus an actual through-all cut, not a guessed oversized cutter |
| HP-05 | Plate plus a face-supported merged rectangular boss |
| HP-06 | Edit the original plate depth; rebuild the same dependent boss and preserve history |
| HP-07 | Line chain → trim the specified segment → mirror-copy → closed-profile extrusion |
| HP-08 | Straight PVC slip coupler with two sockets and a center stop |
| HP-09 | Revolved bushing from a physical Top/XZ section about its in-plane Z axis |
| HP-10 | Simple through-hole plus linear pattern, three instances INCLUDING the seed |
| HP-11 | Radius-2 fillets on exactly four vertical outer corner edges |
| HP-12 | Equal-distance 2 × 2 chamfers on exactly those four vertical corner edges |

Use the JSON as the numeric/action source of truth. Do not collapse incompatible operations into a single convenient demo. Legacy restricted finishing is not arbitrary-edge filleting/chamfering. The revolve case must not silently reinterpret an XY sketch's Y coordinate as world Z.

## Positive verification chain

For EACH case/variant and EACH lane, prove:

1. The requested actor and intent reached the admitted modeling action interface—not just chat generation.
2. The newly created Part has an actual stable ID, correct parent project, visible tab and Model tree. No pre-existing or other-project Part was substituted.
3. Ordered sketches/features, parameters, constraints, support references and target-body dependencies match the frozen case. No triangle index is used as durable face authority.
4. Preview geometry is bound to this exact proposal, source/environment digest and base revision. Preview alone leaves the committed pointer/history unchanged.
5. A separate admitted commit produces the correct new immutable revision and causal bindings. Failed, cancelled or stale proposals preserve last-good and prior bytes.
6. Independent readback verifies finite positive geometry, one connected solid body, valid oriented/manifold review mesh, exact semantic parameters, bounding box and analytic-volume tolerance. Verify case-specific holes, pockets, supports and cross-sections; do not trust the agent's dimensions or checks as their own oracle.
7. Reopen/reload the exact Part and read its actual persisted authored revision, feature IDs, dependencies and geometry. Backup/import preserves those identities/bytes under the product's supported custody semantics; imported parameter Parts are not silently converted.
8. Root safety remains `review_state=needs_human_review`, `fabrication_release=false`, `machine_actuation=false`. A geometric match does not grant engineering approval, exact-BRep status or release authority.

An action receipt chain must bind case definition, intent, actor, project, Part, proposal, expected/base revision, committed revision and actual outputs. Same geometry or same content from the wrong run/Part/revision is rejected.

## Required report

For every case and variant, report human and agent lane statuses separately: PASS, FAIL, BLOCKED, UNAVAILABLE or NOT EXERCISED. Include the boundary reached, exact source/runtime identity, frozen input and definition digest, before/after Part inventory, action trace with actual causal IDs, independent source/geometry readback, persisted reopen result, negatives and retained evidence location.

Keep raw credentials, cookies, CSRF values, private session state and live-user conversations out of reports and this repository. Screenshots may support UI proof but cannot replace authored-state/geometry evidence. A passing specification validator or unit suite does not pass these live cases.

The suite is complete only when every required case/variant passes both lanes and all required negative boundaries are verified. Until then, retain the exact gaps; do not rename a partial set “the complete SolidWorks flow.”
