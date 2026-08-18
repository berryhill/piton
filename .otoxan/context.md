# Piton context

Piton is a runnable, local-first Mechanical CAD MVI. Its primary product surface is the browser workbench: browser-local TypeScript commands are the only writable authored authority, immutable `DesignRevision` records are stored by SQLite WASM in OPFS, and a pinned Manifold WASM Web Worker produces revision-scoped review meshes. The first production-candidate slice remains one consequential Part, one bounded parameter mutation, predeclared checks, review artifacts, and human review.

The tracked Python/build123d/OCP surface is pre-cutover legacy assigned to downstream retirement tasks. It is not a current product, backend, adapter, verification authority, or writable authority. Its temporary presence does not change the browser-only authority contract, and T001 must not remove files owned by later tasks.

Piton was named after the OpenDesign R14 Bench Clamp Fixture prototype (project `8da9ea71`, conversation `76d3d331`, authoring revision `r14-05729d28`). The in-repo canonical doctrine is `docs/mvi-doctrine.md`; this doc must align with that file.

The repository contains the runnable browser MVI plus pre-cutover evidence awaiting staged retirement. Exact B-rep, STEP, exact review packets, engineering approval, manufacturing-package export, fabrication release, and machine actuation are unavailable in the browser product. Root truth remains `review_state=needs_human_review`, `fabrication_release=false`, and `machine_actuation=false`.
