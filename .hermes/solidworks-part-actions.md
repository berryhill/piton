# SolidWorks-equivalent Part action contract

This is a semantic action catalog for the cases in `part-creation-cases.json`, NOT existing API/tool names, executable clients or a claim that the deployed agent can invoke them. Bind each action to the real supported application surface before execution. Missing bindings are UNAVAILABLE; do not invent methods.

## Shared human/agent behavior

Both lanes must select the same resources and perform the same modeling operations. A human normally clicks controls; an admitted agent may request their typed application equivalents. Both must flow through the same browser-owned command/validation/revision authority. Neither lane may bypass authentication, expected-revision checks or real approvals, directly write storage, or silently import a replacement model.

The owner request scopes the intended Part actions, not arbitrary workstation execution. Read-only inspection never authorizes model mutation. A geometry worker's output is evidence, not permission to commit it. Keep preview and commit distinct. Do not invent an extra engineering sign-off to run an otherwise admitted review-only action, and never reinterpret CAD commit as engineering sign-off.

### Coordinate and dimensional conventions

- All fixture dimensions are millimetres. `diameter` is never a radius. Named nominal pipe sizes do not automatically convert into physical diameters.
- Front corresponds to canonical XY; Top to XZ; Right to YZ. The catalog declares actual world-coordinate bounds for each plate variant. Compare physical coordinates and face normals, not SVG pixel directions or labels alone.
- A selected support must be the exact current named planar material region with cardinality one. Bind it to Part, source and revision. Clear stale support on revision/tab/proposal changes; do not pick a nearest face or persist triangle ordinals.
- An axis of revolution must lie in the actual sketch plane. Rotating a reinterpreted radial/axial drawing is not proof of a normal SolidWorks sketch-plane workflow.

## Actions

| Semantic action | SolidWorks counterpart and required effect |
| --- | --- |
| `part.create` | New Part in the intended project; real persistent identity, empty initial body/history, visible document tab. Must be performed by the case actor, not seeded by the verifier. |
| `plane.select` | Select Front/Top/Right as specified; physical frame and normal agree with the fixture. |
| `sketch.begin` | Start Sketch on that selected plane or admitted face; bind a stable sketch identity and support. |
| `view.normal_to` | Normal To the active sketch plane; actual origin point/local axes and usable drawing region visible at sketch creation. A caption naming axes is not drawn origin/axis feedback. |
| `sketch.rectangle` | Corner Rectangle with specified corner/size; a real editable sketch contour, not a generated solid box. |
| `sketch.circle` | Circle with specified center/diameter; concentric outer/inner contours remain distinct when the case requires an annular region. |
| `sketch.line_chain` | Connected Line entities at specified local coordinates; maintain entity identity and truthful open/closed topology. |
| `sketch.dimension` | Smart Dimension/set or edit an existing driving dimension: lengths, diameters and positions actually control geometry. Record driver IDs; do not add duplicate/redundant drivers when setting an existing value. |
| `sketch.relation` | Apply the declared Coincident/Concentric/Horizontal/Vertical/Fixed relation, with real supported constraint semantics. An origin-coincident entity must not also receive redundant zero-position drivers. |
| `sketch.trim` | Trim Entities removes the specified real segment while retaining the specified side/connected chain; not a label or arbitrary redrawn substitute. |
| `sketch.mirror` | Mirror Entities with Copy about the specified local axis; case HP-07 verifies its creation result and does not claim general associative mirror editing. |
| `sketch.finish` | Exit Sketch without silently creating a body or losing sketch intent; leave the selected profile available to feature creation. |
| `face.select` | Select the current actual planar material face with exact named support and cardinality; clicking an opening's empty center is not selecting its surrounding face. |
| `axis.select` | Select the declared existing or construction axis by physical origin/direction; bind it to this Part/sketch, never a guessed default. |
| `feature.boss_extrude` | Extruded Boss/Base on the selected contour/region, with declared Blind depth/direction and Merge result. Secondary bosses must unite with the existing body. |
| `feature.cut_extrude` | Extruded Cut against the current target body, with specified Blind or Through All and inward direction. Through All follows real target bounds, not an arbitrary long cutter. |
| `feature.revolve` | Revolved Boss/Base about the selected in-plane axis, exactly 360° in HP-09, using the actual positioned section. |
| `feature.hole` | The declared simple straight through-hole operation/positioning (a bounded Hole Wizard equivalent); no unsupported thread/countersink/standard claim. |
| `feature.linear_pattern` | Linear Pattern of the selected seed feature, declared direction/spacing and total instances INCLUDING the seed. Preserve pattern intent, not independent manually duplicated holes. |
| `feature.fillet` | Fillet on exactly the selected edge scope/radius. HP-11 selects all four vertical outer corner edges, not every edge or the top rim. |
| `feature.chamfer` | Equal-distance Chamfer on exactly the selected scope; HP-12 uses 2 × 2 mm vertical outer corner chamfers. |
| `model.preview` | Evaluate a candidate and display the actual revision/source-bound geometry and diagnostics; committed state remains unchanged. |
| `model.commit` | Separate explicit accept/commit through admitted application authority; create the correct immutable child revision, not a release or engineering approval. |
| `tree.select` | Select the actual earlier feature/sketch in this Part's Model tree with stable identity; no fixture/demo-tree substitution. |
| `feature.edit` | Edit Feature/its properties with prefilled actual parameters and preserved identity; keep the old accepted state until a valid new commit. |
| `model.rebuild` | Rebuild dependent features from the edited source; move named supports and report the first invalid dependency truthfully. |
| `part.inspect` | Independently inspect current authored state and actual evaluated geometry/selection. It does not create or repair the expected Part. |
| `part.reopen` | Close/reopen or reload the exact resource; verify persisted Part/revision/source/dependency identity and geometry. |

## Sketch definition truth

Show the actual definition state of the supported constraint system, not “fully defined” merely because a profile is closed or numeric coordinates exist. A centered annulus has separate position and outer/inner diameter drivers. Contradictory/redundant constraints must fail atomically, preserving last-valid intent.

The dimensioned fixture profiles target a fully defined supported subset. HP-07 intentionally checks an underdefined but closed, valid copy-mirrored sketch before extrusion; underdefined is a legitimate SolidWorks state and must not be relabelled fully defined. No universal industrial solver is required, but unsupported relation classes must not be silently approximated.

## Required source/feature continuity

Every logical alias in a case binds to an actual returned sketch/feature/Part/revision identity. `setup_case` aliases belong to the current case run. Earlier feature edits preserve existing identities and regenerate descendants; previous revision bytes remain unchanged. A selected profile must not silently become “the last profile,” and a target body must not silently become an unrelated latest body.

Equivalent final mesh shape alone is insufficient when a case requires a sketch, pattern, support or edit chain. Do not use OpenSCAD text, arbitrary CSG scripts, advanced-source editing, console/storage writes or prebuilt STL import as a shortcut for either lane.

## Reference grounding

- SOLIDWORKS Help, Sketching with Extruded or Revolved Bosses/Bases: https://help.solidworks.com/2025/English/SolidWorks/sldworks/t_sketching_bosses_bases.htm
- Retained tutorial research for the original practical-flow contract: https://www.youtube.com/watch?v=-MO3Raq65rc and https://www.youtube.com/watch?v=2d5fqj199Og . Earlier research sampled frames and captions, not continuous playback; do not claim all extensions were demonstrated there.

The reference supports plane selection, closed sketches and the sketch-to-feature transition. The named pocket/coupler/pattern/finish fixtures are explicit product acceptance inputs, not copied tutorial results, verified plumbing standards, or a blanket claim of complete SolidWorks parity.
