import { useEffect, useMemo, useState } from "react";
import type { BrowserProject, DesignRevision } from "./domain";
import type { BuildStatus, CadApplication } from "./application";
import Viewport from "./components/Viewport";
import type { MeshBounds } from "./geometry/view";
import { reviewDistanceMm } from "./geometry/view";
import { durableGeometryStatusLabel } from "./geometry/binding";
import "./styles.css";

interface Props { application: CadApplication; geometryDisabled?: boolean; }

type FixtureKind = "part" | "assembly";
type SelectionMode = "smart" | "face" | "component";
export type SemanticSelectionId = "face:top" | "component:l-bracket:1" | "origin" | "plane:top" | "mate:review-only";

const SEMANTIC_SELECTIONS: ReadonlyArray<{ id: SemanticSelectionId; label: string }> = [
  { id: "face:top", label: "Top review face" },
  { id: "component:l-bracket:1", label: "Component / reference" },
  { id: "origin", label: "Origin" },
  { id: "plane:top", label: "Top plane" },
  { id: "mate:review-only", label: "Review mate" },
];

export default function App({ application, geometryDisabled }: Props) {
  const [project, setProject] = useState<BrowserProject | null>(null);
  const [value, setValue] = useState(80);
  const [message, setMessage] = useState("Opening browser-local custody…");
  const [durableBuildStatus, setDurableBuildStatus] = useState<BuildStatus | null>(null);
  const [renderedBounds, setRenderedBounds] = useState<MeshBounds | null>(null);
  const [fixtureKind, setFixtureKind] = useState<FixtureKind>("part");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("smart");
  const [navigationContext, setNavigationContext] = useState("Source-Part · L-bracket Part");
  const [currentSelection, setCurrentSelection] = useState<SemanticSelectionId | null>(null);
  const [attachedContext, setAttachedContext] = useState<{ id: SemanticSelectionId; label: string; revisionId: string } | null>(null);
  const [measurementMm, setMeasurementMm] = useState<number | null>(null);

  useEffect(() => { void (async () => {
    try {
      const opened = await application.open();
      setProject(opened.project); setDurableBuildStatus(opened.buildStatus);
      setValue(opened.project.revisions.find((r) => r.id === opened.project.currentRevisionId)!.parameters.leg_length_mm);
      setMessage(`Reopened from ${opened.persistenceLabel}`);
    } catch (error) { setMessage(`Persistence unavailable: ${error instanceof Error ? error.message : "unknown error"}`); }
  })(); }, [application]);

  const current = project?.revisions.find((revision) => revision.id === project.currentRevisionId) ?? null;
  const accepted = project?.revisions.find((revision) => revision.id === project.acceptedRevisionId) ?? null;
  const previewParameters = useMemo(() => {
    if (!current || value === current.parameters.leg_length_mm) return current?.parameters ?? null;
    if (!Number.isFinite(value) || value < 40 || value > 160) return null;
    return { ...current.parameters, leg_length_mm: value };
  }, [current, value]);
  const changed = Boolean(current && previewParameters && value !== current.parameters.leg_length_mm);
  const currentSelectionLabel = SEMANTIC_SELECTIONS.find((selection) => selection.id === currentSelection)?.label ?? "None";

  function selectSemantic(id: SemanticSelectionId) {
    setCurrentSelection(id);
    setMeasurementMm(null);
  }

  function measureSelection() {
    if (!previewParameters || !currentSelection) return;
    const height = previewParameters.base_thickness_mm + previewParameters.leg_length_mm;
    const endpointBySelection: Record<SemanticSelectionId, [number, number, number]> = {
      "face:top": [0, 0, previewParameters.leg_length_mm],
      "component:l-bracket:1": [previewParameters.base_length_mm, previewParameters.leg_width_mm, height],
      origin: [0, 0, 0],
      "plane:top": [previewParameters.base_length_mm, 0, 0],
      "mate:review-only": [previewParameters.leg_thickness_mm, previewParameters.leg_width_mm, 0],
    };
    setMeasurementMm(reviewDistanceMm([0, 0, 0], endpointBySelection[currentSelection]));
  }

  useEffect(() => {
    if (!previewParameters) setMeasurementMm(null);
  }, [previewParameters]);

  async function commit() {
    if (!project || !changed) return;
    try {
      const authoritative = await application.commitCandidate(project.currentRevisionId, { type: "set-leg-length", value });
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

  if (!project || !current || !accepted) return <main className="loading"><h1>Piton</h1><p>{message}</p></main>;
  return <main>
    <header><div><span className="eyebrow">BROWSER-LOCAL MECHANICAL CAD MVI</span><h1>Piton Workbench</h1></div><div className="truth-badge">REVIEW ONLY · UNRELEASED</div></header>
    <section className="truth-strip" aria-label="Safety truth">
      <Truth label="review_state" value={current.reviewState} />
      <Truth label="fabrication_release" value={String(current.fabricationRelease)} testId="fabrication-release" />
      <Truth label="machine_actuation" value={String(current.machineActuation)} testId="machine-actuation" />
      <Truth label="release_state" value={current.releaseState} />
    </section>
    <div className="workspace">
      <aside className="panel model-panel">
        <h2>Review fixture</h2>
        <div className="segmented" role="group" aria-label="Review fixture kind">
          <button aria-pressed={fixtureKind === "part"} onClick={() => { setFixtureKind("part"); setSelectionMode("smart"); }}>Part fixture</button>
          <button aria-pressed={fixtureKind === "assembly"} onClick={() => setFixtureKind("assembly")}>Assembly fixture</button>
        </div>
        <p className="boundary-note">{fixtureKind === "assembly"
          ? "Assembly fixture is review-only interaction evidence. It cannot author occurrences, mates, transforms, or Assembly revisions."
          : "Part is the active consequential Stage 1 artifact."}</p>
        <h2>Model tree</h2>
        <nav className="model-tree" aria-label="Model tree">
          <button onClick={() => setNavigationContext("Source-Part · L-bracket Part")}>▣ Source-Part · L-bracket Part</button>
          <button onClick={() => setNavigationContext("Displayed occurrence · L-bracket:1")}>◇ Displayed occurrence · L-bracket:1</button>
        </nav>
        <div className="navigation-context" data-testid="navigation-context">Navigation: {navigationContext}</div>
        <h2>Selection</h2>
        <div className="segmented" role="group" aria-label="Selection mode">
          {(["smart", "face", "component"] as const).map((mode) => <button key={mode} disabled={fixtureKind === "part" && mode === "component"} aria-pressed={selectionMode === mode} onClick={() => setSelectionMode(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
        </div>
        <div className="semantic-list" aria-label="Fixture-local semantic review selections">
          {SEMANTIC_SELECTIONS.map((selection) => <button key={selection.id} aria-pressed={currentSelection === selection.id} onClick={() => selectSemantic(selection.id)}>{selection.label}</button>)}
        </div>
        <div className="context-card"><span>Current selection</span><b data-testid="current-selection">{currentSelectionLabel}</b></div>
        <div className="context-card"><span>Attached context</span><b data-testid="attached-context">{attachedContext ? `${attachedContext.label} · ${attachedContext.revisionId}` : "None"}</b></div>
        <div className="context-actions">
          <button disabled={!currentSelection || !current} onClick={() => {
            const selection = SEMANTIC_SELECTIONS.find((candidate) => candidate.id === currentSelection);
            if (selection && current) setAttachedContext({ ...selection, revisionId: current.id });
          }}>Attach current selection</button>
          <button disabled={!currentSelection} onClick={() => { setCurrentSelection(null); setMeasurementMm(null); }}>Clear current selection</button>
        </div>
        <small className="identity-note">Fixture-local review IDs · admitted artifact scope · not durable topology.</small>
        <h2>Source parameters</h2><p className="muted">TypeScript authored authority</p>
        <label>Leg length (mm)<input aria-label="Leg length (mm)" type="number" min="40" max="160" value={value} onChange={(e) => setValue(Number(e.target.value))} /></label>
        <div className="zone selected"><b>Selected zone</b><span>Vertical leg height</span><small>Bounded 40–160 mm</small></div>
        <Parameter label="Leg width" value={current.parameters.leg_width_mm} />
        <Parameter label="Base length" value={current.parameters.base_length_mm} />
        <Parameter label="Base thickness" value={current.parameters.base_thickness_mm} />
        <Parameter label="Leg thickness" value={current.parameters.leg_thickness_mm} />
        <Parameter label="Hole diameter" value={current.parameters.hole_diameter_mm} />
      </aside>
      <section className="canvas"><Viewport
        parameters={(previewParameters ?? current.parameters) as DesignRevision["parameters"]}
        authoritativeBase={current}
        disabled={geometryDisabled}
        semanticSelection={currentSelection}
        onGeometryAdmitted={(bounds) => setRenderedBounds(bounds)}
        onBuildStatus={(status) => {
          const durable = { ...status, projectId: project.id };
          void application.recordBuildStatus(durable).then(setDurableBuildStatus).catch((error: unknown) => {
            setMessage(`Preview status persistence failed: ${error instanceof Error ? error.message : "unknown error"}`);
          });
        }}
      />
        <div className="bbox">{renderedBounds
          ? <>BBOX <b>{renderedBounds.size.map(formatMillimetres).join(" × ")} mm</b></>
          : "BBOX awaiting admitted review geometry"}</div>
        <div className="measurement-panel">
          <button disabled={!currentSelection || !previewParameters} onClick={measureSelection}>Measure selected review entity</button>
          <output data-testid="review-measurement">{measurementMm === null
            ? "Review-mesh distance · select an entity"
            : `Approx. review-mesh distance ${formatMillimetres(measurementMm)} mm · review-only, not exact B-rep`}</output>
        </div>
      </section>
      <aside className="panel revision"><h2>Revision custody</h2><div className="state-card"><span>Accepted immutable revision</span><code>{accepted.id}</code><small>Retained unchanged</small></div>
        <div className="state-card"><span>Current revision</span><code>{current.id}</code></div>
        {changed && previewParameters ? <div className="diff"><b>Parameter diff</b><span>{current.parameters.leg_length_mm} mm → {value} mm</span><strong>Preview only · not committed</strong></div> : <p className="muted">Change the selected parameter to create a preview.</p>}
        <button className="commit" disabled={!changed} onClick={() => void commit()}>Commit candidate</button><p className="status-message">{message}</p>
        {durableBuildStatus ? <div className="state-card durable-status">
          <span>Durable preview status · {durableGeometryStatusLabel(durableBuildStatus.binding, current.id)}</span>
          <b>{durableBuildStatus.state}</b><small>{durableBuildStatus.message}</small>
        </div> : <p className="muted">No durable preview status recovered.</p>}
        <div className="state-card validation-issues"><span>Validation / issues</span><b>Review checks only</b><small>Exact B-rep checks not run · no fabrication suitability or release claim</small></div>
        <div className="disclosure"><b>Claim scope</b><p>Browser Manifold mesh is review geometry, not exact B-rep or topology authority. Commit does not approve, export, release, or actuate.</p></div>
      </aside>
    </div>
  </main>;
}

function Truth({ label, value, testId }: { label: string; value: string; testId?: string }) { return <div><span>{label}</span><b data-testid={testId}>{value}</b></div>; }
function Parameter({ label, value }: { label: string; value: number }) { return <div className="parameter"><span>{label}</span><b>{value} mm</b></div>; }
function formatMillimetres(value: number): string { return Number(value.toFixed(3)).toString(); }