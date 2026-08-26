import type { GeometryAuthorityBinding } from "./binding";
import { sameGeometryBinding } from "./binding";
import { GEOMETRY_ENVIRONMENT_DIGEST } from "./protocol";

export interface GeometryRequestIdentity {
  requestId: number;
  workerGeneration: number;
  sourceRevisionId: string;
  inputDigest: string;
  environmentDigest: string;
  binding: GeometryAuthorityBinding;
}

export interface GeometryResult extends GeometryRequestIdentity {
  vertices: number[];
  triangles: number[];
}

export function installReplacement<T>(
  current: T | null,
  prepare: () => T,
  install: (replacement: T) => void,
  uninstall: (previous: T) => void,
  dispose: (item: T) => void,
): T {
  const replacement = prepare();
  try {
    install(replacement);
  } catch (error) {
    try {
      uninstall(replacement);
    } finally {
      dispose(replacement);
    }
    throw error;
  }
  if (current) {
    uninstall(current);
    dispose(current);
  }
  return replacement;
}

export class GeometryResultGate {
  private currentRequestId = 0;
  private currentIdentity: GeometryRequestIdentity | null = null;
  lastGood: GeometryResult | null = null;
  lastError: string | null = null;

  begin(
    binding: GeometryAuthorityBinding,
    workerGeneration = 1,
    inputDigest = binding.previewDigest,
    environmentDigest = GEOMETRY_ENVIRONMENT_DIGEST,
  ): GeometryRequestIdentity {
    this.currentRequestId += 1;
    this.currentIdentity = {
      requestId: this.currentRequestId,
      workerGeneration,
      sourceRevisionId: binding.baseRevisionId,
      inputDigest,
      environmentDigest,
      binding: { ...binding },
    };
    return { ...this.currentIdentity, binding: { ...binding } };
  }

  isCurrent(identity: GeometryRequestIdentity): boolean {
    const current = this.currentIdentity;
    return current !== null
      && identity.requestId === current.requestId
      && identity.workerGeneration === current.workerGeneration
      && identity.sourceRevisionId === current.sourceRevisionId
      && identity.inputDigest === current.inputDigest
      && identity.environmentDigest === current.environmentDigest
      && sameGeometryBinding(identity.binding, current.binding);
  }

  validate(result: GeometryResult): boolean {
    if (!this.isCurrent(result)) return false;
    if (
      result.vertices.length < 9 ||
      result.vertices.length % 3 !== 0 ||
      result.triangles.length < 3 ||
      result.triangles.length % 3 !== 0 ||
      result.vertices.some((value) => !Number.isFinite(value)) ||
      result.triangles.some((index) => !Number.isInteger(index) || index < 0 || index >= result.vertices.length / 3)
    ) {
      this.lastError = "Review geometry is empty or malformed";
      return false;
    }
    const referencedVertices = new Set(result.triangles);
    if (referencedVertices.size !== result.vertices.length / 3) {
      this.lastError = "Review geometry contains unreferenced vertices";
      return false;
    }
    const zCoordinates = result.vertices.filter((_, index) => index % 3 === 2);
    if (Math.abs(Math.min(...zCoordinates)) > 1e-6) {
      this.lastError = "Review geometry must have CAD Z-min=0";
      return false;
    }
    this.lastError = null;
    return true;
  }

  commit(result: GeometryResult): void {
    if (!this.isCurrent(result)) throw new Error("Cannot commit stale review geometry");
    this.lastGood = result;
    this.lastError = null;
  }

  accept(result: GeometryResult): boolean {
    if (!this.validate(result)) return false;
    this.commit(result);
    return true;
  }
}
