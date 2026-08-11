"""Dependency-light launch custody for the precision-worker sandbox."""
from __future__ import annotations

import ctypes
import hashlib
import io
import os
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Mapping

from .revision import DesignRevision
from .worker_contracts import PrecisionWorkerRequest, canonical_json_bytes

SCHEMA = "piton.precision-worker-execution.v1"
_FIELDS = {
    "schema",
    "request",
    "revision",
    "repository_root",
    "control_root",
    "input_bundle_digest",
    "worker_payload_digest",
    "archive_digest",
    "bundle_files",
    "execution_digest",
}
_TRUTH = {
    "fabrication_release": False,
    "machine_actuation": False,
    "review_state": "needs_human_review",
}


def _manifest_digest(namespace: str, value: Mapping[str, Any]) -> str:
    payload = namespace.encode("ascii") + b"\0" + canonical_json_bytes(value)
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def _execution_digest(value: Mapping[str, Any]) -> str:
    unsigned = {name: item for name, item in value.items() if name != "execution_digest"}
    return _manifest_digest(SCHEMA, unsigned)


def _file_closure_digest(namespace: str, entries: list[dict[str, Any]]) -> str:
    if not entries:
        raise ValueError("precision worker file closure cannot be empty")
    return _manifest_digest(namespace, {"files": entries})


def _files(root: Path, *, python_payload: bool = False) -> list[tuple[str, bytes]]:
    entries: list[tuple[str, bytes]] = []
    package_root = root / "src" / "piton"
    search_root = package_root if python_payload else root
    for path in sorted(search_root.rglob("*")):

        metadata = path.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            raise ValueError("precision worker input bundle cannot contain symbolic links")
        if stat.S_ISDIR(metadata.st_mode):
            continue
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError("precision worker input bundle must contain only regular files")
        relative = path.relative_to(root).as_posix()
        if python_payload:
            if path.suffix != ".py" or not path.is_relative_to(package_root):
                continue
            package_relative = path.relative_to(package_root).as_posix()
            if package_relative == "worker_admission.py" or package_relative.startswith("service/"):
                continue
            relative = package_relative
        entries.append((relative, path.read_bytes()))
    return entries


def _digest_entries(namespace: str, entries: list[tuple[str, bytes]]) -> str:
    return _file_closure_digest(
        namespace,
        [
            {
                "path": name,
                "byte_length": len(content),
                "digest": "sha256:" + hashlib.sha256(content).hexdigest(),
            }
            for name, content in entries
        ],
    )


def bundle_file_manifest(root: Path) -> list[dict[str, Any]]:
    """Describe every admitted bundle byte for independent child verification."""
    return [
        {
            "path": name,
            "byte_length": len(content),
            "digest": "sha256:" + hashlib.sha256(content).hexdigest(),
        }
        for name, content in _files(root)
    ]


def input_bundle_digest(root: Path) -> str:
    """Digest every regular file in one closed, symlink-free execution bundle."""
    return _file_closure_digest(
        "piton.precision-worker-input-bundle.v1", bundle_file_manifest(root)
    )


def worker_payload_digest(root: Path) -> str:
    """Digest executable child files, excluding daemon-only admission and services."""
    return _digest_entries("piton.precision-worker-payload.v1", _files(root, python_payload=True))


def validate_admitted_worker_payload(
    worker_pin: str, observed_digest: str, admitted_payloads: Mapping[str, str]
) -> None:
    """Bind exact executable bytes to the independently admitted symbolic worker pin."""
    if admitted_payloads.get(worker_pin) != observed_digest:
        raise ValueError("executable payload does not match the admitted worker pin")


def stage_input_bundle(
    repository_root: Path, control_root: Path, revision: DesignRevision
) -> tuple[Path, str]:
    """Copy source/runtime inputs and validate all revision-bound bytes."""
    repository_root = repository_root.resolve(strict=True)
    staging_parent = control_root / "worker-inputs"
    staging_parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    bundle = Path(tempfile.mkdtemp(prefix="input-", dir=staging_parent))
    try:
        source_package = repository_root / "src" / "piton"
        if source_package.is_symlink() or not source_package.is_dir():
            raise ValueError("precision worker source package is not a real directory")
        if any(path.is_symlink() for path in source_package.rglob("*")):
            raise ValueError("precision worker source package cannot contain symbolic links")
        shutil.copytree(
            source_package,
            bundle / "src" / "piton",
            symlinks=False,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
        )
        for name in ("uv.lock", "pyproject.toml"):
            source = repository_root / name
            if source.is_symlink() or not source.is_file():
                raise ValueError("precision worker lock input is not a regular file")
            shutil.copyfile(source, bundle / name)
        expected = {
            "src/piton/parts/l_bracket.py": revision.source_manifest_digest,
            "uv.lock": revision.dependency_lock_digest,
            "pyproject.toml": revision.toolchain_lock_digest,
        }
        for relative, expected_digest in expected.items():
            observed = "sha256:" + hashlib.sha256((bundle / relative).read_bytes()).hexdigest()
            if observed != expected_digest:
                raise ValueError("precision worker snapshot does not match immutable revision")
        return bundle, input_bundle_digest(bundle)
    except BaseException:
        remove_input_bundle(bundle)
        raise


def remove_input_bundle(bundle: Path) -> None:
    """Remove one daemon-owned transient snapshot."""
    if not bundle.exists():
        return
    for path in bundle.rglob("*"):
        if path.is_dir() and not path.is_symlink():
            os.chmod(path, 0o700)
    os.chmod(bundle, 0o700)
    shutil.rmtree(bundle)


def execution_archive(bundle: Path) -> bytes:
    """Create a deterministic archive which will be sealed before launch."""
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, content in _files(bundle):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o400) << 16
            archive.writestr(info, content)
    return output.getvalue()


def _validated_bundle_files(value: Mapping[str, Any]) -> list[dict[str, Any]]:
    files = value.get("bundle_files")
    if not isinstance(files, list) or not files:
        raise ValueError("execution bundle file closure is invalid")
    normalized: list[dict[str, Any]] = []
    for entry in files:
        if not isinstance(entry, Mapping) or set(entry) != {"path", "byte_length", "digest"}:
            raise ValueError("execution bundle file closure is invalid")
        name = entry.get("path")
        length = entry.get("byte_length")
        digest = entry.get("digest")
        if (
            not isinstance(name, str)
            or not name
            or name.startswith("/")
            or name.endswith("/")
            or ".." in name.split("/")
            or "\\" in name
            or not isinstance(length, int)
            or isinstance(length, bool)
            or length < 0
            or not isinstance(digest, str)
            or len(digest) != 71
            or not digest.startswith("sha256:")
            or any(character not in "0123456789abcdef" for character in digest[7:])
        ):
            raise ValueError("execution bundle file closure is invalid")
        normalized.append({"path": name, "byte_length": length, "digest": digest})
    names = [entry["path"] for entry in normalized]
    if names != sorted(names) or len(set(names)) != len(names):
        raise ValueError("execution bundle file closure must be sorted and unique")
    return normalized


def validate_execution_archive(content: bytes, manifest: Mapping[str, Any]) -> None:
    """Verify exact regular-file closure and bytes before any code is imported."""
    expected = _validated_bundle_files(manifest)
    try:
        with zipfile.ZipFile(io.BytesIO(content), "r") as archive:
            members = archive.infolist()
            if [member.filename for member in members] != [entry["path"] for entry in expected]:
                raise ValueError("execution archive closure does not match bundle manifest")
            if len({member.filename for member in members}) != len(members):
                raise ValueError("execution archive closure contains duplicates")
            for member, entry in zip(members, expected, strict=True):
                mode = member.external_attr >> 16
                if (
                    member.create_system != 3
                    or not stat.S_ISREG(mode)
                    or member.compress_type != zipfile.ZIP_STORED
                    or member.flag_bits & 0x1
                ):
                    raise ValueError("execution archive members must be unencrypted regular files")
                payload = archive.read(member)
                if len(payload) != entry["byte_length"]:
                    raise ValueError("execution archive member length mismatch")
                if "sha256:" + hashlib.sha256(payload).hexdigest() != entry["digest"]:
                    raise ValueError("execution archive member digest mismatch")
    except zipfile.BadZipFile as error:
        raise ValueError("execution archive is not a valid ZIP") from error


def sealed_archive_fd(content: bytes) -> int:
    """Return a write-sealed memfd, immutable even to the launching same UID."""
    import ctypes
    import fcntl

    libc = ctypes.CDLL(None, use_errno=True)
    create = getattr(libc, "memfd_create", None)
    if create is None:
        raise RuntimeError("sealed memfd input custody is unavailable")
    create.argtypes = [ctypes.c_char_p, ctypes.c_uint]
    create.restype = ctypes.c_int
    fd = create(b"piton-worker-input", 0x0001 | 0x0002)
    if fd < 0:
        error_number = ctypes.get_errno()
        raise OSError(error_number, os.strerror(error_number))
    try:
        os.write(fd, content)
        os.lseek(fd, 0, os.SEEK_SET)
        seals = (
            getattr(fcntl, "F_SEAL_WRITE", 0x0008)
            | getattr(fcntl, "F_SEAL_GROW", 0x0004)
            | getattr(fcntl, "F_SEAL_SHRINK", 0x0002)
            | getattr(fcntl, "F_SEAL_SEAL", 0x0001)
        )
        fcntl.fcntl(fd, getattr(fcntl, "F_ADD_SEALS", 1033), seals)
        return fd
    except BaseException:
        os.close(fd)
        raise


def execution_manifest(
    request: PrecisionWorkerRequest,
    revision: DesignRevision,
    input_bundle_digest_value: str,
    worker_payload_digest_value: str,
    archive_digest_value: str,
    bundle_files_value: list[dict[str, Any]],
) -> dict[str, Any]:
    """Close daemon-custodied bindings to private sandbox paths."""
    value: dict[str, Any] = {
        "schema": SCHEMA,
        "request": request.to_manifest(),
        "revision": revision.to_manifest(),
        "repository_root": "/tmp/execution",
        "control_root": "/control",
        "input_bundle_digest": input_bundle_digest_value,
        "worker_payload_digest": worker_payload_digest_value,
        "archive_digest": archive_digest_value,
        "bundle_files": bundle_files_value,
    }
    value["execution_digest"] = _execution_digest(value)
    return value


def validate_execution_manifest(value: Mapping[str, Any]) -> None:
    if set(value) != _FIELDS or value.get("schema") != SCHEMA:
        raise ValueError("precision worker execution fields do not match schema v1")
    if value.get("execution_digest") != _execution_digest(value):
        raise ValueError("execution_digest does not match canonical execution content")
    if value.get("repository_root") != "/tmp/execution" or value.get("control_root") != "/control":
        raise ValueError("precision worker execution roots must be sandbox-fixed")
    files = _validated_bundle_files(value)
    if value.get("input_bundle_digest") != _file_closure_digest(
        "piton.precision-worker-input-bundle.v1", files
    ):
        raise ValueError("input bundle digest does not match bundle file closure")
    request = value.get("request")
    truth = request.get("truth") if isinstance(request, Mapping) else None
    if (
        not isinstance(truth, Mapping)
        or set(truth) != set(_TRUTH)
        or truth.get("fabrication_release") is not False
        or truth.get("machine_actuation") is not False
        or type(truth.get("review_state")) is not str
        or truth.get("review_state") != "needs_human_review"
    ):
        raise ValueError("precision worker execution changed root safety truth")


def sandbox_environment_evidence(*, network_namespace_unshared: bool) -> dict[str, Any]:
    """Report conservative public evidence; caller booleans cannot mint authority."""
    return {
        "network_isolation_proven": False,
        # Runtime roots remain broad and unmanifested; network isolation is not
        # credential isolation and cannot justify this stronger claim.
        "credential_isolation_proven": False,
        "truth": dict(_TRUTH),
    }


SANDBOX_BOOTSTRAP = r'''
import hashlib,json,os,stat,sys,zipfile
manifest=json.loads(sys.stdin.buffer.read(1048577).decode("utf-8"))
archive_path="/worker/archive.zip"
def validate_archive():
    unsigned={k:v for k,v in manifest.items() if k!="execution_digest"}
    canonical=(json.dumps(unsigned,sort_keys=True,separators=(",",":"),ensure_ascii=False)+"\n").encode()
    execution="sha256:"+hashlib.sha256(b"piton.precision-worker-execution.v1\0"+canonical).hexdigest()
    if execution!=manifest.get("execution_digest"):
        raise ValueError("execution manifest digest mismatch")
    raw=open(archive_path,"rb").read()
    if "sha256:"+hashlib.sha256(raw).hexdigest()!=manifest["archive_digest"]:
        raise ValueError("sealed archive digest mismatch")
    with zipfile.ZipFile(archive_path) as z:
        members=z.infolist()
        expected=manifest.get("bundle_files")
        if not isinstance(expected,list) or not expected:
            raise ValueError("invalid bundle manifest")
        names=[member.filename for member in members]
        expected_names=[entry.get("path") for entry in expected if isinstance(entry,dict)]
        if len(expected_names)!=len(expected) or names!=expected_names or len(names)!=len(set(names)):
            raise ValueError("invalid archive closure")
        validated=[]
        for member,entry in zip(members,expected):
            name=member.filename
            mode=member.external_attr>>16
            if (name.startswith("/") or name.endswith("/") or ".." in name.split("/") or "\\" in name
                or member.create_system!=3 or not stat.S_ISREG(mode)
                or member.compress_type!=zipfile.ZIP_STORED or member.flag_bits&1):
                raise ValueError("archive member is not a safe regular file")
            payload=z.read(member)
            if (set(entry)!={"path","byte_length","digest"} or len(payload)!=entry["byte_length"]
                or "sha256:"+hashlib.sha256(payload).hexdigest()!=entry["digest"]):
                raise ValueError("archive member does not match bundle manifest")
            validated.append((name,payload))
        closure=(json.dumps({"files":expected},sort_keys=True,separators=(",",":"),ensure_ascii=False)+"\n").encode()
        observed="sha256:"+hashlib.sha256(b"piton.precision-worker-input-bundle.v1\0"+closure).hexdigest()
        if observed!=manifest["input_bundle_digest"]:
            raise ValueError("input bundle closure digest mismatch")
        return validated
def extract_archive(validated):
    for name,payload in validated:
        destination="/tmp/execution/"+name
        parent=os.path.dirname(destination)
        os.makedirs(parent,mode=0o700,exist_ok=True)
        fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
        try:
            with os.fdopen(fd,"wb",closefd=False) as output:
                output.write(payload)
        finally:
            os.close(fd)
os.mkdir("/tmp/execution",0o700)
validated=validate_archive()
extract_archive(validated)
sys.path.insert(0,"/tmp/execution/src")
from piton import precision_worker_child
raise SystemExit(precision_worker_child.main(manifest))
'''.strip()


def sandbox_mount_arguments(
    archive_fd: int, isolated_output_root: Path, runtime_root: Path, virtual_environment: Path
) -> list[str]:
    """Compose mounts; only a private one-attempt staging tree is writable."""
    arguments = ["--ro-bind", "/usr", "/usr"]
    for system_path in (Path("/lib"), Path("/lib64")):
        if system_path.exists():
            arguments.extend(("--ro-bind", str(system_path), str(system_path)))
    if Path("/etc/fonts").is_dir():
        arguments.extend(("--dir", "/etc", "--ro-bind", "/etc/fonts", "/etc/fonts"))
    japanese_font_alias = Path("/etc/alternatives/fonts-japanese-gothic.ttf")
    if japanese_font_alias.is_file():
        arguments.extend(
            (
                "--dir",
                "/etc/alternatives",
                "--ro-bind",
                str(japanese_font_alias),
                str(japanese_font_alias),
            )
        )
    for root in dict.fromkeys((runtime_root, virtual_environment)):
        arguments.extend(("--ro-bind", str(root), str(root)))
    arguments.extend(
        (
            "--dir", "/worker",
            "--ro-bind-data", str(archive_fd), "/worker/archive.zip",
            "--dir", "/control",
            "--bind", str(isolated_output_root), "/control/build-attempts",
        )
    )
    return arguments


def create_isolated_output_root(control_root: Path) -> Path:
    parent = control_root / "worker-outputs"
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix="output-", dir=parent))


def publish_isolated_attempt(
    isolated_root: Path, canonical_root: Path, project_id: str, attempt_id: str
) -> Path:
    """Publish exactly one attempt with no-follow ancestry and no replacement."""
    source_project = isolated_root / project_id
    source_attempt = source_project / attempt_id
    if source_project.is_symlink() or source_attempt.is_symlink() or not source_attempt.is_dir():
        raise ValueError("sandbox did not produce exactly one real attempt directory")
    if {path.name for path in isolated_root.iterdir()} != {project_id}:
        raise ValueError("sandbox wrote outside its admitted project")
    if {path.name for path in source_project.iterdir()} != {attempt_id}:
        raise ValueError("sandbox wrote outside its admitted attempt")
    canonical_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root_fd = os.open(canonical_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    source_fd = os.open(source_project, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        try:
            os.mkdir(project_id, mode=0o700, dir_fd=root_fd)
        except FileExistsError:
            pass
        project_fd = os.open(
            project_id, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd
        )
        try:
            libc = ctypes.CDLL(None, use_errno=True)
            result = libc.renameat2(
                source_fd,
                os.fsencode(attempt_id),
                project_fd,
                os.fsencode(attempt_id),
                1,  # RENAME_NOREPLACE
            )
            if result != 0:
                error_number = ctypes.get_errno()
                raise FileExistsError(error_number, os.strerror(error_number), attempt_id)
        finally:
            os.close(project_fd)
    finally:
        os.close(source_fd)
        os.close(root_fd)
    return canonical_root / project_id / attempt_id
