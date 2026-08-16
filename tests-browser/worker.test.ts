import { describe, expect, it } from "vitest";
import { GeometryResultGate, installReplacement } from "../browser-src/geometry/gate";
import { deriveGeometryBinding, durableGeometryStatusLabel } from "../browser-src/geometry/binding";
import { seedProject } from "../browser-src/domain";
import {
  constructGeometryWorker,
  geometryWorkerGeneration,
  postGeometryWorkerMessage,
  type GeometryWorkerSurface,
} from "../browser-src/geometry/workerClient";
import { bracketHole } from "../browser-src/geometry/bracket";
import {
  GEOMETRY_ENVIRONMENT_DIGEST,
  geometryInputDigest,
  parseGeometryBuildRequest,
  parseGeometryWorkerMessage,
  type GeometryBuildRequest,
  type GeometryWorkerSuccess,
} from "../browser-src/geometry/protocol";

const base = seedProject().revisions[0];
const committedBinding = deriveGeometryBinding(base, base.parameters);
const previewBinding = deriveGeometryBinding(base, { ...base.parameters, leg_length_mm: 90 });

describe("geometry result admission", () => {
  const protocolRequest = (overrides: Partial<GeometryBuildRequest> = {}): GeometryBuildRequest => ({
    type: "build-review-mesh",
    requestId: 1,
    workerGeneration: 1,
    sourceRevisionId: base.id,
    inputDigest: geometryInputDigest(base.parameters),
    environmentDigest: GEOMETRY_ENVIRONMENT_DIGEST,
    binding: committedBinding,
    parameters: { ...base.parameters },
    ...overrides,
  });

  const protocolSuccess = (request = protocolRequest()): GeometryWorkerSuccess => ({
    type: "review-mesh-built",
    requestId: request.requestId,
    workerGeneration: request.workerGeneration,
    sourceRevisionId: request.sourceRevisionId,
    inputDigest: request.inputDigest,
    environmentDigest: request.environmentDigest,
    vertices: [0, 0, 0, 1, 0, 0, 0, 1, 1],
    triangles: [0, 1, 2],
  });

  it("validates a closed request/result protocol and returns typed diagnostics", () => {
    expect(parseGeometryBuildRequest(protocolRequest()).ok).toBe(true);
    expect(parseGeometryWorkerMessage(protocolSuccess()).ok).toBe(true);

    for (const invalid of [
      { ...protocolRequest(), surprise: true },
      { ...protocolRequest(), requestId: 1.5 },
      { ...protocolRequest(), inputDigest: "not-a-digest" },
      { ...protocolRequest(), parameters: { ...base.parameters, leg_length_mm: Number.NaN } },
      { ...protocolRequest(), parameters: { ...base.parameters, leg_length_mm: 999 } },
      { ...protocolRequest(), sourceRevisionId: "rev-" + "0".repeat(64) },
      { ...protocolRequest(), inputDigest: geometryInputDigest({ ...base.parameters, leg_length_mm: 90 }) },
    ]) {
      const parsed = parseGeometryBuildRequest(invalid);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.diagnostic.code).toMatch(/^protocol_/);
    }

    const mixed = { ...protocolSuccess(), diagnostic: { code: "build_failed", message: "nope" } };
    expect(parseGeometryWorkerMessage(mixed).ok).toBe(false);
    expect(parseGeometryWorkerMessage({ ...protocolSuccess(), vertices: [Number.POSITIVE_INFINITY, 0, 0] }).ok).toBe(false);
  });

  it("rejects each independently wrong active request binding before mesh admission", () => {
    const gate = new GeometryResultGate();
    const active = gate.begin(committedBinding, 7, geometryInputDigest(base.parameters), GEOMETRY_ENVIRONMENT_DIGEST);
    const success = { ...protocolSuccess({ ...protocolRequest(), ...active }), binding: committedBinding };
    expect(gate.accept(success)).toBe(true);
    const mismatches = [
      { requestId: active.requestId + 1 },
      { workerGeneration: active.workerGeneration + 1 },
      { sourceRevisionId: "rev-" + "0".repeat(64) },
      { inputDigest: geometryInputDigest({ ...base.parameters, leg_length_mm: 90 }) },
      { environmentDigest: "sha256-" + "0".repeat(64) },
    ];
    for (const mismatch of mismatches) {
      expect(gate.accept({ ...success, ...mismatch })).toBe(false);
      expect(gate.lastGood).toEqual(success);
    }
  });

  it("assigns a new worker generation whenever a worker is reconstructed", () => {
    const fake = (): GeometryWorkerSurface => ({
      postMessage() {}, terminate() {}, onmessage: null, onerror: null, onmessageerror: null,
    });
    const first = constructGeometryWorker(fake, () => {});
    const second = constructGeometryWorker(fake, () => {});
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(geometryWorkerGeneration(second!)).toBeGreaterThan(geometryWorkerGeneration(first!));
  });

  it("surfaces worker construction, runtime, and message decoding failures", () => {
    const failures: string[] = [];
    expect(constructGeometryWorker(() => { throw new Error("constructor blocked"); }, (message) => failures.push(message))).toBeNull();
    const fake: GeometryWorkerSurface = {
      postMessage() {},
      terminate() {},
      onmessage: null,
      onerror: null,
      onmessageerror: null,
    };
    expect(constructGeometryWorker(() => fake, (message: string) => failures.push(message))).toBe(fake);
    const runtimeFailure = fake.onerror as ((event: ErrorEvent) => void) | null;
    const decodeFailure = fake.onmessageerror as ((event: MessageEvent) => void) | null;
    runtimeFailure?.({ message: "wasm crashed", preventDefault() {} } as ErrorEvent);
    decodeFailure?.({} as MessageEvent);
    expect(failures).toEqual([
      "Geometry worker bootstrap failed: constructor blocked",
      "Geometry worker runtime failed: wasm crashed",
      "Geometry worker message decoding failed",
    ]);
  });

  it("catches synchronous worker postMessage failures for durable failure reporting", () => {
    const failures: string[] = [];
    const fake: GeometryWorkerSurface = {
      postMessage() { throw new Error("clone rejected"); },
      terminate() {},
      onmessage: null,
      onerror: null,
      onmessageerror: null,
    };
    expect(postGeometryWorkerMessage(fake, { requestId: 1 }, (message) => failures.push(message))).toBe(false);
    expect(failures).toEqual(["Geometry worker postMessage failed: clone rejected"]);
  });

  it("bounds and locates the claimed through-hole inside the vertical leg", () => {
    expect(bracketHole(base.parameters)).toEqual({ diameter: 6.5, length: 42, center: [4, 20, 60] });
  });
  it("rejects stale worker results and preserves last-good geometry", () => {
    const gate = new GeometryResultGate();
    const oldRequest = gate.begin(committedBinding);
    const currentRequest = gate.begin(previewBinding);
    const current = {
      ...currentRequest,
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 1],
      triangles: [0, 1, 2],
    };
    expect(gate.accept(current)).toBe(true);
    expect(gate.accept({ ...current, ...oldRequest, vertices: [9, 0, 0] })).toBe(false);
    expect(gate.lastGood?.vertices).toEqual(current.vertices);
  });

  it("identifies current failed requests without advancing the gate", () => {
    const gate = new GeometryResultGate();
    const request = gate.begin(committedBinding);
    expect(gate.isCurrent(request)).toBe(true);
    expect(gate.isCurrent({ ...request, requestId: request.requestId - 1 })).toBe(false);
  });

  it("rejects a stale result with the same remount-reused request id but wrong authority binding", () => {
    const gate = new GeometryResultGate();
    const currentRequest = gate.begin(previewBinding);
    const current = {
      ...currentRequest,
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 1],
      triangles: [0, 1, 2],
    };
    expect(gate.accept(current)).toBe(true);

    expect(gate.accept({
      ...current,
      requestId: currentRequest.requestId,
      binding: committedBinding,
      vertices: [9, 0, 0],
    })).toBe(false);
    expect(gate.accept({
      ...current,
      requestId: currentRequest.requestId,
      binding: { ...previewBinding, baseRevisionId: "rev-wrong-authority" },
      vertices: [8, 0, 0],
    })).toBe(false);
    expect(gate.lastGood).toEqual(current);
  });

  it("derives deterministic bindings from authoritative revision plus bounded preview parameters", () => {
    expect(committedBinding).toEqual({ baseRevisionId: base.id, previewDigest: base.id });
    expect(deriveGeometryBinding(base, { ...base.parameters, leg_length_mm: 90 })).toEqual(previewBinding);
    expect(previewBinding.previewDigest).toMatch(/^preview-[0-9a-f]{64}$/);
    expect(() => deriveGeometryBinding(base, { ...base.parameters, leg_length_mm: 999 })).toThrow(
      "leg_length_mm must be between 40 and 160 mm",
    );
  });

  it("rejects malformed or off-plane geometry without replacing last-good", () => {
    const gate = new GeometryResultGate();
    const firstRequest = gate.begin(committedBinding);
    const lastGood = {
      ...firstRequest,
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 1],
      triangles: [0, 1, 2],
    };
    expect(gate.accept(lastGood)).toBe(true);

    const offPlaneRequest = gate.begin(previewBinding);
    expect(gate.accept({
      ...offPlaneRequest,
      vertices: [0, 0, 2, 1, 0, 2, 0, 1, 3],
      triangles: [0, 1, 2],
    })).toBe(false);
    expect(gate.lastError).toBe("Review geometry must have CAD Z-min=0");
    expect(gate.lastGood).toEqual(lastGood);

    const malformedRequest = gate.begin(committedBinding);
    expect(gate.accept({ ...malformedRequest, vertices: [], triangles: [] })).toBe(false);
    expect(gate.lastError).toBe("Review geometry is empty or malformed");
    expect(gate.lastGood).toEqual(lastGood);
  });

  it("rejects an unreferenced outlier so admitted bbox truth cannot exceed indexed geometry", () => {
    const gate = new GeometryResultGate();
    const request = gate.begin(committedBinding);
    expect(gate.validate({
      ...request,
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 1, 1000, 1000, 1000],
      triangles: [0, 1, 2],
    })).toBe(false);
    expect(gate.lastError).toBe("Review geometry contains unreferenced vertices");
    expect(gate.lastGood).toBeNull();
  });

  it("installs last-good replacements transactionally and commits only after installation", () => {
    const gate = new GeometryResultGate();
    const firstRequest = gate.begin(committedBinding);
    const first = { ...firstRequest, vertices: [0, 0, 0, 1, 0, 0, 0, 1, 1], triangles: [0, 1, 2] };
    expect(gate.validate(first)).toBe(true);
    gate.commit(first);

    const replacementRequest = gate.begin(previewBinding);
    const replacement = { ...replacementRequest, vertices: [0, 0, 0, 2, 0, 0, 0, 2, 2], triangles: [0, 1, 2] };
    expect(gate.validate(replacement)).toBe(true);
    const installed = { id: "old" };
    const scene = [installed];
    const disposed: string[] = [];
    expect(() => installReplacement(installed, () => ({ id: "new" }), (candidate) => {
      scene.push(candidate);
      throw new Error("scene rejected replacement");
    }, (item) => {
      const index = scene.indexOf(item);
      if (index >= 0) scene.splice(index, 1);
    }, (item) => disposed.push(item.id))).toThrow("scene rejected replacement");
    expect(gate.lastGood).toBe(first);
    expect(scene).toEqual([installed]);
    expect(disposed).toEqual(["new"]);
  });

  it("labels durable geometry status only when both authority identifiers match current", () => {
    expect(durableGeometryStatusLabel({ baseRevisionId: base.id, previewDigest: base.id }, base.id)).toBe("committed-current");
    expect(durableGeometryStatusLabel(previewBinding, base.id)).toBe("uncommitted preview");
    expect(durableGeometryStatusLabel({ baseRevisionId: "stale", previewDigest: base.id }, base.id)).toBe("stale disclosure only");
    expect(durableGeometryStatusLabel({ baseRevisionId: base.id, previewDigest: "other-revision" }, base.id)).toBe("stale disclosure only");
  });
});