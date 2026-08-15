import { describe, expect, it } from "vitest";
import { fitCameraToBounds, meshBounds, selectedLegZone, rolledCameraUp } from "../browser-src/geometry/view";
import { DEFAULT_PARAMETERS } from "../browser-src/domain";

describe("review viewport interaction geometry", () => {
  it("maps the selected leg-length parameter to the real vertical-leg zone", () => {
    expect(selectedLegZone(DEFAULT_PARAMETERS)).toEqual({
      center: [4, 20, 48],
      size: [8, 40, 80],
    });
  });

  it("rolls around the camera sight line instead of the CAD Z axis", () => {
    const up = rolledCameraUp(
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      Math.PI / 2,
    );
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-1);
    expect(up.z).toBeCloseTo(0);
  });

  it.each([0.45, 2])("contains every bbox corner inside the padded perspective frustum at aspect %s", (aspect) => {
    const bounds = meshBounds([0, 0, 0, 120, 0, 0, 0, 40, 0, 0, 0, 88]);
    expect(bounds).toEqual({ min: [0, 0, 0], max: [120, 40, 88], size: [120, 40, 88], center: [60, 20, 44] });
    const direction = { x: 1, y: -1, z: 0.75 };
    const padding = 1.2;
    const fit = fitCameraToBounds(bounds, 45, aspect, direction, padding);
    expect(fit.target).toEqual([60, 20, 44]);
    expect(fit.near).toBeGreaterThan(0);
    expect(fit.far).toBeGreaterThan(fit.distance);

    const z = normalize([direction.x, direction.y, direction.z]);
    const x = normalize([-z[1], z[0], 0]);
    const y = cross(z, x);
    const tanVertical = Math.tan(45 * Math.PI / 360);
    for (const corner of boundsCorners(bounds.min, bounds.max)) {
      const offset = subtract(corner, fit.target);
      const depth = fit.distance - dot(offset, z);
      expect(depth).toBeGreaterThan(fit.near);
      expect(depth).toBeLessThan(fit.far);
      expect(Math.abs(dot(offset, x)) / (depth * tanVertical * aspect)).toBeLessThanOrEqual(1 / padding + 1e-12);
      expect(Math.abs(dot(offset, y)) / (depth * tanVertical)).toBeLessThanOrEqual(1 / padding + 1e-12);
    }
  });

  it("uses direct XYZ with Z as up and the build grid in XY", () => {
    const bounds = meshBounds([2, 3, 0, 4, 7, 9, 2, 7, 0]);
    expect(bounds.min[2]).toBe(0);
    expect(bounds.max).toEqual([4, 7, 9]);
  });
});

type Tuple3 = [number, number, number];
function normalize(value: Tuple3): Tuple3 {
  const length = Math.hypot(...value);
  return value.map((component) => component / length) as Tuple3;
}
function subtract(left: Tuple3, right: Tuple3): Tuple3 {
  return left.map((component, index) => component - right[index]) as Tuple3;
}
function dot(left: Tuple3, right: Tuple3): number {
  return left.reduce((sum, component, index) => sum + component * right[index], 0);
}
function cross(left: Tuple3, right: Tuple3): Tuple3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}
function boundsCorners(min: Tuple3, max: Tuple3): Tuple3[] {
  return [min[0], max[0]].flatMap((x) =>
    [min[1], max[1]].flatMap((y) => [min[2], max[2]].map((z) => [x, y, z] as Tuple3)),
  );
}
