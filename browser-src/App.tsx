import { useEffect, useMemo, useState } from "react";
import type { BrowserProject, DesignRevision } from "./domain";
import type { BuildStatus, CadApplication } from "./application";
import Viewport from "./components/Viewport";
import type { MeshBounds } from "./geometry/view";
import { durableGeometryStatusLabel } from "./geometry/binding";
import "./styles.css";

interface Props { application: CadApplication; geometryDisabled?: boolean; }

export default function App({ application, geometryDisabled }: Props) {
  const [project, setProject] = useState<BrowserProject | null>(null);
  const [value, setValue] = useState(80);
  const [message, setMessage] = useState("Opening browser-local custody…");
  const [durableBuildStatus, setDurableBuildStatus] = useState<BuildStatus | null>(null);
  const [renderedBounds, setRenderedBounds] = useState<MeshBounds | null>(null);

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
      <aside className="panel"><h2>Source parameters</h2><p className="muted">TypeScript authored authority</p>
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
      </section>
      <aside className="panel revision"><h2>Revision custody</h2><div className="state-card"><span>Accepted immutable revision</span><code>{accepted.id}</code><small>Retained unchanged</small></div>
        <div className="state-card"><span>Current revision</span><code>{current.id}</code></div>
        {changed && previewParameters ? <div className="diff"><b>Parameter diff</b><span>{current.parameters.leg_length_mm} mm → {value} mm</span><strong>Preview only · not committed</strong></div> : <p className="muted">Change the selected parameter to create a preview.</p>}
        <button className="commit" disabled={!changed} onClick={() => void commit()}>Commit candidate</button><p className="status-message">{message}</p>
        {durableBuildStatus ? <div className="state-card durable-status">
          <span>Durable preview status · {durableGeometryStatusLabel(durableBuildStatus.binding, current.id)}</span>
          <b>{durableBuildStatus.state}</b><small>{durableBuildStatus.message}</small>
        </div> : <p className="muted">No durable preview status recovered.</p>}
        <div className="disclosure"><b>Claim scope</b><p>Browser Manifold mesh is review geometry, not exact B-rep or topology authority. Commit does not approve, export, release, or actuate.</p></div>
      </aside>
    </div>
  </main>;
}

function Truth({ label, value, testId }: { label: string; value: string; testId?: string }) { return <div><span>{label}</span><b data-testid={testId}>{value}</b></div>; }
function Parameter({ label, value }: { label: string; value: number }) { return <div className="parameter"><span>{label}</span><b>{value} mm</b></div>; }
function formatMillimetres(value: number): string { return Number(value.toFixed(3)).toString(); }