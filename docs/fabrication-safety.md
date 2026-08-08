# Fabrication safety boundary

Piton Stage 1 is review-only. It may create an explicitly unreleased
draft export, but it implements no FabricationRelease endpoint, key,
grant, UI control, recovery action, or machine-actuation path. Build
success, validation, human review, merge, install, export, and package
creation do not imply fabrication approval; approval ≠ exported;
exported ≠ released; released ≠ machine actuation.

Piton was named after the OpenDesign R14 Bench Clamp Fixture prototype
(project `8da9ea71`, conversation `76d3d331`, authoring revision
`r14-05729d28`). The in-repo canonical doctrine is
[`docs/mvi-doctrine.md`](mvi-doctrine.md). Where this file disagrees
with `docs/mvi-doctrine.md`, the doctrine wins.
