"""Pinned trusted-local precision worker over immutable attempt contracts.

The worker realizes attempt-scoped derivatives only. It has no database,
revision-mutation, channel, review, approval, export, release, or actuation API.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
from pathlib import Path
from typing import Any, Mapping

from .launch_verification import (
    CURRENT_PRECISION_WORKER_OUTPUTS,
    CURRENT_PRECISION_WORKER_PIN,
)
from .mesh_derivatives import (
    DerivativeSource,
    TessellationPolicy,
    derive_review_derivatives,
)
from .realization import (
    EXACT_BREP_NAME,
    EXPECTED_TOOLCHAIN,
    RECEIPT_NAME,
    STEP_NAME,
    RealizationInputs,
    realize_exact,
)
from .revision import DesignRevision
from .storage.build_attempts import CoordinatorState, DurableBuildAttempt
from .worker_contracts import (
    PrecisionWorkerRequest,
    PrecisionWorkerResult,
    WorkerArtifact,
    canonical_json_bytes,
)

PRECISION_WORKER_ID = "precision_worker_one"
PRECISION_WORKER_PIN = CURRENT_PRECISION_WORKER_PIN
EXPECTED_OUTPUTS = CURRENT_PRECISION_WORKER_OUTPUTS


class WorkerOutputCustodyError(RuntimeError):
    """The configured attempt scope is not a no-follow directory chain."""


def _manifest_digest(namespace: str, value: Mapping[str, Any]) -> str:
    payload = namespace.encode("ascii") + b"\0" + canonical_json_bytes(value)
    return "sha256:" + hashlib.sha256(payload).hexdigest()


PINNED_TOOLCHAIN_MANIFEST = {
    "python": EXPECTED_TOOLCHAIN["python"],
    "build123d": EXPECTED_TOOLCHAIN["build123d"],
    "cadquery-ocp-novtk": EXPECTED_TOOLCHAIN["cadquery-ocp-novtk"],
    "geometry_backend": "OCCT via cadquery-ocp-novtk",
}
PINNED_RECIPE_DIGEST = _manifest_digest(
    "piton.precision-worker-recipe.v1",
    {
        "worker_pin": PRECISION_WORKER_PIN,
        "entrypoint": "piton.precision_worker:execute_precision_worker",
        "outputs": list(EXPECTED_OUTPUTS),
    },
)
PINNED_TOOLCHAIN_DIGEST = _manifest_digest(
    "piton.precision-worker-toolchain.v1", PINNED_TOOLCHAIN_MANIFEST
)
PINNED_CAPABILITY_DIGEST = _manifest_digest(
    "piton.precision-worker-capabilities.v1",
    {
        "isolation_class": "trusted-local",
        # Capabilities describe the directly callable worker. Network isolation
        # is launch-specific evidence, not an intrinsic worker capability.
        "network_isolation_proven": False,
        "credential_isolation_proven": False,
        "database_access": False,
        "authored_state_mutation": False,
        "lifecycle_state_mutation": False,
    },
)
PINNED_RESOURCE_LIMITS_DIGEST = _manifest_digest(
    "piton.precision-worker-resources.v1",
    {"attempt_scoped_output": True, "existing_output_policy": "refuse", "output_count": 7},
)
EXPECTED_OUTPUTS_DIGEST = _manifest_digest(
    "piton.precision-worker-expected-outputs.v1",
    {"roles": list(EXPECTED_OUTPUTS), "units": "mm"},
)


def validate_precision_worker_bindings(
    attempt: DurableBuildAttempt,
    state: CoordinatorState,
    revision: DesignRevision,
    inputs: RealizationInputs,
) -> None:
    if not isinstance(attempt, DurableBuildAttempt):
        raise TypeError("attempt must be a DurableBuildAttempt")
    if not isinstance(state, CoordinatorState):
        raise TypeError("state must be a CoordinatorState")
    if not isinstance(revision, DesignRevision):
        raise TypeError("revision must be a DesignRevision")
    if not isinstance(inputs, RealizationInputs):
        raise TypeError("inputs must be RealizationInputs")
    if attempt.admission_state != "admitted":
        raise ValueError("build attempt is not durably admitted")
    if not attempt.project_id:
        raise ValueError("project binding must be non-empty")
    if attempt.revision_id != revision.revision_id or revision.revision_id != inputs.revision.revision_id:
        raise ValueError("revision binding does not match exact admitted inputs")
    if attempt.input_manifest_digest != revision.source_manifest_digest:
        raise ValueError("input manifest does not match the exact revision")
    if state.attempt_id != attempt.attempt_id:
        raise ValueError("coordinator attempt does not match durable attempt")
    if state.state != "running":
        raise ValueError("coordinator state must be running before worker execution")
    if state.lease_id is None or not state.lease_id:
        raise ValueError("coordinator lease is required")
    if state.lease_expires_at is None or not state.lease_expires_at:
        raise ValueError("coordinator lease expiry is required")
    if type(state.generation) is not int or state.generation < 0:
        raise ValueError("coordinator generation must be non-negative")
    if type(state.fence) is not int or state.fence < 0:
        raise ValueError("coordinator fence must be non-negative")
    expected_attempt = {
        "recipe_digest": PINNED_RECIPE_DIGEST,
        "toolchain_digest": PINNED_TOOLCHAIN_DIGEST,
        "capability_manifest_digest": PINNED_CAPABILITY_DIGEST,
        "resource_limits_digest": PINNED_RESOURCE_LIMITS_DIGEST,
        "expected_outputs_digest": EXPECTED_OUTPUTS_DIGEST,
    }
    for field_name, expected in expected_attempt.items():
        if getattr(attempt, field_name) != expected:
            label = field_name.replace("_digest", "").replace("_", " ")
            raise ValueError(f"{label} does not match the pinned precision worker")
    if attempt.worker_id != PRECISION_WORKER_ID:
        raise ValueError("worker does not match the pinned precision worker")
    if attempt.isolation_class != "trusted-local":
        raise ValueError("worker execution must honestly declare trusted-local isolation")



def _read_regular_at(directory_fd: int, name: str) -> bytes:
    fd = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_fd,
    )
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError("worker artifact is not a regular file")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                return b"".join(chunks)
            chunks.append(chunk)
    finally:
        os.close(fd)


def _read_regular_path_at(directory_fd: int, relative_path: str) -> bytes:
    """Read one regular artifact while refusing symlinks in every path component."""
    parts = Path(relative_path).parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise ValueError("worker artifact path is not a safe relative path")
    current_fd = os.dup(directory_fd)
    try:
        for component in parts[:-1]:
            child_fd = os.open(
                component,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=current_fd,
            )
            os.close(current_fd)
            current_fd = child_fd
        return _read_regular_at(current_fd, parts[-1])
    finally:
        os.close(current_fd)


def _artifact_bytes(
    content: bytes, *, relative_path: str, media_type: str, claim_scope: str
) -> WorkerArtifact:
    return WorkerArtifact(
        relative_path=relative_path,
        digest="sha256:" + hashlib.sha256(content).hexdigest(),
        byte_length=len(content),
        media_type=media_type,
        claim_scope=claim_scope,
        units="mm",
    )


def _result(
    request: PrecisionWorkerRequest,
    *,
    status: str,
    toolchain: Mapping[str, Any],
    environment: Mapping[str, Any],
    artifacts: Mapping[str, WorkerArtifact],
    diagnostics: tuple[str, ...],
) -> PrecisionWorkerResult:
    return PrecisionWorkerResult(
        project_id=request.project_id,
        revision_id=request.revision_id,
        attempt_id=request.attempt_id,
        generation=request.generation,
        fence=request.fence,
        lease_id=request.lease_id,
        request_digest=request.request_digest,
        status=status,
        worker_id=request.worker_id,
        worker_pin=request.worker_pin,
        toolchain_digest=request.toolchain_digest,
        isolation_class="trusted-local",
        authenticated=False,
        result_signature_ref=None,
        toolchain=toolchain,
        environment=environment,
        artifacts=artifacts,
        diagnostics=diagnostics,
        expected_output_closure=status == "succeeded",
    )


def _sanitized_diagnostic(error: BaseException) -> str:
    text = str(error)
    if isinstance(error, FileExistsError):
        return "attempt output already exists"
    if "toolchain mismatch" in text:
        return "exact realization blocked by toolchain mismatch"
    if isinstance(error, (ValueError, TypeError)):
        return "exact realization rejected immutable inputs"
    return "exact realization failed"


def _open_directory_at(parent_fd: int, name: str, *, create: bool) -> int:
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    try:
        return os.open(name, flags, dir_fd=parent_fd)
    except FileNotFoundError:
        if not create:
            raise WorkerOutputCustodyError("attempt output ancestor is missing") from None
        try:
            os.mkdir(name, mode=0o700, dir_fd=parent_fd)
        except FileExistsError:
            # A concurrent replacement must still pass the no-follow open below.
            pass
        try:
            return os.open(name, flags, dir_fd=parent_fd)
        except OSError as error:
            raise WorkerOutputCustodyError("attempt output ancestor is unsafe") from error
    except OSError as error:
        raise WorkerOutputCustodyError("attempt output ancestor is unsafe") from error


def _open_attempt_parent(control_root: Path, request: PrecisionWorkerRequest) -> int:
    """Pin every existing/created ancestor without following symbolic links."""
    if not isinstance(control_root, Path):
        raise TypeError("control_root must be a Path")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    try:
        current_fd = os.open(control_root, flags)
    except OSError as error:
        raise WorkerOutputCustodyError("precision control root is unsafe") from error
    try:
        for component in ("build-attempts", request.project_id):
            child_fd = _open_directory_at(current_fd, component, create=True)
            os.close(current_fd)
            current_fd = child_fd
        return current_fd
    except BaseException:
        os.close(current_fd)
        raise


def _attempt_entry_kind(parent_fd: int, attempt_id: str) -> str:
    try:
        metadata = os.stat(attempt_id, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        return "missing"
    if stat.S_ISLNK(metadata.st_mode):
        return "unsafe"
    return "existing"


def preflight_precision_output_custody(
    request: PrecisionWorkerRequest, control_root: Path
) -> PrecisionWorkerResult | None:
    """Fail closed before sandbox work when the canonical destination is unavailable."""
    try:
        parent_fd = _open_attempt_parent(control_root, request)
    except WorkerOutputCustodyError:
        return _result(
            request,
            status="blocked",
            toolchain={},
            environment={},
            artifacts={},
            diagnostics=("attempt output custody is unsafe",),
        )
    try:
        entry_kind = _attempt_entry_kind(parent_fd, request.attempt_id)
    finally:
        os.close(parent_fd)
    if entry_kind == "missing":
        return None
    diagnostic = (
        "attempt output custody is unsafe"
        if entry_kind == "unsafe"
        else "attempt output already exists"
    )
    return _result(
        request,
        status="blocked",
        toolchain={},
        environment={},
        artifacts={},
        diagnostics=(diagnostic,),
    )


def execute_precision_worker(
    request: PrecisionWorkerRequest,
    revision: DesignRevision,
    inputs: RealizationInputs,
    control_root: Path,
) -> PrecisionWorkerResult:
    """Execute the one pinned realization without publishing or mutating custody."""
    try:
        parent_fd = _open_attempt_parent(control_root, request)
    except WorkerOutputCustodyError:
        return _result(
            request,
            status="blocked",
            toolchain={},
            environment={},
            artifacts={},
            diagnostics=("attempt output custody is unsafe",),
        )
    output_directory = control_root / "build-attempts" / request.project_id / request.attempt_id
    attempt_fd: int | None = None
    try:
        entry_kind = _attempt_entry_kind(parent_fd, request.attempt_id)
        if entry_kind == "unsafe":
            return _result(
                request,
                status="blocked",
                toolchain={},
                environment={},
                artifacts={},
                diagnostics=("attempt output custody is unsafe",),
            )
        if entry_kind == "existing":
            return _result(
                request,
                status="blocked",
                toolchain={},
                environment={},
                artifacts={},
                diagnostics=("attempt output already exists",),
            )
        realized = realize_exact(
            revision,
            inputs,
            output_directory,
            parent_fd=parent_fd,
        )
        if not isinstance(realized, tuple):
            raise TypeError("descriptor-relative realization did not retain custody")
        receipt, attempt_fd = realized
        pinned_output_directory = Path(f"/proc/self/fd/{attempt_fd}")
        exact_brep_bytes = _read_regular_at(attempt_fd, EXACT_BREP_NAME)
        exact_receipt_bytes = _read_regular_at(attempt_fd, RECEIPT_NAME)
        review = derive_review_derivatives(
            DerivativeSource(
                revision_id=request.revision_id,
                build_attempt_scope=request.attempt_id,
                exact_brep_digest="sha256:" + hashlib.sha256(exact_brep_bytes).hexdigest(),
                exact_receipt_digest="sha256:" + hashlib.sha256(exact_receipt_bytes).hexdigest(),
                exact_attempt_directory=pinned_output_directory,
            ),
            TessellationPolicy(),
            pinned_output_directory / "review",
        )
        review_paths = {
            "review_glb": "review/" + review["artifacts"]["glb"],
            "review_selection_map": "review/" + review["artifacts"]["selection_map"],
            "review_glb_receipt": "review/" + review["receipts"]["glb"],
            "review_selection_map_receipt": "review/" + review["receipts"]["selection_map"],
        }
        artifact_bytes = {
            "exact_brep": exact_brep_bytes,
            "step": _read_regular_at(attempt_fd, STEP_NAME),
            "inspection_receipt": exact_receipt_bytes,
            **{
                role: _read_regular_path_at(attempt_fd, relative_path)
                for role, relative_path in review_paths.items()
            },
        }
        artifacts = {
            "exact_brep": _artifact_bytes(
                artifact_bytes["exact_brep"],
                relative_path=EXACT_BREP_NAME,
                media_type="model/vnd.occt-brep",
                claim_scope=receipt["claim_scopes"]["exact_brep"],
            ),
            "step": _artifact_bytes(
                artifact_bytes["step"],
                relative_path=STEP_NAME,
                media_type="model/step",
                claim_scope=receipt["claim_scopes"]["step"],
            ),
            "inspection_receipt": _artifact_bytes(
                artifact_bytes["inspection_receipt"],
                relative_path=RECEIPT_NAME,
                media_type="application/json",
                claim_scope="attempt_bound_exact_inspection_receipt",
            ),
            "review_glb": _artifact_bytes(
                artifact_bytes["review_glb"],
                relative_path=review_paths["review_glb"],
                media_type="model/gltf-binary",
                claim_scope="review-only",
            ),
            "review_selection_map": _artifact_bytes(
                artifact_bytes["review_selection_map"],
                relative_path=review_paths["review_selection_map"],
                media_type="application/json",
                claim_scope="artifact-local-review-selection-only",
            ),
            "review_glb_receipt": _artifact_bytes(
                artifact_bytes["review_glb_receipt"],
                relative_path=review_paths["review_glb_receipt"],
                media_type="application/json",
                claim_scope="attempt_bound_review_artifact_receipt",
            ),
            "review_selection_map_receipt": _artifact_bytes(
                artifact_bytes["review_selection_map_receipt"],
                relative_path=review_paths["review_selection_map_receipt"],
                media_type="application/json",
                claim_scope="attempt_bound_review_artifact_receipt",
            ),
        }
        result = _result(
            request,
            status="succeeded",
            toolchain=receipt["toolchain"],
            environment={
                **receipt["environment"],
                "worker_pid": os.getpid(),
                "credential_environment_present": any(
                    name.upper().startswith(("AWS_", "GITHUB_", "INFISICAL_"))
                    or any(
                        marker in name.upper()
                        for marker in ("CREDENTIAL", "PASSWORD", "SECRET", "TOKEN")
                    )
                    for name in os.environ
                ),
                # Ambient child state is not launch authority. The worker
                # reports no network-isolation claim; the trusted parent may
                # add launch evidence only after successful sandbox execution.
                "network_isolation_proven": False,
                "credential_isolation_proven": False,
            },
            artifacts=artifacts,
            diagnostics=(),
        )
        destination = os.stat(request.attempt_id, dir_fd=parent_fd, follow_symlinks=False)
        retained = os.fstat(attempt_fd)
        if (destination.st_dev, destination.st_ino) != (retained.st_dev, retained.st_ino):
            raise WorkerOutputCustodyError("published attempt destination changed before closure")
        return verify_precision_worker_result(
            request,
            result,
            pinned_output_directory,
            pinned_directory_fd=attempt_fd,
            pinned_artifact_bytes=artifact_bytes,
        )
    except Exception as error:
        return _result(
            request,
            status="failed",
            toolchain={},
            environment={},
            artifacts={},
            diagnostics=(_sanitized_diagnostic(error),),
        )
    finally:
        if attempt_fd is not None:
            os.close(attempt_fd)
        os.close(parent_fd)


def verify_precision_worker_result(
    request: PrecisionWorkerRequest,
    result: PrecisionWorkerResult,
    output_directory: Path,
    *,
    pinned_directory_fd: int | None = None,
    pinned_artifact_bytes: Mapping[str, bytes] | None = None,
) -> PrecisionWorkerResult:
    """Verify an immutable result and complete output closure without side effects."""
    if not isinstance(request, PrecisionWorkerRequest):
        raise TypeError("request must be a PrecisionWorkerRequest")
    if not isinstance(result, PrecisionWorkerResult):
        raise TypeError("result must be a PrecisionWorkerResult")
    # Round-trip reconstruction verifies the result's canonical identity.
    PrecisionWorkerResult.from_manifest(json.loads(result.canonical_bytes))
    bindings = (
        (result.project_id, request.project_id),
        (result.revision_id, request.revision_id),
        (result.attempt_id, request.attempt_id),
        (result.generation, request.generation),
        (result.fence, request.fence),
        (result.lease_id, request.lease_id),
        (result.request_digest, request.request_digest),
        (result.worker_id, request.worker_id),
        (result.worker_pin, request.worker_pin),
        (result.toolchain_digest, request.toolchain_digest),
        (result.isolation_class, request.isolation_class),
    )
    if any(actual != expected for actual, expected in bindings):
        raise ValueError("result does not match its exact request bindings")
    if result.truth != request.truth:
        raise ValueError("result truth boundary does not match request")
    if result.environment.get("network_isolation_proven", False) is not False:
        raise ValueError("result overclaims network isolation")
    if result.environment.get("credential_isolation_proven", False) is not False:
        raise ValueError("result overclaims credential isolation")
    if result.status != "succeeded":
        if result.artifacts or result.expected_output_closure:
            raise ValueError("unsuccessful result claims output closure")
        return result
    if set(result.artifacts) != set(request.expected_outputs):
        raise ValueError("successful result does not close exactly the expected outputs")
    expected_artifact_metadata = {
        "exact_brep": (EXACT_BREP_NAME, "model/vnd.occt-brep", "exact_occt_brep_derived_realization"),
        "step": (STEP_NAME, "model/step", "derived_exchange_representation"),
        "inspection_receipt": (
            RECEIPT_NAME,
            "application/json",
            "attempt_bound_exact_inspection_receipt",
        ),
        "review_glb": (None, "model/gltf-binary", "review-only"),
        "review_selection_map": (
            None,
            "application/json",
            "artifact-local-review-selection-only",
        ),
        "review_glb_receipt": (
            "review/glb.receipt.json",
            "application/json",
            "attempt_bound_review_artifact_receipt",
        ),
        "review_selection_map_receipt": (
            "review/selection-map.receipt.json",
            "application/json",
            "attempt_bound_review_artifact_receipt",
        ),
    }
    for role, artifact in result.artifacts.items():
        expected_path, expected_media_type, expected_claim_scope = expected_artifact_metadata[role]
        if (
            (expected_path is not None and artifact.relative_path != expected_path)
            or artifact.media_type != expected_media_type
            or artifact.claim_scope != expected_claim_scope
            or artifact.units != "mm"
        ):
            raise ValueError("artifact metadata does not match its exact role")
    if dict(result.toolchain) != {
        "python": EXPECTED_TOOLCHAIN["python"],
        "build123d": EXPECTED_TOOLCHAIN["build123d"],
        "cadquery-ocp-novtk": EXPECTED_TOOLCHAIN["cadquery-ocp-novtk"],
    }:
        raise ValueError("result toolchain does not match the pinned exact toolchain")
    root = output_directory
    if pinned_directory_fd is None:
        if root.is_symlink() or not root.is_dir():
            raise ValueError("attempt output is not a real directory")
    else:
        if root != Path(f"/proc/self/fd/{pinned_directory_fd}"):
            raise ValueError("attempt output does not match its pinned directory")
        if not stat.S_ISDIR(os.fstat(pinned_directory_fd).st_mode):
            raise ValueError("pinned attempt output is not a directory")
    expected_paths = {
        "exact_brep": EXACT_BREP_NAME,
        "step": STEP_NAME,
        "inspection_receipt": RECEIPT_NAME,
        "review_glb": (
            "review/artifacts/sha256/"
            + result.artifacts["review_glb"].digest.removeprefix("sha256:")
            + "/part.glb"
        ),
        "review_selection_map": (
            "review/artifacts/sha256/"
            + result.artifacts["review_selection_map"].digest.removeprefix("sha256:")
            + "/selection-map.json"
        ),
        "review_glb_receipt": "review/glb.receipt.json",
        "review_selection_map_receipt": "review/selection-map.receipt.json",
    }
    observed_bytes: dict[str, bytes] = {}
    for role, artifact in result.artifacts.items():
        if artifact.relative_path != expected_paths[role]:
            raise ValueError("artifact role does not match its expected filename")
        if pinned_artifact_bytes is not None:
            content = pinned_artifact_bytes.get(role)
            if content is None:
                raise ValueError("pinned artifact bytes are incomplete")
        else:
            path = root / artifact.relative_path
            current = root
            for component in Path(artifact.relative_path).parts:
                current = current / component
                if current.is_symlink():
                    raise ValueError("artifact path contains a symbolic link")
            if not path.is_file():
                raise ValueError("artifact path is not a regular file")
            content = path.read_bytes()
        observed_bytes[role] = content
        digest = "sha256:" + hashlib.sha256(content).hexdigest()
        if len(content) != artifact.byte_length or digest != artifact.digest:
            raise ValueError("artifact digest or byte length does not match successful result")
    receipt = json.loads(observed_bytes["inspection_receipt"])
    if (
        receipt.get("schema") != "piton.exact-realization-receipt.v1"
        or receipt.get("status") != "succeeded"
        or receipt.get("attempt_scope") != request.attempt_id
        or receipt.get("artifacts") != {"exact_brep": EXACT_BREP_NAME, "step": STEP_NAME}
        or receipt.get("claim_scopes")
        != {
            "exact_brep": "exact_occt_brep_derived_realization",
            "step": "derived_exchange_representation",
        }
        or receipt.get("toolchain") != dict(result.toolchain)
        or receipt.get("units") != "mm"
    ):
        raise ValueError("inspection receipt does not match exact output closure")
    receipt_digests = receipt.get("artifact_digests", {})
    for role in ("exact_brep", "step"):
        observed_digest = "sha256:" + hashlib.sha256(observed_bytes[role]).hexdigest()
        if receipt_digests.get(role) != observed_digest:
            raise ValueError("inspection receipt artifact digest does not match output")

    exact_receipt_digest = "sha256:" + hashlib.sha256(
        observed_bytes["inspection_receipt"]
    ).hexdigest()
    exact_brep_digest = "sha256:" + hashlib.sha256(observed_bytes["exact_brep"]).hexdigest()
    review_receipts = {
        "glb": json.loads(observed_bytes["review_glb_receipt"]),
        "selection_map": json.loads(observed_bytes["review_selection_map_receipt"]),
    }
    review_artifact_roles = {
        "glb": "review_glb",
        "selection_map": "review_selection_map",
    }
    expected_review_claims = {
        "glb": "review-only",
        "selection_map": "artifact-local-review-selection-only",
    }
    for receipt_role, artifact_role in review_artifact_roles.items():
        review_receipt = review_receipts[receipt_role]
        artifact = result.artifacts[artifact_role]
        if (
            review_receipt.get("schema") != "piton.mesh-derivative-receipt.v1"
            or review_receipt.get("status") != "succeeded"
            or review_receipt.get("revision_id") != request.revision_id
            or review_receipt.get("source_build_attempt_scope") != request.attempt_id
            or review_receipt.get("source_exact_brep_digest") != exact_brep_digest
            or review_receipt.get("source_exact_receipt_digest") != exact_receipt_digest
            or review_receipt.get("artifact_role") != receipt_role
            or review_receipt.get("artifact_filename")
            != artifact.relative_path.removeprefix("review/")
            or review_receipt.get("artifact_digest") != artifact.digest
            or review_receipt.get("artifact_byte_length") != artifact.byte_length
            or review_receipt.get("claim_scope") != expected_review_claims[receipt_role]
            or review_receipt.get("review_state") != "needs_human_review"
            or review_receipt.get("fabrication_release") is not False
            or review_receipt.get("machine_actuation") is not False
        ):
            raise ValueError("review artifact receipt does not match exact output closure")
    if review_receipts["glb"].get("selection_map_digest") != result.artifacts[
        "review_selection_map"
    ].digest:
        raise ValueError("GLB receipt does not bind its artifact-local selection map")
    selection_map = json.loads(observed_bytes["review_selection_map"])
    if (
        selection_map.get("schema") != "piton.glb-selection-map.v1"
        or selection_map.get("revision_id") != request.revision_id
        or selection_map.get("source_build_attempt_scope") != request.attempt_id
        or selection_map.get("glb_digest") != result.artifacts["review_glb"].digest
        or selection_map.get("identity_scope")
        != "artifact-local; no durable topology identity; no nearest fallback"
        or not isinstance(selection_map.get("bindings"), list)
        or len(selection_map["bindings"]) != 1
    ):
        raise ValueError("review selection map does not match its artifact-local GLB")
    inspection = receipt.get("inspection", {})
    topology_counts = inspection.get("topology_counts", {})
    if inspection.get("valid") is not True or topology_counts.get("solids") != 1:
        raise ValueError("inspection receipt does not prove one valid solid")
    if not observed_bytes["step"].lstrip().startswith(b"ISO-10303-21;"):
        raise ValueError("STEP artifact does not match its media type")
    if receipt["revision_id"] != request.revision_id:
        raise ValueError("inspection receipt revision does not match request")
    if receipt["isolation_class"] != "trusted-local":
        raise ValueError("inspection receipt overclaims isolation")
    if (
        receipt["review_state"] != "needs_human_review"
        or receipt["fabrication_release"] is not False
        or receipt["machine_actuation"] is not False
    ):
        raise ValueError("inspection receipt violated the root truth boundary")
    return result
