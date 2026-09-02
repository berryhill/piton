import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { BrowserProject, DesignRevision } from "./domain";
import type { BuildStatus, CadApplication } from "./application";
import Viewport from "./components/Viewport";
import AssemblyViewport from "./components/AssemblyViewport";
import { R14_ASSEMBLY, assemblyContextualFaceId } from "./assembly";
import type { MeshBounds } from "./geometry/view";

import { durableGeometryStatusLabel } from "./geometry/binding";
import type { StartupMode } from "./startup";
import {
  R14_FIXTURE,
  activateFixtureDocument,
  clearFixtureReviewMeasurement,
  closeFixtureDocument,
  createFixtureSession,
  dispatchFixtureReviewCommand,
  fixtureCommandCategories,
  fixtureDocument,
  fixtureModelTree,
  fixtureOpenPartTarget,
  flattenFixtureTree,
  openFixtureDocument,
  setFixtureCommandCategory,
  setFixtureTreeInteraction,
  setFixtureViewportSelection,
  updateFixtureDocumentView,
} from "./fixture";
import type { FixtureCommandCategory, FixtureSelectionMode, FixtureTreeNode, FixtureViewPreset } from "./fixture";
import "./styles.css";

interface Props { application: CadApplication; geometryDisabled?: boolean; startupMode?: StartupMode; }

export type SemanticSelectionId = "face:top" | "component:l-bracket:1" | "origin" | "plane:top" | "mate:review-only";

const SEMANTIC_SELECTIONS: ReadonlyArray<{ id: SemanticSelectionId; label: string }> = [
  { id: "face:top", label: "Top review face" },
  { id: "component:l-bracket:1", label: "Component / reference" },
  { id: "origin", label: "Origin" },
  { id: "plane:top", label: "Top plane" },
  { id: "mate:review-only", label: "Review mate" },
];

function isSemanticSelectionId(value: string | null): value is SemanticSelectionId {
  return SEMANTIC_SELECTIONS.some(({ id }) => id === value);
}


function derivePortableCustodyFilename(name: string, fingerprint: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "piton-project";
  const tag = fingerprint.replace(/^sha256-/, "").slice(0, 12);
  return `${slug}-${tag}.piton-custody.json`;
}

export default function App({ application, geometryDisabled, startupMode = "open-or-seed" }: Props) {
  const [project, setProject] = useState<BrowserProject | null>(null);
  const [value, setValue] = useState(80);
  const [message, setMessage] = useState("Opening browser-local custody…");
  const [durableBuildStatus, setDurableBuildStatus] = useState<BuildStatus | null>(null);
  const [renderedBounds, setRenderedBounds] = useState<MeshBounds | null>(null);
  const [fixtureWorkspace, setFixtureWorkspace] = useState(createFixtureSession);
  const [navigationContext, setNavigationContext] = useState("Source-Part · L-bracket Part");
  const [attachedContext, setAttachedContext] = useState<{ id: SemanticSelectionId; label: string; revisionId: string } | null>(null);
  const [portableBusy, setPortableBusy] = useState(false);
  const [portableError, setPortableError] = useState<string | null>(null);
  const [openResponsivePanel, setOpenResponsivePanel] = useState<"model" | "custody" | null>(null);
  const portableFileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => { void (async () => {
    try {
      const opened = await application.open(startupMode);
      if (!opened) {
        setMessage("Import portable custody into fresh browser storage");
        return;
      }
      setProject(opened.project); setDurableBuildStatus(opened.buildStatus);
      setValue(opened.project.revisions.find((r) => r.id === opened.project.currentRevisionId)!.parameters.leg_length_mm);
      setMessage(`Reopened from ${opened.persistenceLabel}`);
    } catch (error) { setMessage(`Persistence unavailable: ${error instanceof Error ? error.message : "unknown error"}`); }
  })(); }, [application, startupMode]);

  const current = project?.revisions.find((revision) => revision.id === project.currentRevisionId) ?? null;
  const accepted = project?.revisions.find((revision) => revision.id === project.acceptedRevisionId) ?? null;
  const previewParameters = useMemo(() => {
    if (!current || value === current.parameters.leg_length_mm) return current?.parameters ?? null;
    if (!Number.isFinite(value) || value < 40 || value > 160) return null;
    return { ...current.parameters, leg_length_mm: value };
  }, [current, value]);
  const changed = Boolean(current && previewParameters && value !== current.parameters.leg_length_mm);
  const activeFixtureDocument = fixtureDocument(fixtureWorkspace.activeDocumentId);
  const activeFixtureState = fixtureWorkspace.documentStates[fixtureWorkspace.activeDocumentId];
  const fixtureKind = activeFixtureDocument.kind;
  const selectionMode = activeFixtureState.selectionMode;
  const currentSelection = activeFixtureState.selection;
  const measurementMm = activeFixtureState.reviewMeasurementMm;
  const activeModelTree = useMemo(() => fixtureModelTree(activeFixtureDocument.id), [activeFixtureDocument.id]);
  const activeTreeNodes = useMemo(() => flattenFixtureTree(activeModelTree), [activeModelTree]);
  const admittedMeasurement = currentSelection && activeFixtureState.commandCategory === "inspect"
    ? activeTreeNodes.find(({ id, kind }) => id === currentSelection && kind === "review-surface") ?? null
    : null;
  const currentSelectionLabel = currentSelection?.startsWith("contextual-face:") ? currentSelection
    : activeTreeNodes.find(({ id }) => id === currentSelection)?.label
    ?? SEMANTIC_SELECTIONS.find((selection) => selection.id === currentSelection)?.label
    ?? R14_ASSEMBLY.occurrences.find(({ id }) => id === currentSelection)?.label
    ?? R14_ASSEMBLY.relationships.find(({ id }) => id === currentSelection)?.label
    ?? R14_ASSEMBLY.contextualFaces.find(({ id }) => id === currentSelection)?.id
    ?? "None";
  const assemblyContextOccurrence = R14_ASSEMBLY.occurrences.find(({ id }) => id === currentSelection)
    ?? R14_ASSEMBLY.occurrences.find(({ id }) => currentSelection?.startsWith(`contextual-face:${id}:`));

  function selectSemantic(id: SemanticSelectionId) {
    const expectedDocumentId = activeFixtureDocument.id;
    if (activeFixtureState.commandCategory !== "inspect" || !activeTreeNodes.some((node) => node.id === id)) return;
    setFixtureWorkspace((workspace) => setFixtureTreeInteraction(workspace, expectedDocumentId, { selectionId: id, focusId: id }));
  }

  function setSelectionMode(mode: FixtureSelectionMode) {
    const expectedDocumentId = activeFixtureDocument.id;
    setFixtureWorkspace((workspace) => updateFixtureDocumentView(workspace, expectedDocumentId, { selectionMode: mode }));
  }

  function setFixtureView(viewPreset: FixtureViewPreset) {
    const expectedDocumentId = activeFixtureDocument.id;
    setFixtureWorkspace((workspace) => updateFixtureDocumentView(workspace, expectedDocumentId, { viewPreset }));
  }

  function selectTreeNode(id: string) {
    const expectedDocumentId = activeFixtureDocument.id;
    setFixtureWorkspace((workspace) => setFixtureTreeInteraction(workspace, expectedDocumentId, { selectionId: id, focusId: id }));
  }

  function toggleTreeNode(id: string, expand?: boolean) {
    const expectedDocumentId = activeFixtureDocument.id;
    setFixtureWorkspace((workspace) => {
      if (workspace.activeDocumentId !== expectedDocumentId) throw new Error("stale or inactive fixture document context");
      const state = workspace.documentStates[expectedDocumentId];
      const expanded = new Set(state.treeExpandedIds);
      const shouldExpand = expand ?? !expanded.has(id);
      if (shouldExpand) expanded.add(id); else expanded.delete(id);
      return setFixtureTreeInteraction(workspace, expectedDocumentId, { expandedIds: [...expanded], focusId: id });
    });
  }

  function focusTreeNode(id: string) {
    const expectedDocumentId = activeFixtureDocument.id;
    setFixtureWorkspace((workspace) => setFixtureTreeInteraction(workspace, expectedDocumentId, { focusId: id }));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-tree-id="${id}"]`)?.focus());
  }

  function handleTreeKey(event: KeyboardEvent, id: string) {
    const visible = visibleFixtureTreeNodes(activeModelTree, new Set(activeFixtureState.treeExpandedIds));
    const index = visible.findIndex((node) => node.id === id);
    const node = visible[index];
    if (!node) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const targetIndex = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      focusTreeNode(visible[targetIndex].id);
    } else if (event.key === "ArrowRight" && node.children.length > 0) {
      event.preventDefault();
      if (!activeFixtureState.treeExpandedIds.includes(id)) toggleTreeNode(id, true); else focusTreeNode(node.children[0].id);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (activeFixtureState.treeExpandedIds.includes(id) && node.children.length > 0) toggleTreeNode(id, false);
      else {
        const parent = fixtureTreeParentId(activeModelTree, id);
        if (parent) focusTreeNode(parent);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectTreeNode(id);
    }
  }

  function openSelectedPart(selectionId = currentSelection, admitViewportSelection = false) {
    if (activeFixtureState.commandCategory !== "inspect") return;
    const target = fixtureOpenPartTarget(activeFixtureDocument.id, selectionId);
    if (!target || !selectionId) return;
    const sourceName = fixtureDocument(target).fileName;
    const contextualOccurrence = R14_ASSEMBLY.occurrences.find(({ id }) => selectionId.startsWith(`contextual-face:${id}:`));
    const sourceSelectionLabel = contextualOccurrence?.label
      ?? activeTreeNodes.find(({ id }) => id === selectionId)?.label
      ?? currentSelectionLabel;
    const expectedDocumentId = activeFixtureDocument.id;
    const category = activeFixtureState.commandCategory;
    setFixtureWorkspace((workspace) => {
      const selectedWorkspace = admitViewportSelection
        ? setFixtureViewportSelection(workspace, expectedDocumentId, selectionId)
        : workspace;
      return dispatchFixtureReviewCommand(selectedWorkspace, {
        expectedDocumentId,
        category,
        command: "open-part",
        selectionId,
      });
    });
    setNavigationContext(`Source-Part · ${sourceName} · from ${sourceSelectionLabel}`);
  }

  function measureSelection() {
    if (!admittedMeasurement || !currentSelection) return;
    const expectedDocumentId = activeFixtureDocument.id;
    const category = activeFixtureState.commandCategory;
    const selectionId = currentSelection;
    setFixtureWorkspace((workspace) => dispatchFixtureReviewCommand(workspace, {
      expectedDocumentId,
      category,
      command: "measure",
      selectionId,
    }));
  }

  useEffect(() => {
    if (previewParameters || activeFixtureState.reviewMeasurementMm == null) return;
    const expectedDocumentId = activeFixtureDocument.id;
    setFixtureWorkspace((workspace) => clearFixtureReviewMeasurement(workspace, expectedDocumentId));
  }, [activeFixtureDocument.id, activeFixtureState.reviewMeasurementMm, previewParameters]);

  async function commit() {
    if (!project || !changed) return;
    try {
      await application.executeCommand({
        format: "piton-command/v1",
        projectId: project.id,
        expectedCurrentRevisionId: project.currentRevisionId,
        idempotencyKey: `ui:${project.currentRevisionId}:${value}`,
        command: { type: "set-leg-length", quantity: { value, unit: "mm" } },
      });
      const authoritative = await application.loadProject();
      setProject(authoritative);
      const authoritativeCurrent = authoritative.revisions.find((revision) => revision.id === authoritative.currentRevisionId)!;
      setValue(authoritativeCurrent.parameters.leg_length_mm);
      setMessage("Candidate committed locally");
    } catch (error) {
      try {
        const authoritative = await application.loadProject();
        setProject(authoritative);
        const authoritativeCurrent = authoritative.revisions.find((revision) => revision.id === authoritative.currentRevisionId)!;
        setValue(authoritativeCurrent.parameters.leg_length_mm);
      } catch { /* Preserve the original commit rejection when custody reload also fails. */ }
      setMessage(`Commit rejected: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  async function exportPortableCustody() {
    if (!project) return;
    setPortableBusy(true);
    setPortableError(null);
    try {
      const envelope = await application.exportPortableCustody();
      const text = `${JSON.stringify(envelope, null, 2)}\n`;
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = derivePortableCustodyFilename(project.name, envelope.fingerprint);
      anchor.dataset.testid = "portable-custody-download";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setMessage(`Portable custody exported · ${anchor.download}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      setPortableError(reason);
      setMessage(`Portable custody export failed: ${reason}`);
    } finally {
      setPortableBusy(false);
    }
  }

  async function importPortableCustody(text: string) {
    if (!text) {
      setPortableError("portable custody file is empty");
      setMessage("Portable custody import failed: portable custody file is empty");
      return;
    }
    setPortableBusy(true);
    setPortableError(null);
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const fingerprint = typeof parsed.fingerprint === "string" ? parsed.fingerprint : "";
      if (!fingerprint) throw new Error("portable custody envelope is missing fingerprint");
      const snapshot = await application.reopenPortableCustody(parsed, fingerprint);
      setProject(snapshot.project);
      setDurableBuildStatus(snapshot.buildStatus);
      const authoritativeCurrent = snapshot.project.revisions.find((revision) => revision.id === snapshot.project.currentRevisionId)!;
      setValue(authoritativeCurrent.parameters.leg_length_mm);
      setAttachedContext(null);
      setFixtureWorkspace(createFixtureSession());
      setMessage(`Reopened from portable custody · ${snapshot.project.name}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      setPortableError(reason);
      setMessage(`Portable custody import failed: ${reason}`);
    } finally {
      setPortableBusy(false);
    }
  }

  async function importPortableCustodyFromFile(file: File) {
    await importPortableCustody(await file.text());
  }

  async function importPortableCustodyFromClipboard() {
    if (!navigator.clipboard?.readText) {
      setPortableError("clipboard paste is not available in this browser context");
      setMessage("Portable custody import failed: clipboard paste is not available in this browser context");
      return;
    }
    try {
      await importPortableCustody(await navigator.clipboard.readText());
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      setPortableError(reason);
      setMessage(`Portable custody import failed: ${reason}`);
    }
  }

  if (!project && startupMode === "import-fresh") return <main className="loading">
    <h1>Piton</h1>
    <p>{message}</p>
    <button data-testid="portable-custody-import-file" disabled={portableBusy} onClick={() => portableFileInput.current?.click()}>
      Select portable custody file…
    </button>
    <button data-testid="portable-custody-import-clipboard" disabled={portableBusy} onClick={() => void importPortableCustodyFromClipboard()}>
      Import from clipboard
    </button>
    <input
      ref={portableFileInput}
      type="file"
      accept=".json,application/json"
      data-testid="portable-custody-file-input"
      style={{ display: "none" }}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void importPortableCustodyFromFile(file);
      }}
    />
    {portableError ? <p className="portable-error" data-testid="portable-custody-error" role="alert">Portable custody error: {portableError}</p> : null}
    <small>Fresh namespace only · review-only · unreleased · no machine actuation.</small>
  </main>;
  if (!project || !current || !accepted) return <main className="loading"><h1>Piton</h1><p>{message}</p></main>;
  return <main className="workbench-shell" data-testid="workbench-shell">
    <a className="skip-link" href="#model-workspace">Skip to model workspace</a>
    <a className="skip-link" href="#revision-custody">Skip to revision custody</a>
    <header><div><span className="eyebrow">PITON</span><h1>Piton Workbench</h1></div>
      <div className="responsive-panel-actions" aria-label="Responsive workbench panels">
        <button aria-label="Model panel" aria-controls="model-panel" aria-expanded={openResponsivePanel === "model"} onClick={() => setOpenResponsivePanel((open) => open === "model" ? null : "model")}>Model</button>
        <button aria-label="Revision custody panel" aria-controls="revision-custody" aria-expanded={openResponsivePanel === "custody"} onClick={() => setOpenResponsivePanel((open) => open === "custody" ? null : "custody")}>Custody</button>
      </div>
      <div className="truth-badge">REVIEW ONLY · UNRELEASED</div>
    </header>
    <nav className="fixture-documents" aria-label="Document commands">
      <div className="fixture-project">
        <b>{R14_FIXTURE.name}</b>
        <span>Project container · review fixture metadata</span>
      </div>
      <div className="fixture-files" aria-label="Project files">
        {R14_FIXTURE.documents.map((document) => <button
          key={document.id}
          aria-current={document.id === fixtureWorkspace.activeDocumentId ? "page" : undefined}
          onClick={() => setFixtureWorkspace((workspace) => openFixtureDocument(workspace, document.id))}
        >{document.kind === "part" ? "PRT" : "ASM"} · {document.fileName}</button>)}
      </div>
      <div className="fixture-tabs" role="tablist" aria-label="Open fixture documents">
        {fixtureWorkspace.openDocumentIds.map((documentId) => {
          const document = fixtureDocument(documentId);
          const active = documentId === fixtureWorkspace.activeDocumentId;
          return <span className={`fixture-tab${active ? " active" : ""}`} key={documentId}>
            <button role="tab" aria-selected={active} tabIndex={active ? 0 : -1} onClick={() => setFixtureWorkspace((workspace) => activateFixtureDocument(workspace, documentId))}>
              <small>{document.kind === "part" ? "PRT" : "ASM"}</small> {document.fileName}
            </button>
            <button aria-label={`Close ${document.fileName}`} onClick={() => setFixtureWorkspace((workspace) => closeFixtureDocument(workspace, documentId))}>×</button>
          </span>;
        })}
      </div>
      <small className="identity-note">{R14_FIXTURE.claimScope}</small>
    </nav>
    <div className="workspace" id="model-workspace" role="region" aria-label="Model workspace" tabIndex={-1}>
      <aside id="model-panel" aria-label="Model and source controls" className={`panel model-panel${openResponsivePanel === "model" ? " open" : ""}`}>
        <button className="panel-close" aria-label="Close model panel" onClick={() => setOpenResponsivePanel(null)}>×</button>
        <h2>Review fixture</h2>
        <div className="segmented" role="group" aria-label="Review fixture kind">
          <button aria-pressed={fixtureKind === "part"} onClick={() => setFixtureWorkspace((workspace) => openFixtureDocument(workspace, "base-plate.part"))}>Part fixture</button>
          <button aria-pressed={fixtureKind === "assembly"} onClick={() => setFixtureWorkspace((workspace) => openFixtureDocument(workspace, "bench-clamp.assembly"))}>Assembly fixture</button>
        </div>
        <p className="boundary-note">{fixtureKind === "assembly"
          ? "Assembly fixture is review-only interaction evidence. It cannot author occurrences, mates, transforms, or Assembly revisions."
          : "Part is the active consequential Stage 1 artifact."}</p>
        <h2>Model tree</h2>
        <div className="model-tree" role="tree" aria-label="Model tree">
          <FixtureTree
            nodes={activeModelTree}
            expandedIds={activeFixtureState.treeExpandedIds}
            focusId={activeFixtureState.treeFocusId}
            selectionId={currentSelection}
            onToggle={toggleTreeNode}
            onSelect={selectTreeNode}
            onKeyDown={handleTreeKey}
            onOpenPart={openSelectedPart}
          />
        </div>
        <div className="legacy-tree-navigation" aria-label="Source and occurrence navigation">
          <button onClick={() => setNavigationContext(`Source-Part · ${activeFixtureDocument.fileName}`)}>▣ Source-Part · {activeFixtureDocument.fileName}</button>
          <button onClick={() => setNavigationContext(`Displayed occurrence · ${fixtureKind === "assembly" ? "Base Plate:1" : activeFixtureDocument.fileName.replace(/\.part$/, ":1")}`)}>◇ Displayed occurrence · {fixtureKind === "assembly" ? "Base Plate:1" : activeFixtureDocument.fileName.replace(/\.part$/, ":1")}</button>
        </div>
        {fixtureKind === "assembly" && assemblyContextOccurrence ? <div className="assembly-tree-occurrence">
          <button disabled={activeFixtureState.commandCategory !== "inspect"} onClick={() => openSelectedPart()}>Open source · {fixtureDocument(assemblyContextOccurrence.sourceDocumentId).fileName} · from {assemblyContextOccurrence.label}</button>
          <button disabled={activeFixtureState.commandCategory !== "inspect"} onClick={() => {
            const id = assemblyContextualFaceId(assemblyContextOccurrence.id, assemblyContextOccurrence.sourceDocumentId === "base-plate.part" ? "face:top" : assemblyContextOccurrence.sourceDocumentId === "clamp-jaw.part" ? "face:jaw-grip" : "face:pin-shaft");
            selectTreeNode(id);
          }}>▱ Contextual review face · {assemblyContextOccurrence.label}</button>
        </div> : null}
        <div className="navigation-context" data-testid="navigation-context">Navigation: {navigationContext}</div>
        <h2>Review commands</h2>
        <div className="segmented" role="group" aria-label="Review command categories">
          {fixtureCommandCategories(activeFixtureDocument.id).map((category) => <button
            key={category}
            aria-pressed={activeFixtureState.commandCategory === category}
            onClick={() => {
              const expectedDocumentId = activeFixtureDocument.id;
              setFixtureWorkspace((workspace) => setFixtureCommandCategory(workspace, expectedDocumentId, category));
            }}
          >{category[0].toUpperCase() + category.slice(1)}</button>)}
        </div>
        <CommandControls
          category={activeFixtureState.commandCategory}
          measurementAvailable={activeFixtureState.reviewMeasurementMm != null || activeFixtureState.measurement.phase !== "idle"}
          openPartAvailable={fixtureOpenPartTarget(activeFixtureDocument.id, currentSelection) != null}
          measureAvailable={admittedMeasurement != null}
          onMeasure={measureSelection}
          onClearMeasurement={() => {
            const expectedDocumentId = activeFixtureDocument.id;
            const category = activeFixtureState.commandCategory;
            setFixtureWorkspace((workspace) => dispatchFixtureReviewCommand(workspace, {
              expectedDocumentId, category, command: "clear-measurement",
            }));
          }}
          onOpenPart={() => openSelectedPart()}
        />
        <h2>Selection</h2>
        <div className="segmented" role="group" aria-label="Selection mode">
          {(["smart", "face", "component"] as const).map((mode) => <button key={mode} disabled={fixtureKind === "part" && mode === "component"} aria-pressed={selectionMode === mode} onClick={() => setSelectionMode(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
        </div>
        <h2>Fixture view</h2>
        <div className="segmented" role="group" aria-label="Fixture view preset">
          {(["iso", "front", "top"] as const).map((preset) => <button key={preset} aria-pressed={activeFixtureState.viewPreset === preset} onClick={() => setFixtureView(preset)}>{preset[0].toUpperCase() + preset.slice(1)}</button>)}
        </div>
        <div className="semantic-list" aria-label="Fixture-local semantic review selections">
          {SEMANTIC_SELECTIONS.map((selection) => <button key={selection.id}
            disabled={activeFixtureState.commandCategory !== "inspect" || !activeTreeNodes.some((node) => node.id === selection.id)}
            aria-pressed={currentSelection === selection.id} onClick={() => selectSemantic(selection.id)}>{selection.label}</button>)}
        </div>
        <div className="context-card"><span>Current selection</span><b data-testid="current-selection">{currentSelectionLabel}</b></div>
        <div className="context-card"><span>Attached context</span><b data-testid="attached-context">{attachedContext ? `${attachedContext.label} · ${attachedContext.revisionId}` : "None"}</b></div>
        <div className="context-actions">
          <button disabled={!currentSelection || !current} onClick={() => {
            const selection = SEMANTIC_SELECTIONS.find((candidate) => candidate.id === currentSelection);
            if (selection && current) setAttachedContext({ ...selection, revisionId: current.id });
          }}>Attach current selection</button>
          <button disabled={!currentSelection || activeFixtureState.commandCategory !== "inspect"} onClick={() => {
            const expectedDocumentId = activeFixtureDocument.id;
            setFixtureWorkspace((workspace) => setFixtureTreeInteraction(workspace, expectedDocumentId, { selectionId: null }));
          }}>Clear current selection</button>
        </div>
        <small className="identity-note">Fixture-local review IDs · admitted artifact scope · not durable topology.</small>
        <h2>Fixture metadata · {activeFixtureDocument.fileName}</h2>
        {Object.entries(activeFixtureDocument.parameters).map(([name, parameterValue]) => <Parameter key={name} label={name} value={parameterValue} />)}
        <small className="identity-note">Static R14 values · not an exact-kernel realization claim.</small>
        <h2>Source parameters</h2><p className="muted">TypeScript authored authority</p>
        <label>Leg length (mm)<input aria-label="Leg length (mm)" type="number" min="40" max="160" value={value} onChange={(e) => setValue(Number(e.target.value))} /></label>
        <div className="zone selected"><b>Selected zone</b><span>Vertical leg height</span><small>Bounded 40–160 mm</small></div>
        <Parameter label="Leg width" value={current.parameters.leg_width_mm} />
        <Parameter label="Base length" value={current.parameters.base_length_mm} />
        <Parameter label="Base thickness" value={current.parameters.base_thickness_mm} />
        <Parameter label="Leg thickness" value={current.parameters.leg_thickness_mm} />
        <Parameter label="Hole diameter" value={current.parameters.hole_diameter_mm} />
        <h2>Portable custody</h2>
        <p className="muted">Export a self-contained <code>.piton-custody.json</code> file, or open a fresh isolated import namespace. No network calls.</p>
        <div className="context-actions">
          <button data-testid="portable-custody-export" disabled={portableBusy} onClick={() => void exportPortableCustody()}>Export portable custody</button>
          <button data-testid="portable-custody-start-import" disabled={portableBusy} onClick={() => window.location.assign("?mode=import")}>Import into fresh custody…</button>
        </div>
        {portableError ? <p className="portable-error" data-testid="portable-custody-error" role="alert">Portable custody error: {portableError}</p> : null}
        <small className="identity-note">Portable custody is a closed browser-typescript/v1 derivative. It does not carry Manifold review meshes, exact B-rep, approval, release, fabrication, or machine actuation authority.</small>
      </aside>
      <section className="canvas">{fixtureKind === "assembly" ? <AssemblyViewport
        disabled={geometryDisabled}
        selectedEntityId={currentSelection}
        selectionMode={selectionMode}
        onSelect={(id) => {
          const expectedDocumentId = activeFixtureDocument.id;
          if (activeFixtureState.commandCategory !== "inspect") return;
          setFixtureWorkspace((workspace) => setFixtureViewportSelection(workspace, expectedDocumentId, id));
        }}
        onOpenSource={(id) => openSelectedPart(id, true)}
      /> : <Viewport
        parameters={(previewParameters ?? current.parameters) as DesignRevision["parameters"]}
        authoritativeBase={current}
        disabled={geometryDisabled}
        semanticSelection={isSemanticSelectionId(currentSelection) ? currentSelection : null}
        onGeometryAdmitted={(bounds) => setRenderedBounds(bounds)}
        onBuildStatus={(status) => {
          const durable = { ...status, projectId: project.id };
          void application.recordBuildStatus(durable).then(setDurableBuildStatus).catch((error: unknown) => {
            setMessage(`Preview status persistence failed: ${error instanceof Error ? error.message : "unknown error"}`);
          });
        }}
      />}
        <div className="bbox">{!previewParameters
          ? "BBOX awaiting admitted review geometry"
          : fixtureKind === "assembly"
          ? <>BBOX <b>static Assembly scene · CAD Z min 0 mm</b></>
          : renderedBounds
          ? <>BBOX <b>{renderedBounds.size.map(formatMillimetres).join(" × ")} mm</b></>
          : "BBOX awaiting admitted review geometry"}</div>
        <div className="measurement-panel">
          <button disabled={admittedMeasurement == null} onClick={measureSelection}>Measure selected review entity</button>
          <output data-testid="review-measurement">{measurementMm === null
            ? "Review-mesh distance · select an entity"
            : `Approx. review-mesh distance ${formatMillimetres(measurementMm)} mm · review-only, not exact B-rep`}</output>
        </div>
      </section>
      <aside id="revision-custody" aria-label="Revision custody" tabIndex={-1} className={`panel revision${openResponsivePanel === "custody" ? " open" : ""}`}>
        <button className="panel-close" aria-label="Close revision custody panel" onClick={() => setOpenResponsivePanel(null)}>×</button>
        <h2>Revision custody</h2><div className="state-card"><span>Accepted immutable revision</span><code>{accepted.id}</code><small>Retained unchanged</small></div>
        <div className="state-card"><span>Current revision</span><code>{current.id}</code></div>
        {changed && previewParameters ? <div className="diff"><b>Parameter diff</b><span>{current.parameters.leg_length_mm} mm → {value} mm</span><strong>Preview only · not committed</strong></div> : <p className="muted">Change the selected parameter to create a preview.</p>}
        <button className="commit" disabled={!changed} onClick={() => void commit()}>Commit candidate</button>
        <small className="identity-note">Canonical authored records only · not DraftExport, geometry export, approval, or release.</small>
        <p className="status-message">{message}</p>
        {durableBuildStatus ? <div className="state-card durable-status">
          <span>Durable preview status · {durableGeometryStatusLabel(durableBuildStatus.binding, current.id)}</span>
          <b>{durableBuildStatus.state}</b><small>{durableBuildStatus.message}</small>
        </div> : <p className="muted">No durable preview status recovered.</p>}
        <div className="state-card validation-issues"><span>Validation / issues</span><b>Review checks only</b><small>Exact B-rep checks not run · no fabrication suitability or release claim</small></div>
        <div className="disclosure"><b>Claim scope</b><p>Browser Manifold mesh is review geometry, not exact B-rep or topology authority. Commit does not approve, export, release, or actuate.</p></div>
      </aside>
    </div>
    <footer className="truth-strip" role="contentinfo" aria-label="Persistent safety truth">
      <Truth label="review_state" value={current.reviewState} />
      <Truth label="fabrication_release" value={String(current.fabricationRelease)} testId="fabrication-release" />
      <Truth label="machine_actuation" value={String(current.machineActuation)} testId="machine-actuation" />
      <Truth label="release_state" value={current.releaseState} />
    </footer>
  </main>;
}

function visibleFixtureTreeNodes(nodes: readonly FixtureTreeNode[], expandedIds: ReadonlySet<string>): FixtureTreeNode[] {
  return nodes.flatMap((node) => [node, ...(expandedIds.has(node.id) ? visibleFixtureTreeNodes(node.children, expandedIds) : [])]);
}

function fixtureTreeParentId(nodes: readonly FixtureTreeNode[], childId: string, parentId: string | null = null): string | null {
  for (const node of nodes) {
    if (node.id === childId) return parentId;
    const nested = fixtureTreeParentId(node.children, childId, node.id);
    if (nested) return nested;
  }
  return null;
}

function treeNodeLabel(node: FixtureTreeNode): string {
  if (node.kind === "occurrence") return `◇ ${node.label}`;
  if (node.kind === "mate") return `⌁ ${node.label}`;
  if (node.kind === "source-reference") return `▣ ${node.label}`;
  if (node.kind === "review-surface") return `▱ ${node.label}`;
  return node.label;
}

function FixtureTree({
  nodes, expandedIds, focusId, selectionId, onToggle, onSelect, onKeyDown, onOpenPart,
}: {
  nodes: readonly FixtureTreeNode[];
  expandedIds: readonly string[];
  focusId: string | null;
  selectionId: string | null;
  onToggle: (id: string, expand?: boolean) => void;
  onSelect: (id: string) => void;
  onKeyDown: (event: KeyboardEvent, id: string) => void;
  onOpenPart: (id: string) => void;
}) {
  const expanded = new Set(expandedIds);
  return <>{nodes.map((node) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.id);
    return <div key={node.id} className="tree-node">
      <div
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={selectionId === node.id}
        tabIndex={focusId === node.id ? 0 : -1}
        data-tree-id={node.id}
        onFocus={() => { /* focus is committed by the roving-key handler */ }}
        onKeyDown={(event) => onKeyDown(event, node.id)}
      >
        {hasChildren ? <button className="tree-twisty" aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.label}`} onClick={() => onToggle(node.id)}>{isExpanded ? "▾" : "▸"}</button> : <span className="tree-spacer" aria-hidden="true">·</span>}
        <button
          tabIndex={-1}
          aria-label={treeNodeLabel(node)}
          aria-pressed={selectionId === node.id}
          onClick={(event) => { if (event.detail <= 1) onSelect(node.id); }}
          onDoubleClick={() => {
            if (selectionId !== node.id) onSelect(node.id);
            onOpenPart(node.id);
          }}
        >{treeNodeLabel(node)}</button>
      </div>
      {hasChildren && isExpanded ? <div role="group"><FixtureTree
        nodes={node.children}
        expandedIds={expandedIds}
        focusId={focusId}
        selectionId={selectionId}
        onToggle={onToggle}
        onSelect={onSelect}
        onKeyDown={onKeyDown}
        onOpenPart={onOpenPart}
      /></div> : null}
    </div>;
  })}</>;
}

const UNAVAILABLE_COMMANDS: Readonly<Record<Exclude<FixtureCommandCategory, "inspect">, readonly string[]>> = {
  features: ["New Sketch", "Extrude", "Revolve", "Hole", "Linear Pattern", "Fillet", "Chamfer"],
  sketch: ["Line", "Rectangle", "Circle", "Dimension"],
  assembly: ["Insert Component", "Move Component", "Fix/Float"],
  mates: ["Distance", "Concentric", "Coincident"],
};

function CommandControls({ category, measurementAvailable, openPartAvailable, measureAvailable, onMeasure, onClearMeasurement, onOpenPart }: {
  category: FixtureCommandCategory;
  measurementAvailable: boolean;
  openPartAvailable: boolean;
  measureAvailable: boolean;
  onMeasure: () => void;
  onClearMeasurement: () => void;
  onOpenPart: () => void;
}) {
  if (category !== "inspect") return <div className="command-controls" aria-label={`${category} commands`}>
    {UNAVAILABLE_COMMANDS[category].map((command) => <button key={command} disabled title="Unavailable in the R14 review fixture">{command}</button>)}
    <small>Displayed for vocabulary review only · unavailable · cannot execute.</small>
  </div>;
  return <div className="command-controls" aria-label="Inspect commands">
    <button disabled={!measureAvailable} onClick={onMeasure}>Measure</button>
    <button disabled={!measurementAvailable} onClick={onClearMeasurement}>Clear Measurement</button>
    <button disabled={!openPartAvailable} onClick={onOpenPart}>Open Part</button>
  </div>;
}

function Truth({ label, value, testId }: { label: string; value: string; testId?: string }) { return <div><span>{label}</span><b data-testid={testId}>{value}</b></div>; }
function Parameter({ label, value }: { label: string; value: number }) { return <div className="parameter"><span>{label}</span><b>{value} mm</b></div>; }
function formatMillimetres(value: number): string { return Number(value.toFixed(3)).toString(); }
