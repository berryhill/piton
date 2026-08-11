"""Immutable review-packet projection over one successful evidence closure.

The packet and bundled viewer are read-only review aids. They never mutate source,
channels, review dispositions, approvals, exports, release state, or machinery.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import tempfile
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

from jsonschema import Draft202012Validator, ValidationError

from .evidence import EvidenceClosure
from .worker_contracts import PrecisionWorkerResult, canonical_json_bytes

EXPECTED_ROLES = frozenset(
    {
        "exact_brep",
        "step",
        "inspection_receipt",
        "review_glb",
        "review_selection_map",
        "review_glb_receipt",
        "review_selection_map_receipt",
    }
)
_TRUTH = {
    "review_state": "needs_human_review",
    "fabrication_release": False,
    "machine_actuation": False,
    "release_state": "unreleased",
    "channel_transition": False,
}
_ASSETS = Path(__file__).with_name("viewer_assets")
_VIEWER_ASSET_NAMES = ("viewer.js", "viewer.css", "THIRD_PARTY_NOTICES.txt")
_VIEWER_CAPABILITIES = "read-only review presentation; no authored or lifecycle mutation"
_PACKET_FILES = {
    "exact_brep": "artifacts/exact.brep",
    "step": "artifacts/exchange.step",
    "inspection_receipt": "artifacts/inspection-receipt.json",
    "review_glb": "artifacts/review.glb",
    "review_selection_map": "artifacts/worker-selection-map.json",
    "review_glb_receipt": "artifacts/review-glb-receipt.json",
    "review_selection_map_receipt": "artifacts/review-selection-map-receipt.json",
}


class ReviewPacketError(RuntimeError):
    """Packet admission, assembly, or readback failed closed."""


def _schema_validator(schema_name: str) -> Draft202012Validator:
    schema = json.loads(files("piton").joinpath("schemas", schema_name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _validate_contract(value: Mapping[str, Any], schema_name: str, label: str) -> None:
    try:
        _schema_validator(schema_name).validate(value)
    except ValidationError as error:
        if (
            label == "review packet"
            and error.absolute_path
            and error.absolute_path[0] == "viewer"
        ):
            label = "review packet viewer metadata"
        raise ReviewPacketError(f"{label} violates its closed schema") from error


def _digest_bytes(content: bytes) -> str:
    return "sha256:" + hashlib.sha256(content).hexdigest()


def _digest_value(value: Mapping[str, Any]) -> str:
    return _digest_bytes(b"piton.review-packet.v1\0" + canonical_json_bytes(value))


def _primitive(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _primitive(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_primitive(item) for item in value]
    return value


def _safe_artifact_bytes(root: Path, relative_path: str) -> bytes:
    if root.is_symlink() or not root.is_dir():
        raise ReviewPacketError("artifact root must be a real attempt directory")
    parts = Path(relative_path).parts
    if not parts or Path(relative_path).is_absolute() or any(part in {"", ".", ".."} for part in parts):
        raise ReviewPacketError("artifact path escapes attempt custody")
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise ReviewPacketError("artifact path contains a symbolic link")
    if not current.is_file():
        raise ReviewPacketError("artifact is missing or not a regular file")
    return current.read_bytes()


def _json_bytes(content: bytes, label: str) -> Mapping[str, Any]:
    try:
        value = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReviewPacketError(f"{label} is not valid JSON") from error
    if not isinstance(value, dict):
        raise ReviewPacketError(f"{label} must be a JSON object")
    return value


def _render_viewer_entrypoint(
    packet_bytes: bytes, semantic_bytes: bytes, glb_bytes: bytes
) -> bytes:
    """Deterministically bind the primary viewer surface to admitted bytes."""
    template = (_ASSETS / "index.html").read_bytes()
    replacements = {
        b"__PACKET_BASE64__": base64.b64encode(packet_bytes),
        b"__SELECTION_BASE64__": base64.b64encode(semantic_bytes),
        b"__GLB_BASE64__": base64.b64encode(glb_bytes),
    }
    for marker, replacement in replacements.items():
        if template.count(marker) != 1:
            raise ReviewPacketError("viewer entrypoint template is not closed")
        template = template.replace(marker, replacement)
    return template


@dataclass(frozen=True, slots=True)
class ReviewPacket:
    project_id: str
    revision_id: str
    build_attempt_id: str
    worker_pin: str
    evidence_closure_digest: str
    worker_result_digest: str
    declaration_digest: str
    generation: int
    fence: int
    lease_id: str
    artifacts: Mapping[str, Mapping[str, Any]]
    receipt_digests: tuple[str, ...]
    semantic_selection_map: Mapping[str, Any]
    source_parameters: Mapping[str, str]
    exact_geometry: Mapping[str, Any]
    review_geometry: Mapping[str, Any]
    build_plane: Mapping[str, Any]
    validation_issues: tuple[Mapping[str, str], ...]
    viewer: Mapping[str, Any]
    truth: Mapping[str, Any]
    packet_digest: str

    def to_primitive(self, *, include_digest: bool = True) -> dict[str, Any]:
        value = {
            "schema": "piton.review-packet.v1",
            "project_id": self.project_id,
            "revision_id": self.revision_id,
            "build_attempt_id": self.build_attempt_id,
            "worker_pin": self.worker_pin,
            "evidence_closure_digest": self.evidence_closure_digest,
            "worker_result_digest": self.worker_result_digest,
            "declaration_digest": self.declaration_digest,
            "generation": self.generation,
            "fence": self.fence,
            "lease_id": self.lease_id,
            "artifacts": _primitive(self.artifacts),
            "receipt_digests": list(self.receipt_digests),
            "semantic_selection_map": _primitive(self.semantic_selection_map),
            "source_parameters": dict(self.source_parameters),
            "exact_geometry": _primitive(self.exact_geometry),
            "review_geometry": _primitive(self.review_geometry),
            "build_plane": _primitive(self.build_plane),
            "validation_issues": _primitive(self.validation_issues),
            "viewer": _primitive(self.viewer),
            "truth": dict(self.truth),
        }
        if include_digest:
            value["packet_digest"] = self.packet_digest
        return value

    @property
    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.to_primitive())

    @property
    def fabrication_release(self) -> bool:
        return bool(self.truth["fabrication_release"])

    @classmethod
    def from_primitive(cls, value: Mapping[str, Any]) -> "ReviewPacket":
        _validate_contract(value, "review-packet-v1.schema.json", "review packet")
        required = {
            "schema", "project_id", "revision_id", "build_attempt_id", "worker_pin",
            "evidence_closure_digest", "worker_result_digest", "declaration_digest",
            "generation", "fence", "lease_id", "artifacts", "receipt_digests",
            "semantic_selection_map", "source_parameters", "exact_geometry",
            "review_geometry", "build_plane", "validation_issues", "viewer", "truth",
            "packet_digest",
        }
        if set(value) != required or value.get("schema") != "piton.review-packet.v1":
            raise ReviewPacketError("review packet schema is not closed")
        arguments = {key: value[key] for key in required - {"schema"}}
        arguments["receipt_digests"] = tuple(arguments["receipt_digests"])
        arguments["validation_issues"] = tuple(arguments["validation_issues"])
        packet = cls(**arguments)
        viewer = packet.viewer
        if (
            not isinstance(viewer, Mapping)
            or set(viewer)
            != {"entrypoint", "frontend_dependencies", "asset_digests", "capabilities"}
            or viewer.get("entrypoint") != "index.html"
            or viewer.get("frontend_dependencies") != []
            or viewer.get("capabilities") != _VIEWER_CAPABILITIES
            or not isinstance(viewer.get("asset_digests"), Mapping)
            or set(viewer["asset_digests"]) != set(_VIEWER_ASSET_NAMES)
        ):
            raise ReviewPacketError("review packet viewer metadata is not closed")
        if dict(packet.truth) != _TRUTH:
            raise ReviewPacketError("review packet violates the root truth boundary")
        if set(packet.artifacts) != EXPECTED_ROLES:
            raise ReviewPacketError("review packet does not contain exactly seven artifact roles")
        if _digest_value(packet.to_primitive(include_digest=False)) != packet.packet_digest:
            raise ReviewPacketError("review packet digest does not match canonical content")
        return packet


def _semantic_map(
    *, original: Mapping[str, Any], result: PrecisionWorkerResult, source_parameters: Mapping[str, str]
) -> dict[str, Any]:
    bindings = original.get("bindings")
    if not isinstance(bindings, list) or len(bindings) != 1:
        raise ReviewPacketError("semantic binding is missing or ambiguous")
    binding = bindings[0]
    if set(binding) != {"semantic_id", "primitive", "triangle_start", "triangle_count"}:
        raise ReviewPacketError("worker selection binding is malformed")
    if (
        binding.get("semantic_id") != "part:l_bracket"
        or binding.get("primitive") != 0
        or binding.get("triangle_start") != 0
        or type(binding.get("triangle_count")) is not int
        or binding["triangle_count"] <= 0
    ):
        raise ReviewPacketError("semantic binding is missing, ambiguous, or out of range")
    zones = [
        {"zone_id": f"parameter:{name}", "label": name, "parameter_id": name}
        for name in sorted(source_parameters)
    ]
    if not zones:
        raise ReviewPacketError("source parameter zones are missing")
    return {
        "schema": "piton.semantic-selection-map.v1",
        "revision_id": result.revision_id,
        "build_attempt_id": result.attempt_id,
        "glb_digest": result.artifacts["review_glb"].digest,
        "source_selection_map_digest": result.artifacts["review_selection_map"].digest,
        "identity_scope": "artifact-local; no durable topology identity; no nearest fallback",
        "selection_policy": "exact declared primitive/triangle range only; ambiguity blocks",
        "bindings": [
            {
                **binding,
                "semantic_entity_id": "part:l_bracket",
                "source_part_id": "part:l_bracket",
                "occurrence_id": "occurrence:l_bracket:1",
                "zones": zones,
            }
        ],
    }


def _admit(
    closure: EvidenceClosure, result: PrecisionWorkerResult, artifact_root: Path
) -> tuple[dict[str, bytes], dict[str, Any]]:
    if not isinstance(closure, EvidenceClosure) or not isinstance(result, PrecisionWorkerResult):
        raise TypeError("an EvidenceClosure and PrecisionWorkerResult are required")
    if result.status != "succeeded" or not result.expected_output_closure:
        raise ReviewPacketError("only a successful closed worker result is reviewable")
    bindings = (
        (closure.project_id, result.project_id),
        (closure.revision_id, result.revision_id),
        (closure.attempt_id, result.attempt_id),
        (closure.worker_result_digest, result.result_digest),
        (closure.generation, result.generation),
        (closure.fence, result.fence),
        (closure.lease_id, result.lease_id),
    )
    if any(left != right for left, right in bindings):
        raise ReviewPacketError("closure and worker result identity bindings disagree")
    if set(result.artifacts) != EXPECTED_ROLES or set(closure.artifacts) != EXPECTED_ROLES:
        raise ReviewPacketError("packet requires exactly the successful seven-role output closure")
    if dict(closure.truth) != {k: _TRUTH[k] for k in ("review_state", "fabrication_release", "machine_actuation")}:
        raise ReviewPacketError("evidence closure violates the root truth boundary")
    contents: dict[str, bytes] = {}
    artifact_records: dict[str, Any] = {}
    for role in sorted(EXPECTED_ROLES):
        artifact = result.artifacts[role]
        closure_record = dict(closure.artifacts[role])
        if closure_record != artifact.to_primitive():
            raise ReviewPacketError("evidence closure artifact metadata disagrees with worker result")
        content = _safe_artifact_bytes(artifact_root, artifact.relative_path)
        if _digest_bytes(content) != artifact.digest or len(content) != artifact.byte_length:
            raise ReviewPacketError("artifact digest or byte length does not match admitted evidence")
        contents[role] = content
        artifact_records[role] = {**artifact.to_primitive(), "packet_path": _PACKET_FILES[role]}

    inspection = _json_bytes(contents["inspection_receipt"], "inspection receipt")
    glb_receipt = _json_bytes(contents["review_glb_receipt"], "GLB receipt")
    selection_receipt = _json_bytes(contents["review_selection_map_receipt"], "selection-map receipt")
    original_selection = _json_bytes(contents["review_selection_map"], "worker selection map")
    from .mesh_derivatives import read_glb

    with tempfile.NamedTemporaryFile(suffix=".glb") as verified_glb:
        verified_glb.write(contents["review_glb"])
        verified_glb.flush()
        glb = read_glb(Path(verified_glb.name))
    exact_digest = result.artifacts["exact_brep"].digest
    exact_receipt_digest = result.artifacts["inspection_receipt"].digest
    for role, receipt, artifact_role in (
        ("glb", glb_receipt, "review_glb"),
        ("selection_map", selection_receipt, "review_selection_map"),
    ):
        artifact = result.artifacts[artifact_role]
        if (
            receipt.get("status") != "succeeded"
            or receipt.get("revision_id") != result.revision_id
            or receipt.get("source_build_attempt_scope") != result.attempt_id
            or receipt.get("source_exact_brep_digest") != exact_digest
            or receipt.get("source_exact_receipt_digest") != exact_receipt_digest
            or receipt.get("artifact_role") != role
            or receipt.get("artifact_digest") != artifact.digest
            or receipt.get("artifact_byte_length") != artifact.byte_length
        ):
            raise ReviewPacketError("review receipt does not bind the exact admitted artifact")
    if glb_receipt.get("selection_map_digest") != result.artifacts["review_selection_map"].digest:
        raise ReviewPacketError("GLB receipt does not bind the exact selection map")
    if (
        original_selection.get("revision_id") != result.revision_id
        or original_selection.get("source_build_attempt_scope") != result.attempt_id
        or original_selection.get("glb_digest") != result.artifacts["review_glb"].digest
        or original_selection.get("identity_scope")
        != "artifact-local; no durable topology identity; no nearest fallback"
    ):
        raise ReviewPacketError("selection map does not bind the exact GLB identity")
    if glb["triangle_count"] != original_selection["bindings"][0].get("triangle_count"):
        raise ReviewPacketError("selection map triangle range does not close the GLB")
    return contents, {
        "artifact_records": artifact_records,
        "inspection": inspection,
        "glb_receipt": glb_receipt,
        "selection_receipt": selection_receipt,
        "original_selection": original_selection,
        "glb": glb,
    }


def build_review_packet(
    closure: EvidenceClosure,
    result: PrecisionWorkerResult,
    artifact_root: str | Path,
    output_directory: str | Path,
) -> ReviewPacket:
    """Validate one exact closure and atomically publish a powerless review packet."""
    root = Path(artifact_root)
    output = Path(output_directory)
    if output.exists():
        raise FileExistsError("review packet destination must be new")
    contents, admitted = _admit(closure, result, root)
    inspection = admitted["inspection"]
    glb_receipt = admitted["glb_receipt"]
    source_parameters = inspection.get("revision_manifest", {}).get("parameter_values")
    if not isinstance(source_parameters, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in source_parameters.items()
    ):
        raise ReviewPacketError("inspection receipt source parameters are invalid")
    semantic = _semantic_map(
        original=admitted["original_selection"], result=result, source_parameters=source_parameters
    )
    semantic_bytes = canonical_json_bytes(semantic)
    bounds = admitted["glb"]["bounding_box_mm"]
    exact_bounds = inspection.get("inspection", {}).get("bounding_box_mm")
    transform = glb_receipt.get("coordinate_mapping", {}).get("artifact_to_cad_translation_mm")
    tolerance = float(glb_receipt.get("tessellation_policy", {}).get("linear_deflection_mm", -1))
    if (
        not isinstance(exact_bounds, dict)
        or exact_bounds.get("min", [None, None, None])[2] != -20.0
        or bounds["min"][2] != 0.0
        or transform != [0.0, 0.0, -20.0]
        or tolerance <= 0
    ):
        raise ReviewPacketError("build-plane exact/review transform evidence is invalid")
    semantic_record = {
        "digest": _digest_bytes(semantic_bytes),
        "byte_length": len(semantic_bytes),
        "path": "semantic-selection-map.json",
        "glb_digest": result.artifacts["review_glb"].digest,
    }
    static_assets = {
        name: _digest_bytes((_ASSETS / name).read_bytes())
        for name in _VIEWER_ASSET_NAMES
    }
    primitive = {
        "schema": "piton.review-packet.v1",
        "project_id": closure.project_id,
        "revision_id": closure.revision_id,
        "build_attempt_id": closure.attempt_id,
        "worker_pin": result.worker_pin,
        "evidence_closure_digest": closure.closure_digest,
        "worker_result_digest": result.result_digest,
        "declaration_digest": closure.declaration_digest,
        "generation": closure.generation,
        "fence": closure.fence,
        "lease_id": closure.lease_id,
        "artifacts": admitted["artifact_records"],
        "receipt_digests": [item.receipt_digest for item in closure.receipts],
        "semantic_selection_map": semantic_record,
        "source_parameters": dict(sorted(source_parameters.items())),
        "exact_geometry": {"representation": "OCCT BREP", "bounding_box_mm": exact_bounds, "z_min_mm": -20.0},
        "review_geometry": {
            "representation": "GLB review mesh",
            "claim_scope": "review-only",
            "bounding_box_mm": bounds,
            "mesh_measurements": "review-only",
        },
        "build_plane": {
            "exact_brep_z_min_mm": -20.0,
            "review_z_min_mm": 0.0,
            "artifact_to_cad_translation_mm": [0.0, 0.0, -20.0],
            "artifact_to_world_mapping": "[x,y,z] -> [x,z,-y]",
            "world_grid_axis": "Y=0",
            "tolerance_mm": tolerance,
            "translated_review_floor_is_exact_coordinate": False,
        },
        "validation_issues": [
            {"status": "pass", "message": "one valid exact solid"},
            {"status": "pass", "message": "review Z=0 maps to the visible physical grid plane"},
            {"status": "warning", "message": "trusted-local isolation; network and credential isolation are not proven"},
        ],
        "viewer": {
            "entrypoint": "index.html",
            "frontend_dependencies": [],
            "asset_digests": static_assets,
            "capabilities": _VIEWER_CAPABILITIES,
        },
        "truth": dict(_TRUTH),
    }
    packet = ReviewPacket.from_primitive({**primitive, "packet_digest": _digest_value(primitive)})

    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}.staging-", dir=output.parent))
    try:
        for role, content in contents.items():
            destination = staging / _PACKET_FILES[role]
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
        (staging / "review-packet.json").write_bytes(packet.canonical_bytes)
        (staging / "semantic-selection-map.json").write_bytes(semantic_bytes)
        for name in _VIEWER_ASSET_NAMES:
            shutil.copyfile(_ASSETS / name, staging / name)
        (staging / "index.html").write_bytes(
            _render_viewer_entrypoint(packet.canonical_bytes, semantic_bytes, contents["review_glb"])
        )
        validate_review_packet(staging)
        os.replace(staging, output)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return packet


def validate_review_packet(packet_directory: str | Path) -> ReviewPacket:
    """Read back canonical packet bytes and every packet-local binding."""
    root = Path(packet_directory)
    if root.is_symlink() or not root.is_dir():
        raise ReviewPacketError("review packet directory is unavailable or unsafe")
    packet_value = _json_bytes(_safe_artifact_bytes(root, "review-packet.json"), "review packet")
    packet = ReviewPacket.from_primitive(packet_value)
    if _safe_artifact_bytes(root, "review-packet.json") != packet.canonical_bytes:
        raise ReviewPacketError("review packet bytes are not canonical")
    packet_paths = {
        role: record.get("packet_path") for role, record in packet.artifacts.items()
    }
    if (
        packet_paths != _PACKET_FILES
        or len(set(packet_paths.values())) != len(EXPECTED_ROLES)
    ):
        raise ReviewPacketError("review packet artifact path inventory is not closed")
    expected_files = {
        "review-packet.json",
        "semantic-selection-map.json",
        "index.html",
        *_VIEWER_ASSET_NAMES,
        *packet_paths.values(),
    }
    actual_files = {
        path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()
    }
    if actual_files != expected_files:
        raise ReviewPacketError("review packet file inventory is not exact")
    for role, record in packet.artifacts.items():
        content = _safe_artifact_bytes(root, record["packet_path"])
        if _digest_bytes(content) != record["digest"] or len(content) != record["byte_length"]:
            raise ReviewPacketError("packet artifact digest or byte length mismatch")
    semantic_bytes = _safe_artifact_bytes(root, packet.semantic_selection_map["path"])
    if (
        _digest_bytes(semantic_bytes) != packet.semantic_selection_map["digest"]
        or len(semantic_bytes) != packet.semantic_selection_map["byte_length"]
    ):
        raise ReviewPacketError("semantic selection map digest or byte length mismatch")
    semantic = _json_bytes(semantic_bytes, "semantic selection map")
    _validate_contract(
        semantic, "semantic-selection-map-v1.schema.json", "semantic selection map"
    )
    if semantic_bytes != canonical_json_bytes(semantic):
        raise ReviewPacketError("semantic selection map bytes are not canonical")
    bindings = semantic.get("bindings")
    if (
        semantic.get("source_selection_map_digest")
        != packet.artifacts["review_selection_map"]["digest"]
    ):
        raise ReviewPacketError("semantic source selection map digest is cross-artifact")
    if (
        semantic.get("revision_id") != packet.revision_id
        or semantic.get("build_attempt_id") != packet.build_attempt_id
        or semantic.get("glb_digest") != packet.artifacts["review_glb"]["digest"]
        or semantic.get("identity_scope")
        != "artifact-local; no durable topology identity; no nearest fallback"
        or not isinstance(bindings, list)
        or len(bindings) != 1
        or bindings[0].get("primitive") != 0
        or bindings[0].get("triangle_start") != 0
        or not bindings[0].get("zones")
    ):
        raise ReviewPacketError("semantic selection bindings are ambiguous or cross-artifact")
    trusted_asset_digests = {
        name: _digest_bytes((_ASSETS / name).read_bytes()) for name in _VIEWER_ASSET_NAMES
    }
    if packet.viewer.get("asset_digests") != trusted_asset_digests:
        raise ReviewPacketError("trusted viewer asset digest set mismatch")
    for name in _VIEWER_ASSET_NAMES:
        if _safe_artifact_bytes(root, name) != (_ASSETS / name).read_bytes():
            raise ReviewPacketError("trusted viewer asset bytes mismatch")
    expected_entrypoint = _render_viewer_entrypoint(
        packet.canonical_bytes,
        semantic_bytes,
        _safe_artifact_bytes(root, packet.artifacts["review_glb"]["packet_path"]),
    )
    if _safe_artifact_bytes(root, "index.html") != expected_entrypoint:
        raise ReviewPacketError("viewer entrypoint does not match deterministic reconstruction")
    return packet
