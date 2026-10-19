# Piton project acceptance context

Root `AGENTS.md` is the project-instruction entry point. These `.hermes/` files are explicitly referenced acceptance documents, not automatically loaded rules. Do not create a competing `HERMES.md` or `.hermes.md`. The deployed conversation-only agent intentionally skips project context files; committing this pack does not install CAD tools or prove that live sessions read it.

## Read the relevant complete contract

| Document | Read when | Required outcome |
| --- | --- | --- |
| [Part-creation hard acceptance](part-creation-happy-path-hard-acceptance.md) | Agent planning, action admission, Part creation, preview/commit, persistence or completion reporting changes | The actual agent creates the requested parametric Part inside the intended project; independent application readback proves it |
| [SolidWorks action contract](solidworks-part-actions.md) | Sketch, plane/face selection, dimensions/relations, features, rebuilds or modeling tools change | Human and agent execute the same declared sketch-to-feature semantics, not alternate code-generation shortcuts |
| [Frozen cases](part-creation-cases.json) | Defining, running or verifying any case | Exact dimensions, action sequence, geometry expectations and safety states remain bound to the run |
| [Hard negative cases](part-creation-negative-tests.md) | Authorization, invalid inputs, cancellation, recovery, identity or evidence handling changes | Fail closed without wrong-project effects, duplicate Parts, lost history or false completion |
| [Pinned audit baseline](audit-baseline.md) | Assessing what is implemented versus what this pack requires | Keep the baseline's source findings separate from new runtime proof |

The pack follows Aegis's `.hermes/` hard-acceptance structure, not Aegis's domain policy or execution authority. Aegis Loop publication/execution maps here to two distinct observations: the frozen requested Part/actions, and the actual application-produced Part/revision/geometry. A good description, valid case JSON or code block is not the second observation.

## Working rules

- These documents define targets. Saving them grants no tools, credentials, approval, application execution, publication, deployment, fabrication release or machine actuation.
- Follow current owner direction, repository doctrine and real runtime/authorization gates. Instructions never replace those gates. Record genuine contract disagreements instead of silently shrinking a case or changing authority.
- Keep browser-local TypeScript commands and immutable revisions as writable CAD authority. An agent may request only an admitted project-scoped application action; it must not directly edit authored storage, review/release records or arbitrary source files.
- Separate human-control proof, synthetic adapter tests, real-agent application execution, independent geometry verification, source delivery and installed-workstation proof. A PASS in one tier does not pass another.
- Use PASS, FAIL, BLOCKED, UNAVAILABLE or NOT EXERCISED precisely. No action interface means UNAVAILABLE, not PASS; an actual independent approval hold means BLOCKED; stages never reached are NOT EXERCISED.
- Keep reusable contracts versioned. Never commit runtime homes, credentials, approval/session material, live chat transcripts, generated logs, screenshots or machine-local evidence here. Do not blanket-ignore `.hermes/`.
- Changing instructions does not update existing workers. Verify root routing with the effective context loader in a fresh process. Explicitly implement and verify an approved contract-injection/action interface before claiming the deployed agent adopted this pack.

## Scope of “identical to SolidWorks”

For these named cases, identity means the same selected sketch plane or material face, sketch entities, origin/relations/driving dimensions, feature operation, extent/direction, merge behavior, edit/rebuild semantics and resulting geometry. Piton labels, panels, protocol messages and tessellation bytes need not match SolidWorks. This is not a claim of complete SolidWorks feature, solver, kernel, UI or fabrication parity. Unsupported required actions remain visible failures or unavailable capabilities; do not substitute a different workflow and call the original case passed.
