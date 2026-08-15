from __future__ import annotations

import hashlib
import re
import stat
import tomllib
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from urllib.parse import urlsplit

_SCHEMA = "piton.first-party-supply-chain-gate.v1"
_EXACT_REQUIREMENT = re.compile(
    r"^(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)==(?P<version>[A-Za-z0-9][A-Za-z0-9._+-]*)$"
)
_ACTION_REFERENCE = re.compile(r"^\s*(?:-\s+)?uses:\s+([^\s#]+)", re.MULTILINE)
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_COMMIT = re.compile(r"^[0-9a-f]{40}$")

APPROVED_ACTIONS = MappingProxyType(
    {
        "actions/checkout": "11bd71901bbe5b1630ceea73d27597364c9af683",
        "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
        "actions/setup-python": "a26af69be951a213d495a4c3e4e4022e16d87065",
    }
)
APPROVED_WORKFLOWS = (".github/workflows/ci.yml",)
APPROVED_WORKFLOW_DIGESTS = MappingProxyType(
    {
        ".github/workflows/ci.yml": (
            "sha256:329957cbb183b3121089bfc2fefe0abdea218c0d81335906049a7549c3e11daa"
        )
    }
)
APPROVED_INSTALL_COMMANDS = (
    "python3 -m pip install uv==0.11.6",
    "uv pip install --python /tmp/piton-wheel-venv/bin/python dist/*.whl",
)


class SupplyChainViolation(ValueError):
    """A fail-closed violation of the repository supply-chain policy."""


@dataclass(frozen=True)
class SupplyChainGateReceipt:
    schema: str
    status: str
    policy_owner: str
    checked_workflows: tuple[str, ...]
    direct_dependencies: tuple[str, ...]
    input_digests: MappingProxyType[str, str]
    review_state: str = "needs_human_review"
    fabrication_release: bool = False
    machine_actuation: bool = False


def _digest(content: bytes) -> str:
    return "sha256:" + hashlib.sha256(content).hexdigest()


def _read_required(root: Path, path: Path) -> bytes:
    try:
        relative = path.relative_to(root)
    except ValueError as error:
        raise SupplyChainViolation(f"supply-chain input escapes repository root: {path}") from error

    try:
        current = root
        for component in relative.parts[:-1]:
            current = current / component
            if not stat.S_ISDIR(current.lstat().st_mode):
                raise SupplyChainViolation(
                    f"supply-chain input parent must be a real repository directory: {current}"
                )
        if not stat.S_ISREG(path.lstat().st_mode):
            raise SupplyChainViolation(
                f"supply-chain input must be a regular non-symlink repository file: {path}"
            )
        return path.read_bytes()
    except SupplyChainViolation:
        raise
    except (FileNotFoundError, IsADirectoryError, OSError) as error:
        raise SupplyChainViolation(f"required supply-chain input is missing: {path}") from error


def _direct_requirements(pyproject: dict[str, object]) -> tuple[str, ...]:
    build_system = pyproject.get("build-system")
    project = pyproject.get("project")
    if not isinstance(build_system, dict) or not isinstance(project, dict):
        raise SupplyChainViolation("pyproject must define build-system and project tables")

    raw: list[object] = list(build_system.get("requires", ()))
    raw.extend(project.get("dependencies", ()))
    optional = project.get("optional-dependencies", {})
    if not isinstance(optional, dict):
        raise SupplyChainViolation("project.optional-dependencies must be a table")
    for group in optional.values():
        if not isinstance(group, list):
            raise SupplyChainViolation("every optional dependency group must be a list")
        raw.extend(group)

    requirements: list[str] = []
    for requirement in raw:
        if not isinstance(requirement, str) or not _EXACT_REQUIREMENT.fullmatch(requirement):
            raise SupplyChainViolation(
                f"every direct dependency must be exactly pinned with name==version: {requirement!r}"
            )
        requirements.append(requirement)
    return tuple(
        sorted(
            set(requirements),
            key=lambda requirement: _EXACT_REQUIREMENT.fullmatch(requirement)["name"].lower(),
        )
    )


def _verify_lock(lock: dict[str, object], requirements: tuple[str, ...]) -> None:
    packages = lock.get("package")
    if not isinstance(packages, list):
        raise SupplyChainViolation("uv.lock must contain package records")

    locked: dict[tuple[str, str], dict[str, object]] = {}
    editable_packages: list[tuple[str, dict[str, object]]] = []
    for package in packages:
        if not isinstance(package, dict):
            raise SupplyChainViolation("uv.lock contains a malformed package record")
        name = package.get("name")
        version = package.get("version")
        source = package.get("source")
        if not isinstance(name, str) or not isinstance(version, str) or not isinstance(source, dict):
            raise SupplyChainViolation("uv.lock package identity/source is incomplete")

        key = (name.lower().replace("_", "-"), version)
        if key in locked:
            raise SupplyChainViolation(f"duplicate locked package identity: {name}=={version}")
        locked[key] = package

        if "editable" in source:
            editable_packages.append((name, source))
            continue
        if source != {"registry": "https://pypi.org/simple"}:
            raise SupplyChainViolation(f"unapproved lock source for {name}: {source!r}")

        artifacts = []
        sdist = package.get("sdist")
        if isinstance(sdist, dict):
            artifacts.append(sdist)
        wheels = package.get("wheels", ())
        if not isinstance(wheels, list) or any(not isinstance(item, dict) for item in wheels):
            raise SupplyChainViolation(f"wheel records are malformed for {name}")
        artifacts.extend(wheels)
        if not artifacts:
            raise SupplyChainViolation(f"lock package {name} has no hashed distribution artifact")
        for artifact in artifacts:
            digest = artifact.get("hash")
            url = artifact.get("url")
            if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
                raise SupplyChainViolation(f"lock package {name} has an invalid artifact hash")
            parsed_url = urlsplit(url) if isinstance(url, str) else None
            if (
                parsed_url is None
                or parsed_url.scheme != "https"
                or parsed_url.netloc != "files.pythonhosted.org"
                or not parsed_url.path.startswith("/packages/")
                or parsed_url.query
                or parsed_url.fragment
            ):
                raise SupplyChainViolation(f"lock package {name} has an unapproved artifact origin")

    if editable_packages != [("piton-cad", {"editable": "."})]:
        raise SupplyChainViolation(f"unapproved editable lock source: {editable_packages!r}")

    for requirement in requirements:
        match = _EXACT_REQUIREMENT.fullmatch(requirement)
        assert match is not None
        key = (match["name"].lower().replace("_", "-"), match["version"])
        if key not in locked:
            raise SupplyChainViolation(f"direct dependency is absent from uv.lock: {requirement}")


def _shell_logical_commands(lines: list[str]) -> tuple[str, ...]:
    """Collapse shell backslash continuations into reviewable logical commands."""

    commands: list[str] = []
    continued: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.endswith("\\"):
            continued.append(stripped[:-1].rstrip())
            continue
        if continued:
            continued.append(stripped)
            commands.append(" ".join(continued))
            continued = []
        else:
            commands.append(stripped)
    if continued:
        commands.append(" ".join(continued))
    return tuple(commands)


def _workflow_install_commands(text: str) -> tuple[str, ...]:
    lines = text.splitlines()
    commands: list[str] = []
    install = re.compile(r"(?:\bpip(?:\d+(?:\.\d+)*)?|\buv\s+tool)\s+install\b")
    index = 0
    while index < len(lines):
        match = re.match(r"^(?P<indent>\s*)run:\s*(?P<body>.*?)\s*$", lines[index])
        if match is None:
            index += 1
            continue
        body = match["body"]
        if re.fullmatch(r"[|>][+-]?", body):
            block_indent = len(match["indent"])
            block_lines: list[str] = []
            index += 1
            while index < len(lines):
                line = lines[index]
                stripped = line.strip()
                indentation = len(line) - len(line.lstrip())
                if stripped and indentation <= block_indent:
                    break
                if stripped:
                    block_lines.append(stripped)
                index += 1
            commands.extend(
                command
                for command in _shell_logical_commands(block_lines)
                if install.search(command)
            )
            continue
        if install.search(body):
            commands.append(body.strip())
        index += 1
    return tuple(commands)


def _verify_workflow(root: Path, path: Path) -> bytes:
    content = _read_required(root, path)
    text = content.decode("utf-8")
    permission_lines = [
        line for line in text.splitlines() if re.fullmatch(r"\s*permissions:\s*", line)
    ]
    if permission_lines != ["permissions:"] or not re.search(
        r"(?m)^permissions:\s*\n  contents:\s+read\s*$", text
    ):
        raise SupplyChainViolation(
            f"workflow must contain one repository-level permissions block with contents read: {path}"
        )
    if "uv sync --frozen --all-extras" not in text:
        raise SupplyChainViolation(f"workflow must install from the frozen complete lock: {path}")

    references = _ACTION_REFERENCE.findall(text)
    if not references:
        raise SupplyChainViolation(f"workflow has no approved immutable actions: {path}")
    for reference in references:
        action, separator, commit = reference.partition("@")
        if not separator or not _COMMIT.fullmatch(commit):
            raise SupplyChainViolation(
                f"workflow action must use an immutable 40-hex commit: {reference}"
            )
        if action not in APPROVED_ACTIONS:
            raise SupplyChainViolation(f"workflow action is not first-party-approved: {action}")
        if commit != APPROVED_ACTIONS[action]:
            raise SupplyChainViolation(
                f"workflow action does not use its approved commit: {reference}"
            )

    install_commands = _workflow_install_commands(text)
    if install_commands != APPROVED_INSTALL_COMMANDS:
        raise SupplyChainViolation(
            f"workflow install command inventory changed: {install_commands!r}"
        )
    relative_path = path.relative_to(root).as_posix()
    approved_digest = APPROVED_WORKFLOW_DIGESTS.get(relative_path)
    if approved_digest is None or _digest(content) != approved_digest:
        raise SupplyChainViolation(
            f"workflow does not match its approved content digest: {relative_path}"
        )
    return content


def verify_first_party_supply_chain(repository_root: Path) -> SupplyChainGateReceipt:
    """Verify immutable third-party inputs under Piton's first-party policy.

    The receipt is review evidence only. It never grants lifecycle, release, or
    machine authority.
    """

    root = repository_root.resolve()
    pyproject_path = root / "pyproject.toml"
    lock_path = root / "uv.lock"
    pyproject_bytes = _read_required(root, pyproject_path)
    lock_bytes = _read_required(root, lock_path)
    try:
        pyproject = tomllib.loads(pyproject_bytes.decode("utf-8"))
        lock = tomllib.loads(lock_bytes.decode("utf-8"))
    except (UnicodeDecodeError, tomllib.TOMLDecodeError) as error:
        raise SupplyChainViolation(f"supply-chain TOML is invalid: {error}") from error

    requirements = _direct_requirements(pyproject)
    _verify_lock(lock, requirements)

    workflow_paths = tuple(root / relative for relative in APPROVED_WORKFLOWS)
    actual_workflows = tuple(
        sorted(
            path.relative_to(root).as_posix()
            for path in (root / ".github" / "workflows").glob("*.y*ml")
            if path.is_file()
        )
    )
    if actual_workflows != APPROVED_WORKFLOWS:
        raise SupplyChainViolation(
            f"workflow inventory changed without policy review: {actual_workflows!r}"
        )
    workflow_bytes = tuple(_verify_workflow(root, path) for path in workflow_paths)

    inputs = (pyproject_path, lock_path, *workflow_paths)
    input_bytes = (pyproject_bytes, lock_bytes, *workflow_bytes)
    return SupplyChainGateReceipt(
        schema=_SCHEMA,
        status="pass",
        policy_owner="Piton maintainers",
        checked_workflows=APPROVED_WORKFLOWS,
        direct_dependencies=requirements,
        input_digests=MappingProxyType(
            {
                path.relative_to(root).as_posix(): _digest(content)
                for path, content in zip(inputs, input_bytes, strict=True)
            }
        ),
    )
