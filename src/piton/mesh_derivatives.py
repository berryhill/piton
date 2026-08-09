"""Deterministic, independently read-back mesh derivatives of one exact realization.

This worker reads an admitted OCCT BREP but never mutates authored or lifecycle
state. GLB is review-only; STL and 3MF are unreleased additive derivatives.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import os
import platform
import shutil
import struct
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping
from xml.etree import ElementTree as ET

from build123d import Mesher, import_brep

from .revision import DesignRevision, canonical_json_bytes

_GLB_NAME = "part.glb"
_STL_NAME = "part.stl"
_3MF_NAME = "part.3mf"
_SELECTION_NAME = "selection-map.json"
_RECEIPT_NAMES = {
    "glb": "glb.receipt.json",
    "stl": "stl.receipt.json",
    "3mf": "3mf.receipt.json",
    "selection_map": "selection-map.receipt.json",
}
_MEDIA_TYPES = {
    "glb": "model/gltf-binary",
    "stl": "model/stl",
    "3mf": "model/3mf",
    "selection_map": "application/json",
}
_CLAIM_SCOPES = {
    "glb": "review-only",
    "stl": "derived-assumed-units-mesh",
    "3mf": "derived-additive-package",
    "selection_map": "artifact-local-review-selection-only",
}


def _digest_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def _digest_file(path: Path) -> str:
    return _digest_bytes(path.read_bytes())


def _finite_number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("geometry contains a non-finite coordinate")
    return float(value)


def _bounds(vertices: Iterable[Iterable[float]]) -> dict[str, list[float]]:
    copied = [tuple(_finite_number(value) for value in vertex) for vertex in vertices]
    if not copied or any(len(vertex) != 3 for vertex in copied):
        raise ValueError("geometry requires nonempty 3D vertices")
    minimum = [min(vertex[axis] for vertex in copied) for axis in range(3)]
    maximum = [max(vertex[axis] for vertex in copied) for axis in range(3)]
    return {"min": minimum, "max": maximum, "size": [maximum[i] - minimum[i] for i in range(3)]}


def _canonical_file(path: Path, value: Mapping[str, Any]) -> None:
    path.write_bytes(canonical_json_bytes(value) + b"\n")


def _move_to_digest_address(staging: Path, path: Path) -> Path:
    """Move validated bytes to a no-clobber, content-addressed local path."""
    digest = _digest_file(path)
    destination = staging / "artifacts" / "sha256" / digest.removeprefix("sha256:") / path.name
    destination.parent.mkdir(parents=True, exist_ok=False)
    os.replace(path, destination)
    return destination


@dataclass(frozen=True, slots=True)
class TessellationPolicy:
    """The one immutable mesh policy shared by all requested derivatives."""

    linear_deflection_mm: float = 0.05
    angular_deflection_rad: float = 0.1
    floor_contact_required: bool = True
    max_triangles: int = 1_000_000

    def __post_init__(self) -> None:
        for name in ("linear_deflection_mm", "angular_deflection_rad"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be a positive finite number")
        if not isinstance(self.floor_contact_required, bool):
            raise ValueError("floor_contact_required must be boolean")
        if isinstance(self.max_triangles, bool) or not isinstance(self.max_triangles, int) or self.max_triangles <= 0:
            raise ValueError("max_triangles must be a positive integer")

    def to_manifest(self) -> dict[str, Any]:
        return {
            "schema": "piton.tessellation-policy.v1",
            "linear_deflection_mm": float(self.linear_deflection_mm),
            "angular_deflection_rad": float(self.angular_deflection_rad),
            "floor_contact_required": self.floor_contact_required,
            "max_triangles": self.max_triangles,
        }

    def digest(self) -> str:
        return _digest_bytes(b"piton.tessellation-policy.v1\0" + canonical_json_bytes(self.to_manifest()))


@dataclass(frozen=True, slots=True)
class DerivativeSource:
    """Caller-supplied identity claims that must all match actual exact bytes."""

    revision_id: str
    build_attempt_scope: str
    exact_brep_digest: str
    exact_receipt_digest: str
    exact_attempt_directory: Path


def _admit(source: DerivativeSource) -> tuple[Path, dict[str, Any]]:
    if not isinstance(source, DerivativeSource):
        raise TypeError("source must be a DerivativeSource")
    attempt = source.exact_attempt_directory.resolve(strict=True)
    receipt_path = attempt / "receipt.json"
    receipt_bytes = receipt_path.read_bytes()
    if _digest_bytes(receipt_bytes) != source.exact_receipt_digest:
        raise ValueError("source exact receipt digest mismatch")
    try:
        receipt = json.loads(receipt_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("source exact receipt is invalid JSON") from exc
    if not isinstance(receipt, dict) or receipt.get("schema") != "piton.exact-realization-receipt.v1":
        raise ValueError("source exact receipt schema mismatch")
    if receipt.get("status") != "succeeded":
        raise ValueError("source exact realization is not successful")
    if receipt.get("attempt_scope") != source.build_attempt_scope or attempt.name != source.build_attempt_scope:
        raise ValueError("source build attempt scope mismatch")
    if receipt.get("revision_id") != source.revision_id:
        raise ValueError("source revision ID mismatch")
    revision = DesignRevision.from_manifest(receipt.get("revision_manifest", {}))
    if revision.revision_id != source.revision_id:
        raise ValueError("source revision manifest mismatch")
    if receipt.get("artifacts", {}).get("exact_brep") != "part.brep":
        raise ValueError("source exact BREP path is not canonical")
    if receipt.get("artifact_digests", {}).get("exact_brep") != source.exact_brep_digest:
        raise ValueError("source receipt exact BREP digest mismatch")
    brep_path = attempt / "part.brep"
    if _digest_file(brep_path) != source.exact_brep_digest:
        raise ValueError("actual exact BREP digest mismatch")
    if receipt.get("fabrication_release") is not False or receipt.get("machine_actuation") is not False:
        raise ValueError("source exact receipt violates the truth boundary")
    return brep_path, receipt


def _mesh(brep_path: Path, policy: TessellationPolicy) -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]], float]:
    shape = import_brep(brep_path)
    if not shape.is_valid or len(shape.solids()) != 1:
        raise ValueError("source exact BREP is not one valid solid")
    raw_vertices, raw_triangles = Mesher._mesh_shape(
        shape, policy.linear_deflection_mm, policy.angular_deflection_rad
    )
    vertices = [tuple(_finite_number(value) for value in vertex) for vertex in raw_vertices]
    triangles = [tuple(int(index) for index in triangle) for triangle in raw_triangles]
    if not triangles or len(triangles) > policy.max_triangles:
        raise ValueError("triangle count is empty or exceeds policy")
    if any(len(triangle) != 3 or len(set(triangle)) != 3 for triangle in triangles):
        raise ValueError("tessellation contains a degenerate index triangle")
    if any(index < 0 or index >= len(vertices) for triangle in triangles for index in triangle):
        raise ValueError("tessellation contains an out-of-range index")
    source_min_z = _bounds(vertices)["min"][2]
    z_offset = -source_min_z if policy.floor_contact_required else 0.0
    shifted = [(x, y, z + z_offset) for x, y, z in vertices]
    return shifted, triangles, z_offset


def _glb_bytes(vertices: list[tuple[float, float, float]], triangles: list[tuple[int, int, int]]) -> bytes:
    positions = b"".join(struct.pack("<3f", *vertex) for vertex in vertices)
    indices = b"".join(struct.pack("<I", index) for triangle in triangles for index in triangle)
    binary = positions + indices
    binary += b"\0" * ((-len(binary)) % 4)
    bounds = _bounds(vertices)
    document = {
        "asset": {"generator": "Piton deterministic mesh derivative v1", "version": "2.0"},
        "buffers": [{"byteLength": len(positions) + len(indices)}],
        "bufferViews": [
            {"buffer": 0, "byteLength": len(positions), "byteOffset": 0, "target": 34962},
            {"buffer": 0, "byteLength": len(indices), "byteOffset": len(positions), "target": 34963},
        ],
        "accessors": [
            {"bufferView": 0, "byteOffset": 0, "componentType": 5126, "count": len(vertices),
             "type": "VEC3", "min": bounds["min"], "max": bounds["max"]},
            {"bufferView": 1, "byteOffset": 0, "componentType": 5125, "count": len(triangles) * 3,
             "type": "SCALAR", "min": [0], "max": [len(vertices) - 1]},
        ],
        "meshes": [{"name": "part:l_bracket", "primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "mode": 4}]}],
        "nodes": [{"mesh": 0, "name": "part:l_bracket"}],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
    }
    json_chunk = canonical_json_bytes(document)
    json_chunk += b" " * ((-len(json_chunk)) % 4)
    total = 12 + 8 + len(json_chunk) + 8 + len(binary)
    return (
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<I4s", len(json_chunk), b"JSON") + json_chunk
        + struct.pack("<I4s", len(binary), b"BIN\0") + binary
    )


def read_glb(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    if len(data) < 28:
        raise ValueError("GLB is truncated")
    magic, version, declared = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or declared != len(data):
        raise ValueError("GLB header is invalid")
    json_length, json_kind = struct.unpack_from("<I4s", data, 12)
    if json_kind != b"JSON" or 20 + json_length + 8 > len(data):
        raise ValueError("GLB JSON chunk is invalid")
    try:
        document = json.loads(data[20:20 + json_length].rstrip(b" \0"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("GLB JSON is invalid") from exc
    bin_header = 20 + json_length
    bin_length, bin_kind = struct.unpack_from("<I4s", data, bin_header)
    binary = data[bin_header + 8:]
    if bin_kind != b"BIN\0" or len(binary) != bin_length:
        raise ValueError("GLB binary chunk is invalid")
    try:
        primitive = document["meshes"][0]["primitives"][0]
        if len(document["meshes"]) != 1 or len(document["meshes"][0]["primitives"]) != 1 or primitive.get("mode", 4) != 4:
            raise ValueError
        position_accessor = document["accessors"][primitive["attributes"]["POSITION"]]
        index_accessor = document["accessors"][primitive["indices"]]
        position_view = document["bufferViews"][position_accessor["bufferView"]]
        index_view = document["bufferViews"][index_accessor["bufferView"]]
        if position_accessor["componentType"] != 5126 or position_accessor["type"] != "VEC3":
            raise ValueError
        if index_accessor["componentType"] != 5125 or index_accessor["type"] != "SCALAR":
            raise ValueError
        pos_start = position_view.get("byteOffset", 0) + position_accessor.get("byteOffset", 0)
        idx_start = index_view.get("byteOffset", 0) + index_accessor.get("byteOffset", 0)
        vertices = [struct.unpack_from("<3f", binary, pos_start + i * 12) for i in range(position_accessor["count"])]
        indices = [struct.unpack_from("<I", binary, idx_start + i * 4)[0] for i in range(index_accessor["count"])]
    except (KeyError, IndexError, TypeError, struct.error, ValueError) as exc:
        raise ValueError("GLB indexed geometry structure is invalid") from exc
    if not vertices or not indices or len(indices) % 3 or any(index >= len(vertices) for index in indices):
        raise ValueError("GLB indexed geometry is invalid")
    bounds = _bounds(vertices)
    return {"vertices": vertices, "triangle_count": len(indices) // 3, "bounding_box_mm": bounds,
            "coordinate_mapping": "artifact XYZ millimetres; receipt records artifact-to-CAD Z translation"}


def _normal(a: tuple[float, float, float], b: tuple[float, float, float], c: tuple[float, float, float]) -> tuple[float, float, float]:
    ab = tuple(b[i] - a[i] for i in range(3)); ac = tuple(c[i] - a[i] for i in range(3))
    cross = (ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0])
    length = math.sqrt(sum(value * value for value in cross))
    if length == 0:
        raise ValueError("mesh contains a zero-area triangle")
    return tuple(value / length for value in cross)


def _stl_bytes(vertices: list[tuple[float, float, float]], triangles: list[tuple[int, int, int]]) -> bytes:
    header = b"PITON DERIVED STL; ASSUMED UNITS MM; UNRELEASED".ljust(80, b" ")
    records = []
    for triangle in triangles:
        points = [vertices[index] for index in triangle]
        records.append(struct.pack("<12fH", *_normal(*points), *points[0], *points[1], *points[2], 0))
    return header + struct.pack("<I", len(triangles)) + b"".join(records)


def read_binary_stl(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    if len(data) < 84:
        raise ValueError("binary STL is truncated")
    count = struct.unpack_from("<I", data, 80)[0]
    if count == 0 or len(data) != 84 + count * 50:
        raise ValueError("binary STL triangle count or byte length is invalid")
    vertices: list[tuple[float, float, float]] = []
    for index in range(count):
        values = struct.unpack_from("<12fH", data, 84 + index * 50)
        points = [tuple(_finite_number(value) for value in values[start:start + 3]) for start in (3, 6, 9)]
        _normal(*points)
        vertices.extend(points)
    return {"vertices": vertices, "triangle_count": count, "bounding_box_mm": _bounds(vertices),
            "units": "assumed millimetres; STL does not encode units"}


def _zip_member(name: str, data: bytes) -> tuple[zipfile.ZipInfo, bytes]:
    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 0
    info.external_attr = 0
    return info, data


def _three_mf_bytes(vertices: list[tuple[float, float, float]], triangles: list[tuple[int, int, int]]) -> bytes:
    vertex_xml = "".join(f'<vertex x="{x:.9g}" y="{y:.9g}" z="{z:.9g}"/>' for x, y, z in vertices)
    triangle_xml = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in triangles)
    model = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
        '<resources><object id="1" name="part:l_bracket" type="model"><mesh><vertices>' + vertex_xml
        + '</vertices><triangles>' + triangle_xml
        + '</triangles></mesh></object></resources><build><item objectid="1"/></build></model>'
    ).encode("utf-8")
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
        '</Types>'
    ).encode("utf-8")
    relationships = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
        '</Relationships>'
    ).encode("utf-8")
    from io import BytesIO
    stream = BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in (("[Content_Types].xml", content_types), ("_rels/.rels", relationships), ("3D/3dmodel.model", model)):
            info, payload = _zip_member(name, content)
            archive.writestr(info, payload, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return stream.getvalue()


def read_3mf(path: Path) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(path, "r") as archive:
            if archive.testzip() is not None:
                raise ValueError("3MF ZIP integrity failed")
            names = set(archive.namelist())
            required = {"[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"}
            if names != required:
                raise ValueError("3MF package members are invalid")
            if any(info.file_size > 64 * 1024 * 1024 or info.filename.startswith(("/", "../")) for info in archive.infolist()):
                raise ValueError("3MF package member is unsafe or oversized")
            content_types = ET.fromstring(archive.read("[Content_Types].xml"))
            relationships = ET.fromstring(archive.read("_rels/.rels"))
            model = ET.fromstring(archive.read("3D/3dmodel.model"))
    except (zipfile.BadZipFile, ET.ParseError, KeyError) as exc:
        raise ValueError("3MF package is invalid") from exc
    if not any(node.attrib.get("Extension") == "model" for node in content_types):
        raise ValueError("3MF model content type is missing")
    relationship = list(relationships)
    if len(relationship) != 1 or relationship[0].attrib.get("Target") != "/3D/3dmodel.model":
        raise ValueError("3MF root model relationship is invalid")
    namespace = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
    if model.attrib.get("unit") != "millimeter":
        raise ValueError("3MF units must be millimetres")
    objects = model.findall("m:resources/m:object", namespace)
    items = model.findall("m:build/m:item", namespace)
    if len(objects) != 1 or len(items) != 1 or items[0].attrib.get("objectid") != objects[0].attrib.get("id"):
        raise ValueError("3MF object/build relationship is invalid")
    vertex_nodes = objects[0].findall("m:mesh/m:vertices/m:vertex", namespace)
    triangle_nodes = objects[0].findall("m:mesh/m:triangles/m:triangle", namespace)
    try:
        vertices = [tuple(_finite_number(float(node.attrib[name])) for name in ("x", "y", "z")) for node in vertex_nodes]
        triangles = [tuple(int(node.attrib[name]) for name in ("v1", "v2", "v3")) for node in triangle_nodes]
    except (KeyError, ValueError) as exc:
        raise ValueError("3MF mesh values are invalid") from exc
    if not vertices or not triangles or any(len(set(t)) != 3 or any(i < 0 or i >= len(vertices) for i in t) for t in triangles):
        raise ValueError("3MF mesh indices are invalid")
    for triangle in triangles:
        _normal(*(vertices[index] for index in triangle))
    return {"vertices": vertices, "triangle_count": len(triangles), "bounding_box_mm": _bounds(vertices), "units": "millimetres encoded in package"}


def validate_selection_map(path: Path, *, glb_path: Path, revision_id: str,
                           build_attempt_scope: str, triangle_count: int) -> dict[str, Any]:
    try:
        value = json.loads(path.read_bytes())
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("selection map JSON is invalid") from exc
    required = {"schema", "revision_id", "source_build_attempt_scope", "glb_digest", "identity_scope", "bindings"}
    if not isinstance(value, dict) or set(value) != required:
        raise ValueError("selection map schema is not closed")
    if value["schema"] != "piton.glb-selection-map.v1" or value["revision_id"] != revision_id:
        raise ValueError("selection map revision binding mismatch")
    if value["source_build_attempt_scope"] != build_attempt_scope or value["glb_digest"] != _digest_file(glb_path):
        raise ValueError("selection map artifact binding mismatch")
    if value["identity_scope"] != "artifact-local; no durable topology identity; no nearest fallback":
        raise ValueError("selection map identity scope mismatch")
    expected = [{"semantic_id": "part:l_bracket", "primitive": 0, "triangle_start": 0, "triangle_count": triangle_count}]
    if value["bindings"] != expected:
        raise ValueError("selection map is missing, ambiguous, multiply bound, or out of range")
    return value


def _receipt(*, role: str, filename: str, path: Path, source: DerivativeSource,
             policy: TessellationPolicy, validation: Mapping[str, Any], z_offset: float,
             selection_map_digest: str | None = None) -> dict[str, Any]:
    toolchain = {
        "python": platform.python_version(),
        "build123d": importlib.metadata.version("build123d"),
        "cadquery-ocp-novtk": importlib.metadata.version("cadquery-ocp-novtk"),
        "derivative_writer": "piton.mesh-derivatives/v1",
    }
    warnings = {
        "glb": ["review mesh only; triangle and renderer IDs are artifact-local"],
        "stl": ["STL has no intrinsic units; interpreted as millimetres", "STL does not imply fabrication release"],
        "3mf": ["unreleased additive package; no slicer or process qualification"],
        "selection_map": ["artifact-local only; no durable topology identity; no nearest-geometry fallback"],
    }[role]
    receipt = {
        "schema": "piton.mesh-derivative-receipt.v1",
        "status": "succeeded",
        "revision_id": source.revision_id,
        "source_build_attempt_scope": source.build_attempt_scope,
        "source_exact_brep_digest": source.exact_brep_digest,
        "source_exact_receipt_digest": source.exact_receipt_digest,
        "artifact_role": role,
        "artifact_filename": filename,
        "artifact_media_type": _MEDIA_TYPES[role],
        "artifact_byte_length": path.stat().st_size,
        "artifact_digest": _digest_file(path),
        "toolchain": toolchain,
        "environment": {"isolation_class": "trusted-local", "platform": platform.platform(), "machine": platform.machine()},
        "units": ({"encoded": None, "interpreted": "mm"} if role == "stl" else {"encoded": "mm", "interpreted": "mm"}),
        "coordinate_mapping": {"artifact_axes": "CAD XYZ", "artifact_to_cad_translation_mm": [0.0, 0.0, -z_offset]},
        "tessellation_policy": {**policy.to_manifest(), "digest": policy.digest()},
        "claim_scope": _CLAIM_SCOPES[role],
        "validation": dict(validation),
        "warnings": warnings,
        "selection_map_digest": selection_map_digest,
        "writable_design_authority": "source-native Python",
        "mesh_to_brep_recovery_claimed": False,
        "review_state": "needs_human_review",
        "unreleased": True,
        "fabrication_release": False,
        "machine_actuation": False,
    }
    return receipt


def _validate_bounds(decoded: Mapping[str, Any], exact_receipt: Mapping[str, Any], z_offset: float,
                     policy: TessellationPolicy) -> None:
    expected = exact_receipt["inspection"]["bounding_box_mm"]
    actual = decoded["bounding_box_mm"]
    tolerance = max(policy.linear_deflection_mm, 1e-6)
    for key in ("min", "max", "size"):
        expected_values = list(expected[key])
        if key in ("min", "max"):
            expected_values[2] += z_offset
        if any(abs(float(actual[key][i]) - float(expected_values[i])) > tolerance for i in range(3)):
            raise ValueError("decoded mesh bounds disagree with exact realization")
    if policy.floor_contact_required and abs(float(actual["min"][2])) > tolerance:
        raise ValueError("decoded mesh does not contact the CAD build plane")


def derive_mesh_derivatives(source: DerivativeSource, policy: TessellationPolicy,
                            output_directory: Path) -> dict[str, Any]:
    """Admit one exact realization and atomically publish four derived artifacts."""
    if not isinstance(policy, TessellationPolicy):
        raise TypeError("policy must be a TessellationPolicy")
    brep_path, exact_receipt = _admit(source)
    output_directory = output_directory.resolve()
    if output_directory.exists():
        raise FileExistsError("output_directory must be new and attempt-scoped")
    output_directory.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output_directory.name}.staging-", dir=output_directory.parent))
    try:
        vertices, triangles, z_offset = _mesh(brep_path, policy)
        paths = {"glb": staging / _GLB_NAME, "stl": staging / _STL_NAME, "3mf": staging / _3MF_NAME}
        paths["glb"].write_bytes(_glb_bytes(vertices, triangles))
        paths["stl"].write_bytes(_stl_bytes(vertices, triangles))
        paths["3mf"].write_bytes(_three_mf_bytes(vertices, triangles))

        decoded = {"glb": read_glb(paths["glb"]), "stl": read_binary_stl(paths["stl"]), "3mf": read_3mf(paths["3mf"])}
        for value in decoded.values():
            _validate_bounds(value, exact_receipt, z_offset, policy)
        if len({value["triangle_count"] for value in decoded.values()}) != 1:
            raise ValueError("derivative triangle counts disagree under the common policy")

        selection = {
            "schema": "piton.glb-selection-map.v1",
            "revision_id": source.revision_id,
            "source_build_attempt_scope": source.build_attempt_scope,
            "glb_digest": _digest_file(paths["glb"]),
            "identity_scope": "artifact-local; no durable topology identity; no nearest fallback",
            "bindings": [{"semantic_id": "part:l_bracket", "primitive": 0, "triangle_start": 0,
                          "triangle_count": decoded["glb"]["triangle_count"]}],
        }
        paths["selection_map"] = staging / _SELECTION_NAME
        _canonical_file(paths["selection_map"], selection)
        validate_selection_map(paths["selection_map"], glb_path=paths["glb"], revision_id=source.revision_id,
                               build_attempt_scope=source.build_attempt_scope,
                               triangle_count=decoded["glb"]["triangle_count"])

        selection_digest = _digest_file(paths["selection_map"])
        paths = {role: _move_to_digest_address(staging, path) for role, path in paths.items()}
        validations = {
            role: {"procedure": f"piton.readback.{role}.v1", "passed": True,
                   "triangle_count": value["triangle_count"], "bounding_box_mm": value["bounding_box_mm"],
                   "floor_contact_verified": (not policy.floor_contact_required or abs(value["bounding_box_mm"]["min"][2]) <= max(policy.linear_deflection_mm, 1e-6))}
            for role, value in decoded.items()
        }
        validations["selection_map"] = {"procedure": "piton.readback.selection-map.v1", "passed": True,
                                         "binding_count": len(selection["bindings"])}
        receipts: dict[str, str] = {}
        for role, path in paths.items():
            receipt = _receipt(role=role, filename=path.relative_to(staging).as_posix(), path=path,
                               source=source, policy=policy,
                               validation=validations[role], z_offset=z_offset,
                               selection_map_digest=selection_digest if role == "glb" else None)
            receipt_path = staging / _RECEIPT_NAMES[role]
            _canonical_file(receipt_path, receipt)
            receipts[role] = receipt_path.name

        result = {
            "schema": "piton.mesh-derivative-set.v1",
            "status": "succeeded",
            "revision_id": source.revision_id,
            "source_build_attempt_scope": source.build_attempt_scope,
            "source_exact_brep_digest": source.exact_brep_digest,
            "source_exact_receipt_digest": source.exact_receipt_digest,
            "artifacts": {role: path.relative_to(staging).as_posix() for role, path in paths.items()},
            "artifact_digests": {role: _digest_file(path) for role, path in paths.items()},
            "receipts": receipts,
            "receipt_digests": {role: _digest_file(staging / name) for role, name in receipts.items()},
            "tessellation_policy": {**policy.to_manifest(), "digest": policy.digest()},
            "review_state": "needs_human_review",
            "fabrication_release": False,
            "machine_actuation": False,
        }
        _canonical_file(staging / "derivative-set.json", result)
        os.replace(staging, output_directory)
        return result
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
