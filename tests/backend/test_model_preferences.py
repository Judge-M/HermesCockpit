"""Exercise preference persistence without importing platform-specific CLI code."""

import ast
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).parents[2] / "server/judge-m-control-plane/dashboard/plugin_api.py"


class ModelPreferenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        # Compile the actual persistence helpers, bypassing only FastAPI route
        # registration and the Unix CLI bridge import on Windows.
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        names = {"_preferences_file", "_read_model_preferences", "_write_model_preferences"}
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        self.namespace = {
            "Path": Path, "Any": object, "hashlib": hashlib, "json": json,
            "os": os, "tempfile": tempfile, "threading": threading,
            "PREFERENCES_ROOT": self.root, "PREFERENCES_FILE": self.root / "model-menu.json",
            "_SINGLE_USER_OWNER_SCOPE": "__single_user__",
            "_PREFERENCE_LOCKS": {}, "_PREFERENCE_LOCKS_GUARD": threading.Lock(),
        }
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec"), self.namespace)

    def test_concurrent_same_owner_writes_are_complete_unique_and_clean(self):
        replace = os.replace
        staged = []
        barrier = threading.Barrier(12)
        payloads = [{"writer": index, "data": str(index) * 10000} for index in range(12)]

        def record_replace(source, destination):
            staged.append(str(source))
            # Every published document must be a whole submitted payload.
            self.assertIn(json.loads(Path(source).read_text(encoding="utf-8")), payloads)
            replace(source, destination)

        def write(payload):
            barrier.wait(timeout=10)
            self.namespace["_write_model_preferences"](payload, "owner-a")

        with patch.object(os, "replace", side_effect=record_replace):
            with ThreadPoolExecutor(max_workers=12) as pool:
                list(pool.map(write, payloads))
        self.assertEqual(len(set(staged)), 12)
        self.assertIn(self.namespace["_read_model_preferences"]("owner-a"), payloads)
        self.assertEqual(self.namespace["_read_model_preferences"]("owner-b"), {})
        self.assertEqual(list(self.root.glob(".*.tmp")), [])
        if os.name == "posix":
            self.assertEqual(self.namespace["_preferences_file"]("owner-a").stat().st_mode & 0o777, 0o600)

    def test_failed_replace_cleans_temp_and_preserves_existing_document(self):
        write = self.namespace["_write_model_preferences"]
        write({"value": "original"}, "owner-a")
        with patch.object(os, "replace", side_effect=OSError("replacement failed")):
            with self.assertRaises(OSError):
                write({"value": "replacement"}, "owner-a")
        self.assertEqual(self.namespace["_read_model_preferences"]("owner-a"), {"value": "original"})
        self.assertEqual(list(self.root.glob(".*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
