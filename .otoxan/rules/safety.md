# Piton safety and authority rules

1. `fabrication_release=false` until a separate future human-gated release capability is designed and approved.
2. No machine actuation.
3. Browser-local TypeScript commands and immutable revision state are the sole writable Stage 1 product authority.
4. Workers produce revision-scoped review geometry and evidence; they do not mutate authored state or review/release state.
5. Review geometry is not exact geometry. STEP, GLB, STL, and 3MF have distinct claim scopes when a future separately reviewed capability introduces them.
6. Failed builds retain diagnostics and never replace last-good.
7. Ambiguous release-critical references block; never choose nearest geometry.
8. Secret references only; never secret literals.
