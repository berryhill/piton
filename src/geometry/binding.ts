import {
  assertRevisionIntegrity,
  sha256Hex,
  type DesignRevision,
  type LBracketParameters,
} from "../domain";

export interface GeometryAuthorityBinding {
  baseRevisionId: string;
  previewDigest: string;
}

const PARAMETER_KEYS = [
  "base_length_mm",
  "base_thickness_mm",
  "hole_diameter_mm",
  "leg_length_mm",
  "leg_thickness_mm",
  "leg_width_mm",
] as const satisfies readonly (keyof LBracketParameters)[];

export function deriveGeometryBinding(
  authoritativeBase: DesignRevision,
  parameters: Readonly<LBracketParameters>,
): GeometryAuthorityBinding {
  assertRevisionIntegrity(authoritativeBase);
  for (const key of PARAMETER_KEYS) {
    if (!Number.isFinite(parameters[key])) throw new Error(`${key} must be finite`);
    if (key !== "leg_length_mm" && parameters[key] !== authoritativeBase.parameters[key]) {
      throw new Error(`preview cannot change authority-owned parameter ${key}`);
    }
  }
  if (parameters.leg_length_mm < 40 || parameters.leg_length_mm > 160) {
    throw new Error("leg_length_mm must be between 40 and 160 mm");
  }
  if (parameters.leg_length_mm === authoritativeBase.parameters.leg_length_mm) {
    return { baseRevisionId: authoritativeBase.id, previewDigest: authoritativeBase.id };
  }
  const command = JSON.stringify({ type: "set-leg-length", value: parameters.leg_length_mm });
  return {
    baseRevisionId: authoritativeBase.id,
    previewDigest: `preview-${sha256Hex(command)}`,
  };
}

export function sameGeometryBinding(
  left: GeometryAuthorityBinding,
  right: GeometryAuthorityBinding,
): boolean {
  return left.baseRevisionId === right.baseRevisionId && left.previewDigest === right.previewDigest;
}

export type DurableGeometryStatusLabel = "committed-current" | "uncommitted preview" | "stale disclosure only";

export function durableGeometryStatusLabel(
  binding: GeometryAuthorityBinding,
  currentRevisionId: string,
): DurableGeometryStatusLabel {
  if (binding.baseRevisionId !== currentRevisionId) return "stale disclosure only";
  if (binding.previewDigest === currentRevisionId) return "committed-current";
  if (/^preview-[0-9a-f]{64}$/.test(binding.previewDigest)) return "uncommitted preview";
  return "stale disclosure only";
}