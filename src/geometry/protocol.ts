import { sha256Hex, validateLBracketParameters, type LBracketParameters } from "../domain";
import type { GeometryAuthorityBinding } from "./binding";

const REVISION_DIGEST = /^rev-[0-9a-f]{64}$/;
const SHA256_DIGEST = /^sha256-[0-9a-f]{64}$/;
const PARAMETER_KEYS = [
  "base_length_mm",
  "base_thickness_mm",
  "hole_diameter_mm",
  "leg_length_mm",
  "leg_thickness_mm",
  "leg_width_mm",
] as const satisfies readonly (keyof LBracketParameters)[];

export const GEOMETRY_ENVIRONMENT_DIGEST = `sha256-${sha256Hex(JSON.stringify({
  protocol: "piton-review-mesh/v1",
  kernel: "manifold-3d@3.3.2",
  segments: 32,
}))}`;

export interface GeometryProtocolIdentity {
  requestId: number;
  workerGeneration: number;
  sourceRevisionId: string;
  inputDigest: string;
  environmentDigest: string;
}

export interface GeometryBuildRequest extends GeometryProtocolIdentity {
  type: "build-review-mesh";
  binding: GeometryAuthorityBinding;
  parameters: LBracketParameters;
}

export interface GeometryWorkerSuccess extends GeometryProtocolIdentity {
  type: "review-mesh-built";
  vertices: number[];
  triangles: number[];
}

export type GeometryDiagnosticCode =
  | "protocol_invalid_envelope"
  | "protocol_invalid_identity"
  | "protocol_invalid_parameters"
  | "protocol_authority_mismatch"
  | "protocol_input_digest_mismatch"
  | "protocol_environment_mismatch"
  | "build_failed";

export interface GeometryDiagnostic {
  code: GeometryDiagnosticCode;
  message: string;
}

export interface GeometryWorkerError extends GeometryProtocolIdentity {
  type: "review-mesh-failed";
  diagnostic: GeometryDiagnostic;
}

export interface GeometryProtocolError {
  type: "protocol-error";
  diagnostic: GeometryDiagnostic;
}

export type GeometryWorkerMessage = GeometryWorkerSuccess | GeometryWorkerError | GeometryProtocolError;
export type ProtocolParse<T> = { ok: true; value: T } | { ok: false; diagnostic: GeometryDiagnostic };

function failure(code: GeometryDiagnosticCode, message: string): ProtocolParse<never> {
  return { ok: false, diagnostic: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validIdentity(value: Record<string, unknown>): value is Record<keyof GeometryProtocolIdentity, unknown> {
  return Number.isSafeInteger(value.requestId) && (value.requestId as number) > 0
    && Number.isSafeInteger(value.workerGeneration) && (value.workerGeneration as number) > 0
    && typeof value.sourceRevisionId === "string" && REVISION_DIGEST.test(value.sourceRevisionId)
    && typeof value.inputDigest === "string" && SHA256_DIGEST.test(value.inputDigest)
    && typeof value.environmentDigest === "string" && SHA256_DIGEST.test(value.environmentDigest);
}

function parseParameters(value: unknown): ProtocolParse<LBracketParameters> {
  if (!isRecord(value) || !hasExactKeys(value, PARAMETER_KEYS)) {
    return failure("protocol_invalid_parameters", "parameters must contain exactly the declared L-bracket inputs");
  }
  const parameterError = validateLBracketParameters(value);
  if (parameterError) return failure("protocol_invalid_parameters", parameterError);
  return { ok: true, value: Object.fromEntries(PARAMETER_KEYS.map((key) => [key, value[key]])) as unknown as LBracketParameters };
}

export function geometryInputDigest(parameters: Readonly<LBracketParameters>): string {
  const canonical = PARAMETER_KEYS.map((key) => [key, parameters[key]]);
  return `sha256-${sha256Hex(JSON.stringify(canonical))}`;
}

export function parseGeometryBuildRequest(value: unknown): ProtocolParse<GeometryBuildRequest> {
  const keys = ["type", "requestId", "workerGeneration", "sourceRevisionId", "inputDigest", "environmentDigest", "binding", "parameters"];
  if (!isRecord(value) || !hasExactKeys(value, keys) || value.type !== "build-review-mesh") {
    return failure("protocol_invalid_envelope", "worker request is not a closed build-review-mesh envelope");
  }
  if (!validIdentity(value)) return failure("protocol_invalid_identity", "worker request identity is invalid");
  if (value.environmentDigest !== GEOMETRY_ENVIRONMENT_DIGEST) {
    return failure("protocol_environment_mismatch", "worker request environment digest is not supported");
  }
  const binding = value.binding;
  if (!isRecord(binding) || !hasExactKeys(binding, ["baseRevisionId", "previewDigest"])
    || typeof binding.baseRevisionId !== "string" || typeof binding.previewDigest !== "string"
    || binding.baseRevisionId !== value.sourceRevisionId) {
    return failure("protocol_authority_mismatch", "worker request does not match its source revision authority");
  }
  const parameters = parseParameters(value.parameters);
  if (!parameters.ok) return parameters;
  const expectedPreviewDigest = `preview-${sha256Hex(JSON.stringify({
    type: "set-leg-length",
    value: parameters.value.leg_length_mm,
  }))}`;
  if (binding.previewDigest !== value.sourceRevisionId && binding.previewDigest !== expectedPreviewDigest) {
    return failure("protocol_authority_mismatch", "worker request preview binding is not derived from its bounded command");
  }
  if (geometryInputDigest(parameters.value) !== value.inputDigest) {
    return failure("protocol_input_digest_mismatch", "worker request parameters do not match inputDigest");
  }
  return { ok: true, value: value as unknown as GeometryBuildRequest };
}

function validDiagnostic(value: unknown): value is GeometryDiagnostic {
  if (!isRecord(value) || !hasExactKeys(value, ["code", "message"]) || typeof value.code !== "string" || typeof value.message !== "string") return false;
  return [
    "protocol_invalid_envelope", "protocol_invalid_identity", "protocol_invalid_parameters",
    "protocol_authority_mismatch", "protocol_input_digest_mismatch", "protocol_environment_mismatch", "build_failed",
  ].includes(value.code);
}

export function parseGeometryWorkerMessage(value: unknown): ProtocolParse<GeometryWorkerMessage> {
  if (!isRecord(value) || typeof value.type !== "string") {
    return failure("protocol_invalid_envelope", "worker result is not an object envelope");
  }
  if (value.type === "protocol-error") {
    if (!hasExactKeys(value, ["type", "diagnostic"]) || !validDiagnostic(value.diagnostic)
      || !value.diagnostic.code.startsWith("protocol_")) {
      return failure("protocol_invalid_envelope", "worker protocol diagnostic is malformed");
    }
    return { ok: true, value: value as unknown as GeometryProtocolError };
  }
  const identityKeys = ["requestId", "workerGeneration", "sourceRevisionId", "inputDigest", "environmentDigest"];
  if (!validIdentity(value)) return failure("protocol_invalid_identity", "worker result identity is invalid");
  if (value.environmentDigest !== GEOMETRY_ENVIRONMENT_DIGEST) {
    return failure("protocol_environment_mismatch", "worker result environment digest is not supported");
  }
  if (value.type === "review-mesh-failed") {
    if (!hasExactKeys(value, ["type", ...identityKeys, "diagnostic"]) || !validDiagnostic(value.diagnostic)
      || value.diagnostic.code !== "build_failed") {
      return failure("protocol_invalid_envelope", "worker error result is malformed");
    }
    return { ok: true, value: value as unknown as GeometryWorkerError };
  }
  if (value.type === "review-mesh-built") {
    if (!hasExactKeys(value, ["type", ...identityKeys, "vertices", "triangles"])
      || !Array.isArray(value.vertices) || !Array.isArray(value.triangles)
      || value.vertices.some((item) => typeof item !== "number" || !Number.isFinite(item))
      || value.triangles.some((item) => typeof item !== "number" || !Number.isSafeInteger(item))) {
      return failure("protocol_invalid_envelope", "worker success result is malformed");
    }
    return { ok: true, value: value as unknown as GeometryWorkerSuccess };
  }
  return failure("protocol_invalid_envelope", "worker result type is unknown");
}
