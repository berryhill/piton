import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator

from piton.project_format import (
    ProjectFormatError,
    canonical_project_bytes,
    load_project_bytes,
    load_project_directory,
    project_digest,
)

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schemas" / "piton-project-v1.schema.json"
EXAMPLE_ROOT = ROOT / "examples" / "minimal-project"


class ProjectFormatTests(unittest.TestCase):
    def test_representative_project_validates_and_loads_immutably(self):
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
        raw = (EXAMPLE_ROOT / "piton.project.json").read_bytes()
        primitive = json.loads(raw)
        Draft202012Validator(schema).validate(primitive)

        project = load_project_bytes(raw)
        self.assertEqual("piton.project.v1", project.schema)
        self.assertEqual("source-native-python", project.authority.writable)
        self.assertEqual("needs_human_review", project.safety.review_state)
        self.assertFalse(project.safety.fabrication_release)
        self.assertFalse(project.safety.machine_actuation)
        with self.assertRaises(TypeError):
            project.records[0].payload["note"] = "mutated"

    def test_canonical_bytes_and_digest_ignore_object_and_record_order(self):
        source = json.loads((EXAMPLE_ROOT / "piton.project.json").read_text(encoding="utf-8"))
        reordered = dict(reversed(list(source.items())))
        reordered["records"] = list(reversed(source["records"]))
        reordered["source_files"] = list(reversed(source["source_files"]))

        left = load_project_bytes(json.dumps(source).encode())
        right = load_project_bytes(json.dumps(reordered).encode())
        self.assertEqual(canonical_project_bytes(left), canonical_project_bytes(right))
        self.assertEqual(project_digest(left), project_digest(right))

    def test_strict_json_rejections(self):
        valid = (EXAMPLE_ROOT / "piton.project.json").read_bytes()
        cases = {
            "duplicate JSON key": valid.replace(
                b'"schema":', b'"schema":"piton.project.v1","schema":', 1
            ),
            "UTF-8 BOM": b"\xef\xbb\xbf" + valid,
            "invalid UTF-8": valid[:-1] + b"\xff}",
            "non-finite number": valid.replace(b'"units": "mm"', b'"units": NaN'),
        }
        for message, raw in cases.items():
            with self.subTest(message=message):
                with self.assertRaisesRegex(ProjectFormatError, message):
                    load_project_bytes(raw)

    def test_non_nfc_identity_and_unsafe_paths_are_rejected(self):
        source = json.loads((EXAMPLE_ROOT / "piton.project.json").read_text(encoding="utf-8"))
        source["project_id"] = "cafe\u0301"
        with self.assertRaisesRegex(ProjectFormatError, "NFC"):
            load_project_bytes(json.dumps(source, ensure_ascii=False).encode())

        for path in ("../part.py", "/tmp/part.py", "source\\part.py", "source//part.py"):
            invalid = json.loads((EXAMPLE_ROOT / "piton.project.json").read_text())
            invalid["source_files"][0]["path"] = path
            with self.subTest(path=path):
                with self.assertRaisesRegex(ProjectFormatError, "portable relative POSIX path"):
                    load_project_bytes(json.dumps(invalid).encode())

    def test_directory_loader_verifies_regular_files_digests_and_symlinks(self):
        project = load_project_directory(EXAMPLE_ROOT)
        self.assertEqual("minimal-bracket", project.project_id)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "source").mkdir()
            (root / "locks").mkdir()
            source_bytes = b"def build():\n    return None\n"
            (root / "source" / "part.py").write_bytes(source_bytes)
            (root / "locks" / "dependencies.lock").write_bytes(
                (EXAMPLE_ROOT / "locks" / "dependencies.lock").read_bytes()
            )
            (root / "locks" / "toolchain.lock").write_bytes(
                (EXAMPLE_ROOT / "locks" / "toolchain.lock").read_bytes()
            )
            primitive = json.loads((EXAMPLE_ROOT / "piton.project.json").read_text())
            primitive["source_files"][0]["digest"] = "sha256:" + hashlib.sha256(source_bytes).hexdigest()
            (root / "piton.project.json").write_text(json.dumps(primitive), encoding="utf-8")
            load_project_directory(root)

            (root / "source" / "part.py").write_bytes(b"tampered\n")
            with self.assertRaisesRegex(ProjectFormatError, "digest mismatch"):
                load_project_directory(root)

            (root / "source" / "part.py").unlink()
            (root / "outside.py").write_bytes(source_bytes)
            (root / "source" / "part.py").symlink_to(root / "outside.py")
            with self.assertRaisesRegex(ProjectFormatError, "symlink"):
                load_project_directory(root)

    def test_unknown_records_are_preserved_but_cannot_override_root_safety(self):
        primitive = json.loads((EXAMPLE_ROOT / "piton.project.json").read_text())
        primitive["records"].append(
            {"record_id": "vendor.extension", "kind": "vendor.future/v9", "payload": {"z": 1, "a": [2, 3]}}
        )
        project = load_project_bytes(json.dumps(primitive).encode())
        round_trip = json.loads(canonical_project_bytes(project))
        record = next(item for item in round_trip["records"] if item["record_id"] == "vendor.extension")
        self.assertEqual({"a": [2, 3], "z": 1}, record["payload"])

        for field, unsafe in (
            ("fabrication_release", True),
            ("machine_actuation", True),
            ("review_state", "approved"),
        ):
            invalid = json.loads((EXAMPLE_ROOT / "piton.project.json").read_text())
            invalid["safety"][field] = unsafe
            with self.subTest(field=field):
                with self.assertRaisesRegex(ProjectFormatError, field):
                    load_project_bytes(json.dumps(invalid).encode())


if __name__ == "__main__":
    unittest.main()
