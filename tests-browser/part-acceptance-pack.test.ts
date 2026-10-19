import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Step = { id: string; action: string; inputs: Record<string, unknown> };
type Case = {
  id: string; name: string; user_request: string; setup_case?: string; steps: Step[];
  expected: { units: string; connected_solid_bodies: number; analytic_volume_mm3: number; analytic_volume_formula: string;
    bounds_mm: { min: number[]; max: number[] }; bounds_tolerance_mm: number;
    mesh_volume_tolerance: { relative: number; absolute_mm3: number };
    review_state: string; fabrication_release: boolean; machine_actuation: boolean };
  required_plane_variants?: { plane: string; expected_bounds_mm: number[][] }[];
  fixture_inputs?: Record<string, unknown>;
  cross_sections?: { z_mm: number; opening_diameter_mm: number; outer_diameter_mm: number }[];
};
const root = process.cwd();
const catalog = JSON.parse(readFileSync(".hermes/part-creation-cases.json", "utf8")) as {
  schema_version: number; artifact_kind: string; units: string; required_lanes: string[];
  semantic_actions_not_api_names: string[]; cases: Case[];
};
const byId = new Map(catalog.cases.map(item => [item.id, item]));
function number(input: Record<string, unknown>, field: string): number {
  expect(typeof input[field], field).toBe("number");
  const value = input[field] as number;
  expect(Number.isFinite(value), field).toBe(true);
  return value;
}
function find(item: Case, action: string): Step {
  const result = item.steps.find(step => step.action === action);
  expect(result, `${item.id}: ${action}`).toBeDefined();
  return result!;
}
function expanded(item: Case, visiting = new Set<string>()): Step[] {
  expect(visiting.has(item.id), `setup cycle at ${item.id}`).toBe(false);
  visiting.add(item.id);
  const setup = item.setup_case ? byId.get(item.setup_case) : undefined;
  if (item.setup_case) expect(setup, item.setup_case).toBeDefined();
  const steps = [...(setup ? expanded(setup, visiting) : []), ...item.steps];
  visiting.delete(item.id);
  return steps;
}

describe("Part acceptance specifications — not live application execution", () => {
  it("keeps the required cases, actors, safety boundaries and resolved action chains explicit", () => {
    expect(catalog.schema_version).toBe(1);
    expect(catalog.artifact_kind).toBe("acceptance_specification_not_executor");
    expect(catalog.required_lanes).toEqual(["human_controls", "agent_application_actions"]);
    expect(catalog.units).toBe("mm");
    expect(byId.size).toBe(catalog.cases.length);
    for (const id of Array.from({ length: 12 }, (_, index) => `HP-${String(index + 1).padStart(2, "0")}`)) expect(byId.has(id), id).toBe(true);
    for (const item of catalog.cases) {
      expect(item.user_request.trim().length).toBeGreaterThan(20);
      expect(new Set(item.steps.map(step => step.id)).size).toBe(item.steps.length);
      expect(item.expected).toMatchObject({ units: "mm", connected_solid_bodies: 1, review_state: "needs_human_review", fabrication_release: false, machine_actuation: false });
      expect(item.expected.analytic_volume_mm3).toBeGreaterThan(0);
      expect(item.expected.bounds_tolerance_mm).toBeGreaterThan(0);
      expect(item.expected.mesh_volume_tolerance.relative).toBeGreaterThan(0);
      expect(item.expected.mesh_volume_tolerance.relative).toBeLessThanOrEqual(0.0015);
      for (const side of ["min", "max"] as const) {
        expect(item.expected.bounds_mm[side]).toHaveLength(3);
        expect(item.expected.bounds_mm[side].every(Number.isFinite)).toBe(true);
      }
      const chain = expanded(item);
      expect(chain.filter(step => step.action === "part.create")).toHaveLength(1);
      expect(chain.at(-1)?.action).toBe("part.reopen");
      const aliases = new Set<string>();
      for (const [index, step] of chain.entries()) {
        expect(catalog.semantic_actions_not_api_names, step.action).toContain(step.action);
        for (const field of ["profile", "owner_feature", "target_body", "seed", "feature"]) {
          if (typeof step.inputs[field] === "string") expect(aliases.has(step.inputs[field] as string), `${item.id}/${step.id}: missing ${field}`).toBe(true);
        }
        if (typeof step.inputs.alias === "string") {
          expect(aliases.has(step.inputs.alias), `duplicate alias ${step.inputs.alias}`).toBe(false);
          aliases.add(step.inputs.alias);
        }
        if (step.action === "model.commit") {
          expect(chain[index - 1]).toMatchObject({ action: "model.preview", inputs: { feature: step.inputs.feature } });
        }
        expect(step.action).not.toMatch(/file|storage|source\.write|terminal|import/);
      }
    }
  });

  it("independently checks numeric geometry targets rather than accepting expected values as their own oracle", () => {
    const plate = byId.get("HP-01")!;
    const rectangle = find(plate, "sketch.rectangle").inputs;
    const thickness = number(find(plate, "feature.boss_extrude").inputs, "depth");
    const width = number(rectangle, "width"), height = number(rectangle, "height");
    const baseVolume = width * height * thickness;
    const volumes: Record<string, number> = { "HP-01": baseVolume };
    const spacer = byId.get("HP-02")!;
    const spacerCircles = spacer.steps.filter(step => step.action === "sketch.circle");
    volumes[spacer.id] = Math.PI / 4 * (number(spacerCircles[0].inputs, "diameter") ** 2 - number(spacerCircles[1].inputs, "diameter") ** 2) * number(find(spacer, "feature.boss_extrude").inputs, "depth");
    for (const id of ["HP-03", "HP-04"]) {
      const item = byId.get(id)!;
      const cut = find(item, "feature.cut_extrude").inputs;
      const depth = id === "HP-04" ? thickness : number(cut, "depth");
      if (id === "HP-04") expect(cut).toMatchObject({ end_condition: "through_all", depth: null });
      volumes[id] = baseVolume - Math.PI / 4 * number(find(item, "sketch.circle").inputs, "diameter") ** 2 * depth;
    }
    const boss = byId.get("HP-05")!;
    const bossProfile = find(boss, "sketch.rectangle").inputs;
    const bossVolume = number(bossProfile, "width") * number(bossProfile, "height") * number(find(boss, "feature.boss_extrude").inputs, "depth");
    volumes[boss.id] = baseVolume + bossVolume;
    const edit = byId.get("HP-06")!;
    const changes = find(edit, "feature.edit").inputs.changes as Record<string, unknown>;
    volumes[edit.id] = width * height * number(changes, "depth") + bossVolume;
    const mirrored = byId.get("HP-07")!;
    const vertices = (mirrored as Case & { expected_profile_vertices: number[][] }).expected_profile_vertices;
    const area = Math.abs(vertices.reduce((sum, point, index) => {
      const next = vertices[(index + 1) % vertices.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0)) / 2;
    volumes[mirrored.id] = area * number(find(mirrored, "feature.boss_extrude").inputs, "depth");
    const pvc = byId.get("HP-08")!, p = pvc.fixture_inputs!;
    expect(p).toMatchObject({ length_mm: 60, outer_diameter_mm: 42, socket_diameter_mm: 33.6,
      socket_depth_each_mm: 28.5, center_stop_length_mm: 3, center_opening_diameter_mm: 26.6 });
    const length = number(p, "length_mm"), depth = number(p, "socket_depth_each_mm"), stop = number(p, "center_stop_length_mm");
    expect(2 * depth + stop).toBe(length);
    volumes[pvc.id] = Math.PI / 4 * ((number(p, "outer_diameter_mm") ** 2 - number(p, "socket_diameter_mm") ** 2) * 2 * depth + (number(p, "outer_diameter_mm") ** 2 - number(p, "center_opening_diameter_mm") ** 2) * stop);
    expect(pvc.cross_sections?.map(section => section.opening_diameter_mm)).toEqual([33.6, 26.6, 33.6]);
    const revolved = byId.get("HP-09")!, section = find(revolved, "sketch.rectangle").inputs;
    expect(find(revolved, "plane.select").inputs.plane).toBe("XZ");
    expect(find(revolved, "axis.select").inputs).toMatchObject({ axis_direction: [0, 0, 1], must_lie_in_sketch_plane: true });
    const inner = (section.origin as number[])[0], outer = inner + number(section, "width");
    volumes[revolved.id] = Math.PI * (outer ** 2 - inner ** 2) * number(section, "height");
    const patterned = byId.get("HP-10")!;
    const pattern = find(patterned, "feature.linear_pattern").inputs;
    expect(pattern.total_instances_including_seed).toBe(3);
    volumes[patterned.id] = baseVolume - number(pattern, "total_instances_including_seed") * Math.PI / 4 * number(find(patterned, "feature.hole").inputs, "diameter") ** 2 * thickness;
    const radius = number(find(byId.get("HP-11")!, "feature.fillet").inputs, "radius");
    volumes["HP-11"] = (width * height - (4 - Math.PI) * radius ** 2) * thickness;
    const chamfer = find(byId.get("HP-12")!, "feature.chamfer").inputs;
    volumes["HP-12"] = (width * height - 2 * number(chamfer, "distance_1") * number(chamfer, "distance_2")) * thickness;
    for (const item of catalog.cases) expect(item.expected.analytic_volume_mm3, item.id).toBeCloseTo(volumes[item.id], 8);
    expect(plate.required_plane_variants?.map(variant => variant.plane)).toEqual(["XY", "XZ", "YZ"]);
  });

  it("routes project instructions to complete, versionable contracts and keeps action names synchronized", () => {
    const agents = readFileSync("AGENTS.md", "utf8");
    const files = ["README.md", "part-creation-happy-path-hard-acceptance.md", "solidworks-part-actions.md", "part-creation-cases.json", "part-creation-negative-tests.md", "audit-baseline.md"];
    for (const file of files) {
      expect(existsSync(resolve(root, ".hermes", file)), file).toBe(true);
      if (file !== "README.md" && file !== "audit-baseline.md") expect(agents).toContain(`.hermes/${file}`);
    }
    const actions = readFileSync(".hermes/solidworks-part-actions.md", "utf8");
    for (const action of catalog.semantic_actions_not_api_names) expect(actions, action).toContain(`\`${action}\``);
    for (const file of files.filter(file => file.endsWith(".md"))) {
      const path = resolve(root, ".hermes", file);
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
        if (!/^https?:/.test(match[1])) expect(existsSync(resolve(dirname(path), match[1])), `${file}: ${match[1]}`).toBe(true);
      }
    }
    expect(existsSync("HERMES.md")).toBe(false);
    expect(existsSync(".hermes.md")).toBe(false);
  });
});
