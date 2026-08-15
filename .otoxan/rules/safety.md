# Piton safety and authority rules

1. `fabrication_release=false` until a separate future human-gated release capability is designed and approved.
2. No machine actuation.
3. Browser-local TypeScript commands and immutable revision state are the primary writable Stage 1 product authority. Python/build123d remains an optional pinned external exact-CAD/reference adapter and cannot mutate authored revisions.
4. Workers produce realizations and evidence; they do not mutate authored state or review/release state.
5. Exact geometry, STEP, GLB, STL, and 3MF have distinct claim scopes.
6. Failed builds retain diagnostics and never replace last-good.
7. Ambiguous release-critical references block; never choose nearest geometry.
8. Secret references only; never secret literals.
