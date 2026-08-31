# Human-review launch assets

These assets prepare evidence for a person; they do not approve, export for fabrication, release, promote a channel, or actuate a machine. Every review retains `review_state=needs_human_review`, `fabrication_release=false`, and `machine_actuation=false`.

## Browser workbench review

1. Install the exact locked dependencies with `pnpm install --frozen-lockfile`.
2. Install Chromium once with `pnpm exec playwright install chromium`.
3. Run the canonical gate with `pnpm verify`.
4. Launch with `pnpm start` and open the URL printed by Vite.
5. Confirm the seeded L-bracket, source-parameter zone, bbox, build-volume context, and review-only disclosure.
6. Confirm CAD Z=0 sits on the physical grid.
7. Preview and commit one bounded `leg_length_mm` mutation, then reload and verify OPFS readback.
8. Confirm accepted state remains distinct from the committed candidate and all release/actuation fields remain false.

## R14/B fixture documents and tabs

Use the browser workbench to complete this bounded interaction review:

1. Confirm the project container lists exactly these documents in this order: `Base Plate.part`, `Clamp Jaw.part`, `Guide Pin.part`, and `Bench Clamp.assembly`.
2. Confirm `Base Plate.part` and `Bench Clamp.assembly` initially have open tabs, with `Bench Clamp.assembly` active.
3. Open a closed document from the project tree. Confirm it receives one active tab. Open that same document again and confirm no duplicate tab is created.
4. Close an active tab while another tab remains. Confirm activation moves to the bounded neighboring tab rather than an unrelated or closed document.
5. Close tabs until the final open tab is closed. Confirm the baseline workspace is restored deterministically: `Base Plate.part` and `Bench Clamp.assembly` are open and `Bench Clamp.assembly` is active.
6. In one document, change its selection and view preset. Switch to another document and set different selection/view state. Switch back, then close and reopen the first document; confirm each document retains its own selection and view state without leaking state to the other document.

The four document records and their displayed parameter values are static fixture metadata and review-interaction evidence only. They are not exact-kernel realization, exact topology, fabrication suitability, engineering approval, export, or release claims.

## R14/C static Assembly review scene

With `Bench Clamp.assembly` active, complete this bounded review:

1. Confirm the viewport identifies `Assembly scene · Bench Clamp`, reports four visible occurrences, and reports `CAD Z min 0 mm` on the physical grid/build plane.
2. Confirm the occurrences are `Base Plate:1 (Fixed)`, `Clamp Jaw:1`, `Clamp Jaw:2`, and `Guide Pin:1`; both Clamp Jaw occurrences must remain independently selectable.
3. Select each occurrence and use its disclosed source reference. Confirm both Clamp Jaw occurrences resolve to the same `Clamp Jaw.part` source while retaining distinct occurrence IDs.
4. Select a contextual review face and confirm its ID is occurrence-qualified rather than presented as durable exact topology.
5. Confirm the only relationships shown are `Distance Mate · Jaw spacing` at 72 mm and `Concentric Mate · Guide Pin`, both explicitly labeled `review-only`.
6. Confirm no interaction can author an occurrence, transform, mate, Assembly revision, approval, export, fabrication release, or machine actuation.

This scene is static browser-local Three.js review geometry. It communicates explicit occurrence/source/relationship semantics, but it is not exact geometry, a solved Assembly, or fabrication evidence.

The test gate is automated candidate evidence, not a substitute for this visual human review. The repository does not contain an exact-CAD adapter, disconnected packet generator, engineering-approval issuer, fabrication exporter, release path, or machine-control path.
