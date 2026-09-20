import { MODELING_ENVIRONMENT_DIGEST, measureMesh, type FeatureEvaluation } from "./evaluator";
import { featureSourceDigest, ModelingError, type FeatureSource } from "./source";

export type FeatureEvaluator = (source: FeatureSource) => Promise<FeatureEvaluation>;
/** One attempt per disposable worker, bounded wall time, no shared worker state.
 * Termination is cancellation of a preview, never rollback of a committed state. */
export const evaluateFeatureSourceInWorker: FeatureEvaluator = source => {
  const digest = featureSourceDigest(source);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./modeling.worker.ts", import.meta.url), { type: "module" });
    const finish = () => { clearTimeout(timeout); worker.terminate(); };
    const timeout = setTimeout(() => { finish(); reject(new ModelingError("geometry_failed", "Feature evaluation exceeded 15 seconds")); }, 15_000);
    worker.onerror = () => { finish(); reject(new ModelingError("geometry_failed", "Feature worker failed")); };
    worker.onmessage = event => {
      finish();
      try {
        if (!event.data?.ok) throw new ModelingError("geometry_failed", typeof event.data?.error === "string" ? event.data.error : "Invalid feature worker response");
        const result = event.data.result as FeatureEvaluation;
        assertFeatureEvaluation(source, result);
        if (result.sourceDigest !== digest) throw new ModelingError("geometry_failed", "Feature source changed while evaluating");
        resolve(result);
      } catch (error) { reject(error); }
    };
    worker.postMessage(source);
  });
};
/** Verify the returned binding and actual mesh before admitting preview. */
export function assertFeatureEvaluation(source: FeatureSource, result: FeatureEvaluation): void {
  if (!result || result.sourceDigest !== featureSourceDigest(source) || result.environmentDigest !== MODELING_ENVIRONMENT_DIGEST
    || result.claimScope !== "review-mesh-only" || result.units !== "mm" || result.fabricationRelease !== false || result.machineActuation !== false
    || result.reviewState !== "needs_human_review" || result.releaseState !== "unreleased" || !Array.isArray(result.checks) || result.checks.length !== 8
    || result.checks.some(c => !c.passed || !Number.isFinite(c.actual) || !Number.isFinite(c.expected) || !Number.isFinite(c.tolerance) || c.tolerance < 0 || Math.abs(c.actual - c.expected) > c.tolerance)
    || !Array.isArray(result.vertices) || result.vertices.length > 2_000_000 || !Array.isArray(result.triangles) || result.triangles.length > 4_000_000) throw new ModelingError("geometry_failed", "Invalid feature preview binding or checks");
  const measured = measureMesh(result.vertices, result.triangles);
  if (Math.abs(measured.volumeMm3 - result.volumeMm3) > Math.max(1e-6, measured.volumeMm3 * 1e-8)
    || JSON.stringify(measured.bounds) !== JSON.stringify(result.bounds)) throw new ModelingError("geometry_failed", "Feature preview measurements do not match mesh");
}
