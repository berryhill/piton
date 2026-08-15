# Piton context

Piton is a runnable, local-first Mechanical CAD MVI. Its primary product surface is the browser workbench: browser-local TypeScript commands are the only writable authored authority, immutable `DesignRevision` records are stored by SQLite WASM in OPFS, and a pinned Manifold WASM Web Worker produces revision-scoped review meshes. The first production-candidate slice remains one consequential Part, one bounded parameter mutation, predeclared checks, review artifacts, and human review.

The Python/build123d/OCP surface is an optional external exact-CAD/reference and lifecycle-framework adapter. It can derive exact and review evidence for an explicitly bound revision, but it cannot mutate browser-authored revisions and is not a second writable authority. Neither browser nor Python success grants review acceptance, approval, export, fabrication release, or machine actuation.

Piton was named after the OpenDesign R14 Bench Clamp Fixture prototype (project `8da9ea71`, conversation `76d3d331`, authoring revision `r14-05729d28`). The in-repo canonical doctrine is `docs/mvi-doctrine.md`; this doc must align with that file.

The repository contains the runnable browser MVI and its preserved Python exact-adapter/framework foundation, not merely an implementation scaffold. It has Git history and an attached GitHub origin, but no deployment, production approval, fabrication release, or machine-actuation capability exists. Root truth remains `review_state=needs_human_review`, `fabrication_release=false`, and `machine_actuation=false`.
