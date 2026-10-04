import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { applyCameraAction, cadToDisplay, displayToCad, rememberCamera, restoreCamera, ViewControls, type CameraFrame, type ViewHost } from "../src/components/ViewControls";
import { meshBounds } from "../src/geometry/view";

const bounds = meshBounds([0, 0, 0, 120, 30, 40]);
function rig(frame: CameraFrame, aspect = 1) {
  const camera = new PerspectiveCamera(40, aspect, 0.1, 3000);
  const target = new Vector3();
  camera.up.copy(cadToDisplay(new Vector3(0, 0, 1), frame));
  camera.position.set(100, 100, 100);
  const controls = { target, update: vi.fn(() => { camera.lookAt(target); return true; }) };
  return { camera, controls };
}
function projectedCorners() {
  return [bounds.min[0], bounds.max[0]].flatMap(x => [bounds.min[1], bounds.max[1]].flatMap(y => [bounds.min[2], bounds.max[2]].map(z => new Vector3(x, y, z))));
}

describe("shared review camera", () => {
  it("retains camera-only state under an exact document/revision key", () => {
    const first = rig("cad-z-up");
    applyCameraAction(first.camera, first.controls, bounds, "cad-z-up", "front");
    applyCameraAction(first.camera, first.controls, bounds, "cad-z-up", "roll");
    rememberCamera("project:part-a:revision-1", first.camera, first.controls.target);
    const restored = rig("cad-z-up");
    expect(restoreCamera("project:part-b:revision-1", restored.camera, restored.controls)).toBe(false);
    expect(restoreCamera("project:part-a:revision-2", restored.camera, restored.controls)).toBe(false);
    expect(restoreCamera("project:part-a:revision-1", restored.camera, restored.controls)).toBe(true);
    expect(restored.camera.position.toArray()).toEqual(first.camera.position.toArray());
    expect(restored.camera.up.toArray()).toEqual(first.camera.up.toArray());
  });
  it.each(["cad-z-up", "feature-display"] as const)("transforms CAD axes and uses a nonparallel Top up in %s", frame => {
    const z = cadToDisplay(new Vector3(0, 0, 1), frame);
    expect(displayToCad(z, frame).toArray()).toEqual([0, 0, 1]);
    const { camera, controls } = rig(frame);
    applyCameraAction(camera, controls, bounds, frame, "top");
    const direction = displayToCad(camera.position.clone().sub(controls.target).normalize(), frame);
    expect(direction.z).toBeCloseTo(1);
    expect(Math.abs(camera.up.clone().dot(camera.position.clone().sub(controls.target).normalize()))).toBeLessThan(0.01);
    expect(displayToCad(controls.target, frame).toArray()).toEqual(bounds.center);
  });

  it.each(["cad-z-up", "feature-display"] as const)("Fit retains orbit and roll, reset restores iso in %s", frame => {
    const { camera, controls } = rig(frame, 0.5);
    applyCameraAction(camera, controls, bounds, frame, "front");
    const front = camera.position.clone().sub(controls.target).normalize();
    applyCameraAction(camera, controls, bounds, frame, "roll");
    const rolledUp = camera.up.clone();
    expect(camera.position.clone().sub(controls.target).normalize().distanceTo(front)).toBeLessThan(1e-10);
    camera.aspect = 0.35;
    camera.updateProjectionMatrix();
    applyCameraAction(camera, controls, bounds, frame, "fit");
    expect(camera.up.distanceTo(rolledUp)).toBeLessThan(1e-10);
    expect(camera.position.clone().sub(controls.target).normalize().distanceTo(front)).toBeLessThan(1e-10);
    camera.updateMatrixWorld();
    for (const corner of projectedCorners()) {
      const display = cadToDisplay(corner, frame).project(camera);
      expect(Math.abs(display.x)).toBeLessThan(1);
      expect(Math.abs(display.y)).toBeLessThan(1);
    }
    applyCameraAction(camera, controls, bounds, frame, "reset");
    expect(camera.up.distanceTo(cadToDisplay(new Vector3(0, 0, 1), frame))).toBeLessThan(1e-10);
  });

  it("disables actions with a visible truthful reason and only invokes host camera API when ready", () => {
    const host = createRef<HTMLDivElement>();
    const { rerender } = render(<><div ref={host} data-revision-id="r1" data-measurement-phase="endpoint-a"/><ViewControls host={host} unavailable="renderer failed" /></>);
    expect(screen.getByRole("status").textContent).toContain("renderer failed");
    expect(screen.getAllByRole("button")).toHaveLength(6);
    for (const button of screen.getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
    const fitView = vi.fn(); const rollView = vi.fn(); const setView = vi.fn(); const resetView = vi.fn();
    Object.assign(host.current as ViewHost, { fitView, rollView, setView, resetView });
    rerender(<><div ref={host} data-revision-id="r1" data-measurement-phase="endpoint-a"/><ViewControls host={host} /></>);
    fireEvent.click(screen.getByRole("button", { name: "Top" }));
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    fireEvent.click(screen.getByRole("button", { name: "Roll 15°" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset / fit" }));
    expect(setView).toHaveBeenCalledWith("top"); expect(fitView).toHaveBeenCalledOnce();
    expect(rollView).toHaveBeenCalledOnce(); expect(resetView).toHaveBeenCalledOnce();
    expect(host.current?.dataset.revisionId).toBe("r1");
    expect(host.current?.dataset.measurementPhase).toBe("endpoint-a");
  });
});
