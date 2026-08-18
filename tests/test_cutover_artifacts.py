"""Acceptance tests for the authority-cutover repository artifacts (task t_628e93a).

Cutover contract being pinned (docs/mvi-doctrine.md remains canonical and wins
conflicts):

- AC-1 baseline freeze: ``docs/baseline-freeze-8af59d7.md`` names the protected
  base SHA, the exact verification command set, and the safety truths.
- AC-2 migration inventory: ``docs/migration-inventory.md`` classifies every
  tracked file under exactly one cutover role, and the single writable-authority
  role is exactly the browser workbench surface (``browser-src/**``,
  ``tests-browser/**``, and the ``index.html`` Vite entry).
- AC-3 authority cutover: browser-authority statements remain intact and
  unweakened in the pinned authority documents.
- AC-5 safety truths: ``review_state=needs_human_review``,
  ``fabrication_release=false``, ``machine_actuation=false`` appear in both
  cutover artifacts.

These checks are repository-documentation verification only. They never mutate
authored revisions, review dispositions, approvals, exports, releases, or
machine actuation, and passing them implies none of those.
"""

from __future__ import annotations

import json
import re
import subprocess
from fnmatch import fnmatch
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BASELINE_DOC = REPO_ROOT / "docs" / "baseline-freeze-8af59d7.md"
INVENTORY_DOC = REPO_ROOT / "docs" / "migration-inventory.md"
VERIFY_REPO_SCRIPT = REPO_ROOT / "scripts" / "verify_repo.py"

PROTECTED_BASE_SHA = "8af59d7ecf3253beb644a6a3c747d771cc48a3f8"
PROTECTED_BASE_SUBJECT = "feat: ship browser-local Piton MVI (#64)"
CHAIN_BRANCH = "task-t_628e93a-t_628e93a"
AUTHORITY_PROFILE = "browser-typescript/v1"
ROLES_SCHEMA = "piton/cutover-roles/v1"
WRITABLE_AUTHORITY_ROLE = "primary-writable-authority-browser"

VERIFICATION_COMMANDS = (
    "pnpm typecheck",
    "pnpm test",
    "pnpm build",
    "pnpm test:e2e",
    "uv sync --frozen --all-extras",
    "uv run --frozen python -m piton.precision_worker_launch --preflight-sandbox",
    "uv run --frozen python -m pytest -q",
    "uv run --frozen python scripts/verify_repo.py",
)

SAFETY_TRUTHS = (
    "review_state=needs_human_review",
    "fabrication_release=false",
    "machine_actuation=false",
)

# AC-3: browser-authority statements that must remain intact. Single-line
# substrings only, so reflowed wording elsewhere cannot silently weaken them.
AUTHORITY_TEXT_PINS = {
    "README.md": (
        "Browser-local TypeScript under `browser-src/**` is the sole current "
        "product and writable revision authority.",
        "It is not a product, backend, adapter, verification authority, or "
        "writable authority for the browser MVI",
    ),
    "AGENTS.md": (
        "writable product authority in the runnable first slice",
    ),
    "docs/architecture.md": (
        "It is not a current product,",
        "backend, adapter, verification authority, or writable authority.",
        "one writable browser-local TypeScript authority",
    ),
    "docs/mvi-doctrine.md": (
        "One writable authority per revision. The runnable browser MVI authors",
        "Tracked Python/build123d material is pre-cutover",
        "backend, adapter, verification authority, or writable authority.",
    ),
    "docs/threat-model.md": (
        "browser-local TypeScript workbench and its sole writable "
        "authored-revision authority",
        "pre-cutover Python/build123d/OCP evidence lane",
    ),
    ".otoxan/rules/safety.md": (
        "sole writable Stage 1 product authority",
    ),
}

FORBIDDEN_CURRENT_ADAPTER_TEXT = "optional external exact-CAD/reference adapter"

ROLES_BLOCK_RE = re.compile(r"```json cutover-roles-v1\n(.*?)\n```", re.DOTALL)


def _tracked_files() -> list[str]:
    completed = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    )
    return sorted(path for path in completed.stdout.decode("utf-8").split("\0") if path)


def _pattern_matches(path: str, pattern: str) -> bool:
    # "some/dir/**" matches everything under that directory; anything else is
    # an exact name or fnmatch glob relative to the repository root.
    if pattern.endswith("/**"):
        return path.startswith(pattern[:-2])
    return fnmatch(path, pattern)


def _role_matches(path: str, role: dict) -> bool:
    included = any(_pattern_matches(path, item) for item in role["includes"])
    excluded = any(_pattern_matches(path, item) for item in role.get("excludes", []))
    return included and not excluded


def _load_roles_block() -> dict:
    text = INVENTORY_DOC.read_text(encoding="utf-8")
    match = ROLES_BLOCK_RE.search(text)
    assert match is not None, (
        "docs/migration-inventory.md must embed one "
        "```json cutover-roles-v1 block with the classification rules"
    )
    return json.loads(match.group(1))


def _browser_workbench_files(tracked: list[str]) -> set[str]:
    return {
        path
        for path in tracked
        if path.startswith("browser-src/")
        or path.startswith("tests-browser/")
        or path == "index.html"
    }


# ---------------------------------------------------------------------------
# AC-1: baseline freeze document
# ---------------------------------------------------------------------------


def test_cutover_artifacts_are_tracked() -> None:
    tracked = set(_tracked_files())
    for artifact in (BASELINE_DOC, INVENTORY_DOC, Path(__file__)):
        assert str(artifact.relative_to(REPO_ROOT)) in tracked, (
            f"{artifact.relative_to(REPO_ROOT)} must be a tracked repository file"
        )


def test_baseline_freeze_pins_protected_base() -> None:
    text = BASELINE_DOC.read_text(encoding="utf-8")
    assert PROTECTED_BASE_SHA in text, "baseline freeze must name the full protected base SHA"
    assert PROTECTED_BASE_SUBJECT in text, "baseline freeze must name the base commit subject"
    assert "origin/main" in text, "baseline freeze must state the base is the origin/main head"
    assert CHAIN_BRANCH in text, "baseline freeze must name the chain branch carrying the freeze"


def test_baseline_freeze_pins_verification_command_set() -> None:
    text = BASELINE_DOC.read_text(encoding="utf-8")
    missing = [command for command in VERIFICATION_COMMANDS if f"`{command}`" not in text]
    assert not missing, f"baseline freeze must list every verification command verbatim; missing: {missing}"


def test_baseline_freeze_pins_safety_truths() -> None:
    text = BASELINE_DOC.read_text(encoding="utf-8")
    for truth in SAFETY_TRUTHS:
        assert f"`{truth}`" in text, f"baseline freeze must state the safety truth {truth!r}"


def test_baseline_freeze_pins_one_writable_authority() -> None:
    text = BASELINE_DOC.read_text(encoding="utf-8")
    assert AUTHORITY_PROFILE in text, "baseline freeze must name the browser authority profile"
    assert "sole writable authored authority" in text, (
        "baseline freeze must state the browser surface is the sole writable authored authority"
    )


def test_baseline_freeze_disclaims_product_claims() -> None:
    text = BASELINE_DOC.read_text(encoding="utf-8")
    assert "repository verification evidence only" in text
    assert "carries no product claim scope" in text
    assert (
        "does not imply review acceptance, engineering approval, export, "
        "fabrication release, channel promotion, or machine actuation" in text
    ), "baseline freeze must restate the forbidden-implications chain disclaimers"


# ---------------------------------------------------------------------------
# AC-2 / AC-5: migration inventory document
# ---------------------------------------------------------------------------


def test_migration_inventory_roles_block_is_well_formed() -> None:
    block = _load_roles_block()
    assert block["schema"] == ROLES_SCHEMA
    assert block["base_sha"] == PROTECTED_BASE_SHA
    assert block["safety"] == {
        "review_state": "needs_human_review",
        "fabrication_release": False,
        "machine_actuation": False,
    }
    roles = block["roles"]
    assert roles, "roles block must define at least one role"
    names = [role["role"] for role in roles]
    assert len(names) == len(set(names)), "role names must be unique"
    assert "pre-cutover-python-legacy" in names
    assert "external-exact-cad-adapter" not in names
    for role in roles:
        assert role["includes"], f"role {role['role']} must declare includes"
        assert role.get("statement"), f"role {role['role']} must declare a statement"


def test_every_tracked_file_has_exactly_one_role() -> None:
    roles = _load_roles_block()["roles"]
    tracked = _tracked_files()
    unclassified: list[str] = []
    dual_classified: list[str] = []
    for path in tracked:
        matched = [role["role"] for role in roles if _role_matches(path, role)]
        if not matched:
            unclassified.append(path)
        elif len(matched) > 1:
            dual_classified.append(f"{path} -> {matched}")
    assert not unclassified, f"unclassified tracked files: {unclassified}"
    assert not dual_classified, f"dual-classified tracked files: {dual_classified}"


def test_migration_inventory_publication_counts_match_current_tree() -> None:
    text = INVENTORY_DOC.read_text(encoding="utf-8")
    block = _load_roles_block()
    tracked = _tracked_files()

    assert "current candidate HEAD" in block["candidate_head_note"]
    assert "first adds this inventory" not in block["candidate_head_note"]
    for role in block["roles"]:
        actual = sum(_role_matches(path, role) for path in tracked)
        assert role["files_at_publication"] == actual, (
            f"{role['role']} publication count must match the current tracked tree"
        )
        summary_row = rf"\| `{re.escape(role['role'])}` \| [^|\n]+ \| {actual} \|"
        assert re.search(summary_row, text), (
            f"{role['role']} summary count must match the machine-readable role block"
        )

    assert f"Total tracked files at the candidate HEAD: {len(tracked)}" in text


def test_writable_authority_role_is_exactly_the_browser_workbench() -> None:
    roles = _load_roles_block()["roles"]
    writable_roles = [role for role in roles if "writable" in role["role"]]
    assert [role["role"] for role in writable_roles] == [WRITABLE_AUTHORITY_ROLE], (
        "exactly one role may carry writable authority in its name"
    )
    authority_role = writable_roles[0]
    assert authority_role.get("authority_profile") == AUTHORITY_PROFILE
    tracked = _tracked_files()
    matched = {path for path in tracked if _role_matches(path, authority_role)}
    expected = _browser_workbench_files(tracked)
    assert matched == expected, (
        "the writable-authority role must match exactly browser-src/**, "
        f"tests-browser/**, and index.html; unexpected: {sorted(matched ^ expected)}"
    )


def test_migration_inventory_pins_safety_truths() -> None:
    text = INVENTORY_DOC.read_text(encoding="utf-8")
    for truth in SAFETY_TRUTHS:
        assert f"`{truth}`" in text, f"migration inventory must state the safety truth {truth!r}"


def test_migration_inventory_records_direct_entry_and_removed_shims() -> None:
    text = INVENTORY_DOC.read_text(encoding="utf-8")
    assert "src/main.tsx" in text and "src/App.tsx" in text
    assert "obsolete" in text and "forwarding shims were removed" in text
    assert '"role": "browser-entry-chain"' not in text
    assert not (REPO_ROOT / "src" / "main.tsx").exists()
    assert not (REPO_ROOT / "src" / "App.tsx").exists()


# ---------------------------------------------------------------------------
# AC-3: browser-authority statements stay intact
# ---------------------------------------------------------------------------


def test_browser_authority_statements_intact() -> None:
    for relative_path, pins in AUTHORITY_TEXT_PINS.items():
        text = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
        for pin in pins:
            assert pin in text, (
                f"{relative_path} must keep its browser-authority statement intact: {pin!r}"
            )
        assert FORBIDDEN_CURRENT_ADAPTER_TEXT not in text, (
            f"{relative_path} must not restore Python/build123d as a current adapter"
        )


# ---------------------------------------------------------------------------
# OQ-3: verify_repo.py pins the cutover artifacts (presence is load-bearing)
# ---------------------------------------------------------------------------


def test_verify_repo_pins_cutover_artifacts() -> None:
    text = VERIFY_REPO_SCRIPT.read_text(encoding="utf-8")
    for relative in (
        "docs/baseline-freeze-8af59d7.md",
        "docs/migration-inventory.md",
        "tests/test_cutover_artifacts.py",
    ):
        assert relative in text, f"scripts/verify_repo.py REQUIRED list must pin {relative}"
