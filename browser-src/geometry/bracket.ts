import type { LBracketParameters } from "../domain";

export interface BracketHole {
  diameter: number;
  length: number;
  center: [number, number, number];
}

export function bracketHole(parameters: LBracketParameters): BracketHole {
  const diameter = parameters.hole_diameter_mm;
  if (!Number.isFinite(diameter) || diameter <= 0 || diameter > parameters.leg_thickness_mm - 1) {
    throw new Error("hole_diameter_mm must leave at least 0.5 mm wall in the vertical leg");
  }
  const centerZ = parameters.base_thickness_mm + parameters.leg_length_mm * 0.65;
  const radius = diameter / 2;
  if (centerZ - radius <= parameters.base_thickness_mm || centerZ + radius >= parameters.base_thickness_mm + parameters.leg_length_mm) {
    throw new Error("hole_diameter_mm does not fit within the vertical leg");
  }
  return {
    diameter,
    length: parameters.leg_width_mm + 2,
    center: [parameters.leg_thickness_mm / 2, parameters.leg_width_mm / 2, centerZ],
  };
}
