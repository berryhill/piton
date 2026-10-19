# Pinned audit baseline — before this acceptance pack

This is a source/evidence baseline at Piton commit `dbab89fef4ef895a37ab13a9e878afd67e2cf9f9`, not a standing claim about later installations. The deployed checkout and remote main matched that commit during discovery. The older registered canonical checkout was at `61cfebeadccc79bdf1e404a7de47144391d3c06b`; reviewing only that old copy would miss delivered functionality.

The owner supplied a conversation in which the agent described a PVC slip coupler and returned OpenSCAD while explicitly saying it could not insert the Part into the project. The useful description is not in-application creation. The private conversation itself is not copied into this repository; the numeric prototype fixture is captured as HP-08.

## First audit: SolidWorks-style flow

### A. Agent-to-application Part actions are unavailable in the shipped conversation mode

`src/chat/ConversationPanel.tsx:89` labels the connection read-only, with no modeling/workstation tools. `server/chat/acp-service.ts:30-35` requires conversation-only policy metadata with empty tools and modeling writes disabled. The chat client/bridge carries conversation and frozen reference context, not a Part action execution interface. This is an intentional boundary of that release, not proof that the conversation connection is broken.

Consequence: a connected model reply cannot pass the agent lane. A bounded, authenticated application-action path and actual action/effect receipts remain necessary. Do not remove the isolation guard or give the agent arbitrary terminal/storage access as a substitute.

The existing `AgentCadAdapter` (`src/agentAdapter.ts:4-10`) is not that project action path: `src/main.tsx:20-31` installs it on the legacy/demo route, not the ordinary project workspace. Its bracket-command forwarding cannot stand in for agent-created sketch/feature Parts.

### B. Concentric annulus creation is not exposed by the current sketch controls

`src/modeling/source.ts:25` supports a circle with `innerDiameter`, and geometry evaluation can realize an annulus. `src/modeling/PartCommandUI.tsx:16-20` exposes one Circle tool and scalar diameter defaults, while `src/modeling/SketchCanvas.tsx:63-65` rejects drawing another shape when a profile already exists. Source support is not a controls-only nested-circle workflow.

Consequence: HP-02/HP-08 deliberately require real concentric sketch controls and an annular region; direct canonical-source typing or a returned OpenSCAD program cannot substitute. This is a capability gap, not a reason to delete the coupler case.

### C. Legacy Revolve is not the new workplane-correct acceptance path

`src/modeling/source.ts:30-32` explicitly interprets an XY sketch as a radial/axial section whose Y becomes resulting Z. `tests-browser/simple-part-revolve.test.ts:10-13,24-38` proves that bounded realization produces a real cylinder. It does not prove a physically positioned Top/XZ sketch revolved about its in-plane Z axis. HP-09 keeps that distinction visible instead of passing an equivalent-looking primitive.

### Additional manual-flow gaps

- Finished new sketches remain local UI state until feature creation; New Sketch is disabled while that sketch exists. Profile/target choice uses the latest unconsumed profile/current body rather than a reusable saved-sketch selection workflow (`PartCommandUI.tsx:64-67,128-156,195-210`). This is a bounded workflow gap, not a demand for an industrial sketch manager.
- Constraint/rank logic supports more than the controls expose. The UI constraint dispatcher offers origin and width/height/diameter drivers (`PartCommandUI.tsx:189-191,212`), while `sketchConstraints.ts:19-42,46-75` supports additional position/fixed/horizontal/vertical mechanics. Required positions/definition states need reachable controls, not reducer-only coverage.
- The sketch renderer draws profile geometry and a conditional mirror axis but no ordinary origin marker/local axes (`SketchCanvas.tsx:120-132`). Caption-only axes do not meet the visual origin requirement.

### Independently repeated synthetic coupler proof — not HP-08 execution

A local scratch Vitest harness against this exact source realized the supplied dimensions through a solid outer extrusion, through-bore and two principal-plane/offset socket cuts. It measured bounds `[-21,-21,0]` to `[21,21,60]` and review-mesh volume `30915.35040648548 mm³`, versus analytic `30918.455339201988 mm³`; geometry checks passed. Proposal, preview, commit and serialized in-memory reopen retained eight feature records and unchanged safety flags.

That proves geometric feasibility with the existing engine. It is NOT browser/SQLite/agent proof and is NOT the annulus-first, named-material-face HP-08 sequence. The verifier must not substitute that convenience construction to pass HP-08.

The same harness first requested the original base's named start cap after making a through-bore and reproduced `socketA: base start cap ambiguous on current body`, before using principal planes as a separate geometric control. This is a targeted annular-cap/cardinality regression lead, not proof that every annulus-first cap sequence fails. Preserve fail-closed selection; do not add nearest-face or offset-plane fallback to hide the required face-selection gap.

### Evidence limit

Existing source/regression coverage for manual sketch, boss/cut, history and review geometry is not execution of this newly frozen case set. Every new case/variant starts NOT EXERCISED until its own lane and evidence chain are run. Source inspection is not a live-agent positive test. Geometry remains review-only throughout.

## Next audit: repository rules and loading

### D. The requested directory did not exist

At this baseline no `.hermes/` directory existed in the inspected Piton checkouts. Checked-in project instructions were `AGENTS.md`, `.otoxan/context.md`, `.otoxan/rules/safety.md` and `.otoxan/flows/piton-implementation-loop-v1.md`, with product doctrine in `docs/mvi-doctrine.md`. This change intentionally creates the acceptance pack; it does not rename/remove the older operating pack.

### E. Some operating-pack statements lag the shipped product

- `.otoxan/context.md:9` says no deployment capability exists, although the workstation is serving an installed, merged application release. Keep application deployment separate from fabrication release and machine actuation, which remain disabled.
- `.otoxan/rules/safety.md:7` frames STL introduction as future; `src/partExport.ts:7-18` already implements revision-bound review STL export. Review STL is not exact CAD or a fabrication release.
- `.otoxan/README.md:1` is only a title. It does not index the operating rules/flows or explain how they are loaded. Root AGENTS.md references the implementation flow, but `.hermes/` documentation is not an automatic runtime rule loader.
- `.otoxan/flows/codebase_create_v1.md:1-3` is a creation marker, not an executable or described workflow. Do not count it as implemented process coverage.
- `AGENTS.md:11` and `docs/mvi-doctrine.md:16-17` name `cad_mvi_opendesign/` as a local mirror without a resolved repository-relative location. It was absent under the audited checkout but present under Nick's workspace; the absolute source-report reference also existed. Clarify the location instead of declaring the retained design evidence lost or treating the relative path as portable repository content.

These are audit findings, not permission to rewrite the older doctrine or relax safety. This pack adds explicit acceptance routing and truth labels while leaving those existing files intact.

### F. File presence is not runtime adoption

The live agent's enforced conversation-only mode skips project context files and disallows modeling tools. Root instruction routing can guide a fresh coding worker, but does not make existing application chat sessions load this pack or gain CAD actions. Any later action-capability/contract-injection implementation needs its own scoped tests and installed-runtime proof.

A fresh isolated context-loader probe against the new pack's worktree loaded the root AGENTS.md routing references and did not automatically inline the `.hermes/` document bodies. No model or application action was started by that loader probe. This confirms routing behavior only, not adoption by the live conversation-only agent.

## Correct boundaries to retain

Browser-local TypeScript commands remain CAD authority; immutable revisions, proposal/preview/commit separation, last-good retention, stale-base protection, review-only geometry, secret custody, no fabrication release and no machine actuation are compatible with the requested happy paths. Instructions and user-facing labels do not themselves enforce these boundaries.

Aegis's `.hermes/README.md`, Loop hard-acceptance document and Graph hard-acceptance document were read as structure/reference. Their lesson is real runtime effect plus independently bound evidence—not copying Aegis permissions, infrastructure or execution policy into Piton.
