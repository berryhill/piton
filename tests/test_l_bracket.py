"""Tests for the Stage 1 L-bracket reference wedge."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from piton.parts.l_bracket import (
    AUTHORITY_PROFILE,
    DEFAULT_PARAMETERS,
    LBracketParameters,
    SCHEMA_ID,
    build_l_bracket,
    canonical_json_bytes,
    parameter_set_digest,
)


def test_default_parameters_are_frozen():
    assert DEFAULT_PARAMETERS.leg_length_mm == 80.0
    assert DEFAULT_PARAMETERS.hole_count_base == 2
    assert DEFAULT_PARAMETERS.base_thickness_mm == 8.0


def test_default_parameters_pass_validation():
    # Construction itself validates invariants
    p = LBracketParameters(**{k: float(v) for k, v in DEFAULT_PARAMETERS.to_primitive_map().items() if k.startswith(("leg_", "base_", "hole_", "fillet_", "chamfer_"))} | {"hole_count_base": 2, "hole_count_leg": 2})
    assert p is not None


def test_invalid_parameters_rejected():
    with pytest.raises(ValueError):
        LBracketParameters(
            leg_length_mm=0, leg_width_mm=40, base_length_mm=120,
            base_thickness_mm=8, leg_thickness_mm=8, hole_diameter_mm=6.5,
            hole_count_base=2, hole_count_leg=2, hole_edge_offset_mm=12,
            hole_pitch_mm=40, fillet_radius_mm=3, chamfer_mm=1,
        )
    with pytest.raises(ValueError):
        LBracketParameters(
            leg_length_mm=80, leg_width_mm=40, base_length_mm=8,
            base_thickness_mm=8, leg_thickness_mm=8, hole_diameter_mm=6.5,
            hole_count_base=2, hole_count_leg=2, hole_edge_offset_mm=12,
            hole_pitch_mm=40, fillet_radius_mm=3, chamfer_mm=1,
        )


def test_parameter_set_is_canonical():
    canon = canonical_json_bytes(DEFAULT_PARAMETERS.to_primitive_map())
    assert canon == canonical_json_bytes(DEFAULT_PARAMETERS.to_primitive_map())
    digest = parameter_set_digest(DEFAULT_PARAMETERS)
    assert digest.startswith("sha256:")
    assert len(digest) == len("sha256:") + 64


def test_parameter_mutation_changes_digest():
    p1 = DEFAULT_PARAMETERS
    p2 = LBracketParameters(**{**{k: float(v) for k, v in p1.to_primitive_map().items() if k.startswith(("leg_", "base_", "hole_", "fillet_", "chamfer_"))}, "leg_length_mm": 90.0, "hole_count_base": 2, "hole_count_leg": 2})
    assert parameter_set_digest(p1) != parameter_set_digest(p2)


def test_build_l_bracket_geometry_size():
    part = build_l_bracket(DEFAULT_PARAMETERS)
    bb = part.bounding_box()
    sx, sy, sz = bb.max.X - bb.min.X, bb.max.Y - bb.min.Y, bb.max.Z - bb.min.Z
    assert sx == pytest.approx(120.0, abs=0.1)
    assert sy == pytest.approx(88.0, abs=0.1)
    assert sz == pytest.approx(40.0, abs=0.1)


def test_build_l_bracket_has_volume():
    part = build_l_bracket(DEFAULT_PARAMETERS)
    # Solid L volume = leg + base - holes
    #   leg = 8 * 80 * 40 = 25600
    #   base = 120 * 8 * 40 = 38400
    #   holes ~= 4 * pi * 3.25^2 * 10 = ~1327
    #   expected ~ 62673 mm^3
    v = float(part.volume)
    assert v == pytest.approx(62673, rel=0.05), f"volume {v} not within 5% of 62673"
    # Definitely less than the bounding-box prism (422400) and greater than zero
    assert v > 1000
    assert v < 120 * 88 * 40


def test_truth_boundary_invariants():
    from piton.model import TruthBoundary
    tb = TruthBoundary()
    tb.assert_safe()
    assert tb.fabrication_release is False
    assert tb.machine_actuation is False
    assert tb.review_state == "needs_human_review"


def test_authority_profile_in_part():
    assert AUTHORITY_PROFILE == "source-native/v0"
    assert SCHEMA_ID == "piton.part-source.v1"