# Piton rollback and restore-forward policy

Accepted design history is immutable. Product revisions use
restore-forward: create a new revision reproducing prior intent and
bind the reason/evidence. Git rollback follows repository policy and
must not rewrite protected history. Failed builds and candidates never
replace last-good. Undo/rollback is restore-forward into a new
revision; rollback mutation is forbidden.

Piton was named after the OpenDesign R14 Bench Clamp Fixture prototype
(project `8da9ea71`, conversation `76d3d331`, authoring revision
`r14-05729d28`). The in-repo canonical doctrine is
[`docs/mvi-doctrine.md`](mvi-doctrine.md). Where this file disagrees
with `docs/mvi-doctrine.md`, the doctrine wins.

Release is not implemented in Stage 1.
