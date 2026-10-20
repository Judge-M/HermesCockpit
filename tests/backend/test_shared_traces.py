"""Regression coverage for the shared semantic-routing module and trace store."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parents[2]
ROUTING_STATE_PATH = ROOT / "server" / "judge-m-control-plane" / "routing_state.py"
TEST_TEMP_ROOT = ROOT / "build" / "test-traces"
TEST_TEMP_ROOT.mkdir(parents=True, exist_ok=True)


def _load_routing_state(module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, ROUTING_STATE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class SharedTraceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(
            prefix="hermes-cockpit-traces-", dir=str(TEST_TEMP_ROOT), ignore_cleanup_errors=True,
        )
        self.db_path = Path(self.temp_dir.name) / "routing-traces.sqlite3"
        self.environment = patch.dict(
            os.environ,
            {
                "HERMES_HOME": str(Path(self.temp_dir.name) / "hermes-home"),
                "HERMES_ROUTING_TRACE_DB": str(self.db_path),
                "HERMES_ROUTING_TRACE_MEMORY_ONLY": "0",
            },
        )
        self.environment.start()
        self.state = _load_routing_state("test_shared_routing_state")
        self.semantic = self.state.load_semantic_routing()
        self.previous_state = getattr(self.semantic, "_ROUTING_STATE", None)
        self.semantic._ROUTING_STATE = self.state
        with self.semantic._TRACE_LOCK:
            self.semantic._TRACES.clear()

    def tearDown(self) -> None:
        if self.previous_state is None:
            self.semantic.__dict__.pop("_ROUTING_STATE", None)
        else:
            self.semantic._ROUTING_STATE = self.previous_state
        self.environment.stop()
        self.temp_dir.cleanup()

    def test_loader_reuses_resolved_module_and_store_is_owner_scoped(self) -> None:
        second_state = _load_routing_state("test_standalone_routing_state")
        second = second_state.load_semantic_routing()
        self.assertIs(self.semantic, second)
        self.assertEqual(
            Path(self.semantic.__file__).resolve(),
            ROOT / "server" / "judge-m-control-plane" / "semantic_routing.py",
        )

        self.semantic._trace(
            {
                "decision_id": "owner-a-decision",
                "profile": "default",
                "session_id": "shared-session",
                "prompt": "do not persist this prompt",
                "api_key": "do-not-persist-this-key",
                "nested": {
                    "messages": ["also private"],
                    "verdict": "a model response that must not persist",
                    "answer": "a copied answer",
                    "output": "a copied output",
                    "content": "a copied content",
                    "body": "a copied body",
                    "provider": "retain-provider-metric",
                    "status": "retain-status-metric",
                },
                "verdicts": [{"provider": "retain-provider", "model": "retain-model", "verdict": "private"}],
            },
            owner_id="owner-a",
        )
        self.assertEqual(
            [row["decision_id"] for row in second.decision_traces(owner_id="owner-a")],
            ["owner-a-decision"],
        )
        self.assertEqual(second.decision_traces(owner_id="owner-b"), [])
        self.assertTrue(
            second.record_outcome(
                decision_id="owner-a-decision",
                outcome={"status": "completed", "prompt": "ignored"},
                owner_id="owner-a",
            )
        )
        public = second.decision_traces(owner_id="owner-a")[0]
        self.assertEqual(public["outcome"], {"status": "completed"})
        self.assertNotIn("prompt", json.dumps(public))
        public_json = json.dumps(public)
        for private_value in (
            "do-not-persist-this-key", "also private", "model response", "copied answer",
            "copied output", "copied content", "copied body", "private",
        ):
            self.assertNotIn(private_value, public_json)
        self.assertEqual(public["nested"]["provider"], "retain-provider-metric")
        self.assertEqual(public["verdicts"][0]["provider"], "retain-provider")
        self.assertEqual(public["verdicts"][0]["model"], "retain-model")
        raw_db = self.db_path.read_bytes()
        for private_value in (
            b"do-not-persist-this-key", b"also private", b"model response", b"copied answer",
            b"copied output", b"copied content", b"copied body", b"private",
        ):
            self.assertNotIn(private_value, raw_db)

    def test_routed_hermes_home_precedes_legacy_environment_fallback(self) -> None:
        routed_home = Path(self.temp_dir.name) / "routed-profile"
        hermes_package = types.ModuleType("hermes_cli")
        hermes_package.__path__ = []
        config_module = types.ModuleType("hermes_cli.config")
        config_module.get_hermes_home = lambda: routed_home
        with patch.dict(
            sys.modules,
            {"hermes_cli": hermes_package, "hermes_cli.config": config_module},
        ), patch.dict(
            os.environ,
            {"HERMES_ROUTING_TRACE_DB": "", "HERMES_HOME": str(Path(self.temp_dir.name) / "legacy")},
        ):
            self.assertEqual(
                self.state._trace_db_path(),
                routed_home / "judge-m-control-plane" / "routing-traces.sqlite3",
            )

    def test_persistence_failure_is_explicitly_reported(self) -> None:
        with patch.object(self.state, "read_traces", return_value=None), patch.object(
            self.state, "trace_store_enabled", return_value=True,
        ):
            self.assertEqual(
                self.semantic.decision_traces(owner_id="owner-a"),
                [{
                    "category": "trace_store",
                    "available": False,
                    "reason": "routing trace history is unavailable",
                }],
            )

    def test_child_process_reads_and_writes_same_bounded_store(self) -> None:
        self.semantic._trace(
            {"decision_id": "parent-decision", "profile": "default"},
            owner_id="owner-a",
        )
        child = f"""
import importlib.util
import json
import sys
from pathlib import Path
path = Path({str(ROUTING_STATE_PATH)!r})
spec = importlib.util.spec_from_file_location('child_routing_state', path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
semantic = module.load_semantic_routing()
semantic._trace({{'decision_id': 'child-decision', 'profile': 'default'}}, owner_id='owner-b')
print(json.dumps({{
    'owner_a': semantic.decision_traces(owner_id='owner-a'),
    'owner_b': semantic.decision_traces(owner_id='owner-b'),
}}))
"""
        result = subprocess.run(
            [sys.executable, "-c", child],
            check=True,
            capture_output=True,
            text=True,
            env=os.environ.copy(),
        )
        output = json.loads(result.stdout)
        self.assertEqual([row["decision_id"] for row in output["owner_a"]], ["parent-decision"])
        self.assertEqual([row["decision_id"] for row in output["owner_b"]], ["child-decision"])
        self.assertEqual(
            [row["decision_id"] for row in self.semantic.decision_traces(owner_id="owner-b")],
            ["child-decision"],
        )

        for index in range(250):
            self.semantic._trace({"decision_id": f"bounded-{index}"}, owner_id="owner-a")
        self.assertLessEqual(len(self.semantic.decision_traces(owner_id="owner-a", limit=200)), 200)

    def test_global_safeguard_prefers_largest_owner_history(self) -> None:
        with patch.object(self.state, "TRACE_GLOBAL_LIMIT", 4):
            self.assertTrue(self.state.append_trace({"decision_id": "quiet", "_owner_scope": "b"}))
            for index in range(8):
                self.assertTrue(self.state.append_trace({"decision_id": f"busy-{index}", "_owner_scope": "a"}))
            self.assertEqual(
                [row["decision_id"] for row in self.state.read_traces(owner_scope="b")], ["quiet"],
            )
            self.assertEqual(
                [row["decision_id"] for row in self.state.read_traces(owner_scope="a")],
                ["busy-7", "busy-6", "busy-5"],
            )
            self.assertEqual(self.state.read_traces(owner_scope="foreign"), [])
        with patch.object(self.state, "TRACE_GLOBAL_LIMIT", 0):
            for index in range(5):
                self.assertTrue(self.state.append_trace({"decision_id": f"uncapped-{index}", "_owner_scope": "a"}))
            self.assertEqual(len(self.state.read_traces(owner_scope="a")), 8)

    def test_trace_retention_is_fair_between_owners(self) -> None:
        self.semantic._trace({"decision_id": "quiet-owner"}, owner_id="owner-b")
        for index in range(self.state.TRACE_LIMIT + 25):
            self.semantic._trace({"decision_id": f"noisy-{index}"}, owner_id="owner-a")

        owner_b = self.semantic.decision_traces(owner_id="owner-b")
        owner_a = self.semantic.decision_traces(owner_id="owner-a", limit=200)
        self.assertEqual([row["decision_id"] for row in owner_b], ["quiet-owner"])
        self.assertLessEqual(len(owner_a), self.state.TRACE_LIMIT)


if __name__ == "__main__":
    unittest.main()
