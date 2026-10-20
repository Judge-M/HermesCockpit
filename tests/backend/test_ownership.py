"""Focused ownership regression tests for the control-plane routing state."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).parents[2] / "server" / "judge-m-control-plane" / "semantic_routing.py"
SPEC = importlib.util.spec_from_file_location("test_semantic_routing", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
semantic_routing = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = semantic_routing
SPEC.loader.exec_module(semantic_routing)


class OwnershipTests(unittest.TestCase):
    def setUp(self) -> None:
        with semantic_routing._TRACE_LOCK:
            semantic_routing._TRACES.clear()
        with semantic_routing._ESCALATION_LOCK:
            semantic_routing._ESCALATIONS.clear()

    def test_traces_and_outcomes_are_owner_scoped(self) -> None:
        semantic_routing._trace({"profile": "default", "session_id": "same", "decision_id": "a"}, owner_id="owner-a")
        semantic_routing._trace({"profile": "default", "session_id": "same", "decision_id": "b"}, owner_id="owner-b")

        owner_a = semantic_routing.decision_traces(owner_id="owner-a")
        owner_b = semantic_routing.decision_traces(owner_id="owner-b")
        self.assertEqual([row["decision_id"] for row in owner_a], ["a"])
        self.assertEqual([row["decision_id"] for row in owner_b], ["b"])
        self.assertNotIn("_owner_scope", owner_a[0])

        self.assertTrue(semantic_routing.record_outcome(
            decision_id="a", outcome={"status": "completed"}, owner_id="owner-a",
        ))
        self.assertFalse(semantic_routing.record_outcome(
            decision_id="a", outcome={"status": "foreign"}, owner_id="owner-b",
        ))
        self.assertEqual(semantic_routing.decision_traces(owner_id="owner-a")[0]["outcome"]["status"], "completed")

    def test_escalation_budget_is_owner_scoped(self) -> None:
        config = semantic_routing.normalize_config({
            "enabled": True,
            "escalation": {"enabled": True, "max_per_session": 1, "error_threshold": 1},
        })
        candidates = [
            semantic_routing.Candidate("provider-a", "model-a"),
            semantic_routing.Candidate("provider-b", "model-b"),
        ]
        with patch.object(semantic_routing, "load_config", return_value=config):
            first = semantic_routing.evaluate_escalation(
                profile="default", session_id="same", current={"provider": "provider-a", "model": "model-a"},
                candidates=[candidate.public() for candidate in candidates], error_count=1, owner_id="owner-a",
            )
            exhausted = semantic_routing.evaluate_escalation(
                profile="default", session_id="same", current={"provider": "provider-a", "model": "model-a"},
                candidates=[candidate.public() for candidate in candidates], error_count=1, owner_id="owner-a",
            )
            foreign = semantic_routing.evaluate_escalation(
                profile="default", session_id="same", current={"provider": "provider-a", "model": "model-a"},
                candidates=[candidate.public() for candidate in candidates], error_count=1, owner_id="owner-b",
            )

        self.assertTrue(first["routed"])
        self.assertEqual(exhausted["reason"], "session escalation limit reached")
        self.assertTrue(foreign["routed"])

    def test_custom_endpoint_blocks_dns_rebinding_but_keeps_explicit_local_targets(self) -> None:
        semantic_routing._validate_custom_endpoint("http://127.0.0.1:11434/v1")
        semantic_routing._validate_custom_endpoint("http://10.0.0.8:8080/v1")

        private_result = (None, None, None, None, ("10.0.0.8", 443))
        with patch.object(semantic_routing.socket, "getaddrinfo", return_value=[private_result]):
            with self.assertRaises(ValueError):
                semantic_routing._validate_custom_endpoint("https://provider.example.test/v1")

        public_result = (None, None, None, None, ("203.0.113.10", 443))
        with patch.object(semantic_routing.socket, "getaddrinfo", return_value=[public_result]):
            with self.assertRaises(ValueError):
                semantic_routing._validate_custom_endpoint("http://provider.example.test/v1")


if __name__ == "__main__":
    unittest.main()
