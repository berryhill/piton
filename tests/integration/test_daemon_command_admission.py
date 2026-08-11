"""Acceptance tests for secretless daemon-derived command identity."""

from __future__ import annotations

import os
import socket
import tempfile
import unittest
from pathlib import Path

from piton.service.daemon import CommandAdmissionError, LocalDaemonCommandAdapter
from piton.storage.db import Database


def source_tree_payload(source: str = "def build():\n    return None\n") -> dict[str, object]:
    return {
        "files": [
            {"path": "source/part.py", "content": source, "media_type": "text/x-python"},
            {
                "path": "locks/dependencies.lock",
                "content": "build123d==0.11.1\n",
                "media_type": "text/plain",
            },
            {
                "path": "locks/toolchain.lock",
                "content": "python==3.12.11\n",
                "media_type": "text/plain",
            },
        ],
        "entrypoint": "source/part.py:build",
        "dependency_lock": "locks/dependencies.lock",
        "toolchain_lock": "locks/toolchain.lock",
    }


class LocalDaemonCommandAdmissionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.server_socket, self.client_socket = socket.socketpair()
        self.adapter = LocalDaemonCommandAdapter.open(
            self.root, principal_ids_by_uid={os.getuid(): "operator_local"}
        )

    def tearDown(self) -> None:
        self.server_socket.close()
        self.client_socket.close()
        self.temporary_directory.cleanup()

    def execute(self, command_type: str, payload: dict[str, object]):
        return self.adapter.execute(
            self.server_socket, {"command_type": command_type, "payload": payload}
        )

    def test_peer_uid_is_mapped_inside_daemon_without_credentials_or_claimed_identity(self) -> None:
        receipt = self.execute(
            "create_project",
            {"command_id": "cmd_create", "project_id": "project_one", "display_name": "One"},
        )

        with Database(self.root / ".piton" / "piton.sqlite3").read() as connection:
            actor_id = connection.execute(
                "SELECT actor_id FROM command_receipts WHERE command_id=?", ("cmd_create",)
            ).fetchone()[0]
        self.assertEqual(actor_id, "operator_local")
        self.assertEqual(receipt.kind, "create_project")
        self.assertFalse(hasattr(self.adapter, "issue_principal_context"))
        self.assertFalse(hasattr(self.adapter, "principal_ids_by_uid"))

    def test_envelope_and_payload_are_closed_against_authority_shaped_fields(self) -> None:
        baseline = {
            "command_id": "cmd_create",
            "project_id": "project_one",
            "display_name": "One",
        }
        forbidden = (
            "actor",
            "principal_id",
            "credential",
            "grant",
            "policy",
            "approval",
            "release",
            "fabrication_release",
            "machine_actuation",
        )
        for field in forbidden:
            with self.subTest(field=field):
                with self.assertRaisesRegex(CommandAdmissionError, "closed schema"):
                    self.execute("create_project", {**baseline, field: "forged"})
        with self.assertRaisesRegex(CommandAdmissionError, "closed schema"):
            self.adapter.execute(
                self.server_socket,
                {
                    "command_type": "create_project",
                    "payload": baseline,
                    "principal_id": "forged",
                },
            )

    def test_server_owned_uid_mapping_is_copied_and_unknown_peer_fails_closed(self) -> None:
        mapping = {os.getuid(): "operator_local"}
        adapter = LocalDaemonCommandAdapter.open(self.root / "second", principal_ids_by_uid=mapping)
        mapping[os.getuid()] = "forged_after_composition"

        adapter.execute(
            self.server_socket,
            {
                "command_type": "create_project",
                "payload": {
                    "command_id": "cmd_second",
                    "project_id": "project_second",
                    "display_name": "Second",
                },
            },
        )
        with Database(self.root / "second" / ".piton" / "piton.sqlite3").read() as connection:
            actor_id = connection.execute(
                "SELECT actor_id FROM command_receipts WHERE command_id='cmd_second'"
            ).fetchone()[0]
        self.assertEqual(actor_id, "operator_local")

        denied = LocalDaemonCommandAdapter.open(self.root / "denied", principal_ids_by_uid={})
        with self.assertRaisesRegex(PermissionError, "not mapped"):
            denied.execute(
                self.server_socket,
                {
                    "command_type": "create_project",
                    "payload": {
                        "command_id": "cmd_denied",
                        "project_id": "project_denied",
                        "display_name": "Denied",
                    },
                },
            )

    def test_untrusted_mappings_reach_the_one_typed_command_service(self) -> None:
        created = self.execute(
            "create_project",
            {"command_id": "cmd_create", "project_id": "project_one", "display_name": "One"},
        )
        imported = self.execute(
            "import_source_base",
            {
                "command_id": "cmd_import",
                "project_id": "project_one",
                "source_tree": source_tree_payload(),
                "parameter_values": {"height": "10 mm"},
            },
        )
        draft = self.execute(
            "begin_draft",
            {
                "command_id": "cmd_begin",
                "project_id": "project_one",
                "base_revision_id": imported.persisted_revision_id,
                "expected_generation": 1,
            },
        )
        updated = self.execute(
            "update_draft",
            {
                "command_id": "cmd_update",
                "project_id": "project_one",
                "draft_id": draft.draft_id,
                "source_tree": source_tree_payload("def build():\n    return 1\n"),
            },
        )
        committed = self.execute(
            "commit_draft",
            {
                "command_id": "cmd_commit",
                "project_id": "project_one",
                "draft_id": draft.draft_id,
                "expected_revision_id": imported.persisted_revision_id,
                "expected_generation": 1,
                "parameter_values": {"height": "11 mm"},
            },
        )

        self.assertEqual(created.kind, "create_project")
        self.assertNotEqual(updated.content_digest, draft.content_digest)
        self.assertEqual(committed.parent_revision_id, imported.persisted_revision_id)
        self.assertFalse(committed.fabrication_release)
        self.assertFalse(committed.machine_actuation)
        self.assertEqual(committed.review_state, "needs_human_review")

    def test_unknown_command_and_malformed_source_tree_fail_before_effect(self) -> None:
        with self.assertRaisesRegex(CommandAdmissionError, "unsupported command type"):
            self.execute("approve", {})
        with self.assertRaisesRegex(CommandAdmissionError, "closed schema"):
            self.execute(
                "import_source_base",
                {
                    "command_id": "cmd_import",
                    "project_id": "project_one",
                    "source_tree": {**source_tree_payload(), "credential": "forged"},
                    "parameter_values": {},
                },
            )


if __name__ == "__main__":
    unittest.main()
