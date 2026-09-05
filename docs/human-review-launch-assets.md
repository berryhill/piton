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

## R14/D hierarchical model tree and review commands

Review both Part and Assembly documents:

1. Confirm each Part tree contains its document root, `Origin` with Front/Top/Right planes, exactly one `Body`, the declared feature sequence, and a `Review surfaces` branch. Base Plate must show Sketch 1, Extrude 1, Sketch 2, and Hole Pattern 1; Clamp Jaw must show Sketch 1 and Extrude 1; Guide Pin must show Sketch 1 and Revolve 1.
2. Confirm the Assembly tree has `Components` and `Mates`. Components must contain the four canonical occurrences, explicit source-document references, and occurrence-qualified contextual review surfaces. Mates must contain only the Distance and Concentric relationships, each labeled `review-only`.
3. Use twisties and Arrow Up/Down/Left/Right, Home, End, Enter, and Space. Confirm one roving tree item is tabbable, activating the selected item again clears selection, and expansion/focus state remains independent when switching documents.
4. Confirm Part categories are Features/Sketch/Inspect and Assembly categories are Assembly/Mates/Inspect. Inspect must initially be active and each document must restore its own category after tab switching or reopening.
5. Confirm every feature, sketch, Assembly, and mate-authoring control is visibly unavailable and disabled. These vocabulary controls must not author geometry, occurrences, transforms, mates, or revisions.
6. In Inspect, confirm Measure requires a selection, Clear Measurement is enabled only when the active document has measurement state, and Open Part is enabled only for a canonical Assembly occurrence, source reference, or contextual review surface.
7. Double-click canonical source-bearing Assembly selections and confirm navigation opens the exact in-fixture Part. Confirm a mate, unknown ID, missing reference, or inactive-document request cannot navigate or alter any document state.
8. Switch among Part and Assembly tabs and confirm selection, expansion, focus, category, and measurement state do not leak. Confirm `review_state=needs_human_review`, `fabrication_release=false`, and `machine_actuation=false` remain unchanged.

Tree identities are fixture-local semantic review IDs. Labels, indices, face ordinals, triangle IDs, and Three.js UUIDs are not presented as durable exact topology. Command admission affects only bounded per-document review interaction state; it creates no `DesignRevision`, build success, approval, export, release, or actuation consequence.

## R14/E viewport selection and source navigation

With `Bench Clamp.assembly` active and the Inspect category selected:

1. In Smart mode, click each visible occurrence. Confirm the current selection and model-tree selection use its canonical occurrence ID; in particular, confirm `Clamp Jaw:1` and `Clamp Jaw:2` remain distinct.
2. Repeat in Component mode. Confirm each pick resolves to an occurrence, not a source-document ID or Three.js object identity.
3. Switch to Face mode and click mapped Base Plate, Clamp Jaw, and Guide Pin review primitives. Confirm each selection is an existing occurrence-qualified `contextual-face:component:…` tree identity. An unmapped primitive or background must not invent a face identity.
4. Confirm occurrence, contextual-face, and mate selections produce visibly distinct cyan, amber, and magenta review highlights. Repeated Part occurrences must not highlight each other unless a selected review-only mate relates them.
5. Double-click each Clamp Jaw occurrence in Smart or Component mode. Confirm the exact `Clamp Jaw.part` source opens and the navigation context retains the originating occurrence label.
6. Switch out of Inspect and confirm viewport picks cannot alter selection or navigate. Return to Inspect and confirm the previous document-local mode and state remain bounded to the Assembly document.
7. Confirm `review_state=needs_human_review`, `fabrication_release=false`, and `machine_actuation=false` remain unchanged.

Ray hits translate only through the static fixture's predeclared artifact-local occurrence and contextual-face map. The map and highlights are review interaction evidence, not exact topology, authored Assembly authority, engineering approval, export, or fabrication evidence.

## R14/H document-specific approximate source and review-mesh STL

Review each of `Base Plate.part`, `Clamp Jaw.part`, `Guide Pin.part`, and `Bench Clamp.assembly`:

1. Select **View approximate source**. Confirm the disclosed program names the active document and is derived from that document's displayed parameters. For the Assembly, confirm all four canonical occurrences, source-document references, translations, and rotations are present.
2. Switch among Part and Assembly tabs. Confirm source visibility and content remain document-local. Close and reopen a tab and confirm its prior source visibility is retained without leaking another document's program.
3. Select **Download review-mesh STL**. Confirm the active document downloads as `<document-id>-review-mesh.stl`, retaining the document-kind suffix in the ID (for example, `base-plate.part-review-mesh.stl` or `bench-clamp.assembly-review-mesh.stl`), and reaches `Ready · validated nonempty ASCII STL` with a positive byte count and facet count.
4. Confirm the status reports `CAD Z min 0 mm`. The STL coordinate frame uses CAD Z directly, so the model's physical bottom is on the build-plane/grid at Z=0.
5. Open the downloaded file as text. Confirm it begins with `solid piton_`, contains at least one `facet normal`, ends with the matching `endsolid piton_` name, and contains ASCII only.
6. Generate output for a second document, then return to the first. Confirm each tab retains only its own status, filename, counts, and source disclosure. A Part download must not silently contain the Assembly or another Part.
7. Confirm the output panel continues to state that approximate source and STL are review derivatives, not exact B-rep, engineering approval, export authority, or fabrication release. Confirm `review_state=needs_human_review`, `fabrication_release=false`, and `machine_actuation=false` remain unchanged.

Generation is browser-local and deterministic from the static R14 fixture parameters and occurrence transforms. The exported STL contains model review geometry only; grid, lights, cameras, highlights, labels, and other scene helpers are excluded. Output success creates no `DesignRevision`, build acceptance, approval, exact-geometry claim, release, or actuation consequence.

The test gate is automated candidate evidence, not a substitute for this visual human review. The repository does not contain an exact-CAD adapter, disconnected packet generator, engineering-approval issuer, fabrication exporter, release path, or machine-control path.
