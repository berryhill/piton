"""Piton Stage 1 — first consequential source-native Part.

L-bracket, parametric, build123d-native. Wedge class = "bracket"
(frozen in the Stage 0 charter).

This source-native Python Part is the optional external exact-CAD/reference
adapter for the browser-authored Stage 1 revision. Its STEP export is derived
evidence under a pinned realization, never a parallel writable copy. No
fabrication claims. No machine actuation.
"""
from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from build123d import (
    Align,
    Box,
    Cylinder,
    Location,
    Mode,
    Part,
    Rotation,
)


SCHEMA_ID = "piton.part-source.v1"
AUTHORITY_PROFILE="source-native/v0"


# ── Parametric surface ──────────────────────────────────────────────


@dataclass(frozen=True)
class LBracketParameters:
    """Single bounded parameter mutation surface for the L-bracket wedge."""

    leg_length_mm: float
    leg_width_mm: float
    base_length_mm: float
    base_thickness_mm: float
    leg_thickness_mm: float
    hole_diameter_mm: float
    hole_count_base: int
    hole_count_leg: int
    hole_edge_offset_mm: float
    hole_pitch_mm: float
    fillet_radius_mm: float
    chamfer_mm: float

    def __post_init__(self) -> None:
        if self.leg_length_mm <= 0 or self.base_length_mm <= 0:
            raise ValueError("leg_length_mm and base_length_mm must be > 0")
        if self.leg_thickness_mm <= 0 or self.base_thickness_mm <= 0:
            raise ValueError("thicknesses must be > 0")
        if self.leg_width_mm <= 0:
            raise ValueError("leg_width_mm must be > 0")
        if self.hole_diameter_mm <= 0:
            raise ValueError("hole_diameter_mm must be > 0")
        if self.hole_count_base < 0 or self.hole_count_leg < 0:
            raise ValueError("hole counts must be >= 0")
        if self.fillet_radius_mm < 0 or self.chamfer_mm < 0:
            raise ValueError("fillet and chamfer must be >= 0")
        if self.hole_count_base > 1:
            available = self.base_length_mm - 2 * self.hole_edge_offset_mm
            if available <= 0:
                raise ValueError("base_length_mm must exceed 2*hole_edge_offset_mm")

    def to_primitive_map(self) -> dict[str, str]:
        """String-only parameter values for canonical JSON identity."""
        return {
            "leg_length_mm": repr(float(self.leg_length_mm)),
            "leg_width_mm": repr(float(self.leg_width_mm)),
            "base_length_mm": repr(float(self.base_length_mm)),
            "base_thickness_mm": repr(float(self.base_thickness_mm)),
            "leg_thickness_mm": repr(float(self.leg_thickness_mm)),
            "hole_diameter_mm": repr(float(self.hole_diameter_mm)),
            "hole_count_base": repr(int(self.hole_count_base)),
            "hole_count_leg": repr(int(self.hole_count_leg)),
            "hole_edge_offset_mm": repr(float(self.hole_edge_offset_mm)),
            "hole_pitch_mm": repr(float(self.hole_pitch_mm)),
            "fillet_radius_mm": repr(float(self.fillet_radius_mm)),
            "chamfer_mm": repr(float(self.chamfer_mm)),
        }


# ── Default parameter set (Stage 1 reference wedge) ────────────────


DEFAULT_PARAMETERS = LBracketParameters(
    leg_length_mm=80.0,
    leg_width_mm=40.0,
    base_length_mm=120.0,
    base_thickness_mm=8.0,
    leg_thickness_mm=8.0,
    hole_diameter_mm=6.5,        # M6 clearance
    hole_count_base=2,
    hole_count_leg=2,
    hole_edge_offset_mm=12.0,
    hole_pitch_mm=40.0,
    fillet_radius_mm=3.0,
    chamfer_mm=1.0,
)


# ── Builder ──────────────────────────────────────────────────────────


def build_l_bracket(p: LBracketParameters) -> Part:
    """Construct the L-bracket solid under a pinned parameter set.

    Coordinate system: bracket sits in the +X/+Y octant.
        base extends from x=0 to x=base_length_mm
        leg extends from y=base_thickness_mm to y=base_thickness_mm+leg_length_mm
        width (z) extends from z=-leg_width_mm/2 to z=+leg_width_mm/2

    Returns a build123d Part. Geometry is exact, OCCT-backed.
    """
    # Vertical leg (upright plate, sitting on top of base at +Y)
    leg = Box(
        p.leg_thickness_mm,
        p.leg_length_mm,
        p.leg_width_mm,
        align=(Align.MIN, Align.MIN, Align.CENTER),
    )
    leg = Location((p.base_thickness_mm, p.base_thickness_mm, 0)) * leg

    # Horizontal base (lying flat on +X axis)
    base = Box(
        p.base_length_mm,
        p.base_thickness_mm,
        p.leg_width_mm,
        align=(Align.MIN, Align.MIN, Align.CENTER),
    )

    part = leg + base

    # Holes through the base (along Z)
    base_hole_xs = _hole_positions(
        count=p.hole_count_base,
        edge_offset=p.hole_edge_offset_mm,
        total_length=p.base_length_mm,
    )
    holes = []
    for x in base_hole_xs:
        hole = Cylinder(
            radius=p.hole_diameter_mm / 2,
            height=p.base_thickness_mm + 2.0,  # overshoot to ensure clean cut
            align=(Align.CENTER, Align.CENTER, Align.CENTER),
        )
        hole = Location((x, p.base_thickness_mm / 2, 0)) * hole
        holes.append(hole)

    # Holes through the leg (along X, perpendicular to base holes)
    leg_hole_ys = _hole_positions(
        count=p.hole_count_leg,
        edge_offset=p.hole_edge_offset_mm,
        total_length=p.leg_length_mm - p.base_thickness_mm,
        offset_start=p.base_thickness_mm,
    )
    for y in leg_hole_ys:
        hole = Cylinder(
            radius=p.hole_diameter_mm / 2,
            height=p.leg_thickness_mm + 2.0,
            align=(Align.CENTER, Align.CENTER, Align.CENTER),
            rotation=(0, 90, 0),  # axis goes along X
        )
        hole = Location(
            (p.base_thickness_mm + p.leg_thickness_mm / 2, y, 0)
        ) * hole
        holes.append(hole)

    if holes:
        hole_solid = holes[0]
        for h in holes[1:]:
            hole_solid = hole_solid + h
        part = part - hole_solid

    # Edge treatments (best-effort; fillet/chamfer can fail on small geometry)
    if p.fillet_radius_mm > 0:
        try:
            part = part.fillet(p.fillet_radius_mm)
        except Exception:
            pass

    if p.chamfer_mm > 0:
        try:
            part = part.chamfer(p.chamfer_mm, p.chamfer_mm)
        except Exception:
            pass

    return part


def _hole_positions(
    count: int,
    edge_offset: float,
    total_length: float,
    offset_start: float = 0.0,
) -> list[float]:
    """Return absolute positions for evenly spaced holes."""
    if count == 0:
        return []
    if count == 1:
        return [offset_start + total_length / 2]
    available = total_length - 2 * edge_offset
    step = available / (count - 1)
    return [offset_start + edge_offset + i * step for i in range(count)]


# ── Identity helpers ────────────────────────────────────────────────


def canonical_json_bytes(value: Mapping) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def parameter_set_digest(p: LBracketParameters) -> str:
    """sha256 of the canonical parameter set."""
    return "sha256:" + hashlib.sha256(
        canonical_json_bytes(p.to_primitive_map())
    ).hexdigest()


def source_manifest_digest(source_path: Path) -> str:
    """sha256 of this source file's exact bytes."""
    return "sha256:" + hashlib.sha256(source_path.read_bytes()).hexdigest()


# ── CLI surface ─────────────────────────────────────────────────────


def _describe() -> dict:
    return {
        "schema": SCHEMA_ID,
        "authority_profile": AUTHORITY_PROFILE,
        "part_class": "bracket",
        "wedge_class": "bracket",
        "default_parameters": DEFAULT_PARAMETERS.to_primitive_map(),
        "default_parameter_digest": parameter_set_digest(DEFAULT_PARAMETERS),
        "fabrication_release": False,
        "machine_actuation": False,
        "review_state": "needs_human_review",
    }


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--describe":
        print(json.dumps(_describe(), indent=2))
        sys.exit(0)
    if len(sys.argv) > 1 and sys.argv[1] == "--identity":
        params = DEFAULT_PARAMETERS.to_primitive_map()
        print(json.dumps({
            "schema": SCHEMA_ID,
            "authority_profile": AUTHORITY_PROFILE,
            "part_class": "bracket",
            "parameter_set_canonical_json": canonical_json_bytes(params).decode("utf-8"),
            "parameter_set_digest": parameter_set_digest(DEFAULT_PARAMETERS),
        }, indent=2))
        sys.exit(0)
    if len(sys.argv) > 1 and sys.argv[1] == "--build":
        part = build_l_bracket(DEFAULT_PARAMETERS)
        bb = part.bounding_box()
        print(json.dumps({
            "schema": SCHEMA_ID,
            "authority_profile": AUTHORITY_PROFILE,
            "part_class": "bracket",
            "bounding_box_mm": {
                "min": (bb.min.X, bb.min.Y, bb.min.Z),
                "max": (bb.max.X, bb.max.Y, bb.max.Z),
                "size": (bb.max.X - bb.min.X, bb.max.Y - bb.min.Y, bb.max.Z - bb.min.Z),
            },
            "volume_mm3": float(part.volume),
            "area_mm2": float(part.area),
            "parameter_set_digest": parameter_set_digest(DEFAULT_PARAMETERS),
        }, indent=2))
        sys.exit(0)
    print("Use --describe, --identity, or --build to inspect the default part.")
    sys.exit(2)