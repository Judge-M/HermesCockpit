"""Dependency-light contract checks for the Cockpit semantic router."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = Path(os.environ.get(
    "SEMANTIC_ROUTER_MODULE", ROOT / "server" / "judge-m-control-plane" / "semantic_routing.py",
))
SPEC = importlib.util.spec_from_file_location("cockpit_semantic_routing_test", MODULE_PATH)
assert SPEC and SPEC.loader
router = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = router
SPEC.loader.exec_module(router)


def config(**updates):
    value = router.normalize_config({
        "enabled": True,
        "decision_model": {"provider": "local", "model": "router", "adapter": "generic_structured"},
        "slots": {"primary": {"mode": "semantic"}, "subagent": {"mode": "semantic"}, "auxiliary": {}},
        "tool_routing": {"enabled": True, "max_tools": 3},
        **updates,
    })
    return value


cleaned = router.normalize_config({"enabled": 1, "policy": "bogus", "timeout_seconds": 999})
assert cleaned["enabled"] is True
assert cleaned["policy"] == "balanced"
assert cleaned["timeout_seconds"] == 30
assert router.ROUTER_TASK not in cleaned["slots"]["auxiliary"]
assert router.slot_mode(router.normalize_config({"enabled": True, "default_mode": "native"}), "primary") == "native"
assert router.slot_mode(router.normalize_config({"enabled": True, "default_mode": "semantic"}), "subagent") == "semantic"

try:
    router.normalize_config({"decision_model": {"endpoint": "http://169.254.169.254/latest"}})
    raise AssertionError("metadata endpoint was accepted")
except ValueError:
    pass
router.normalize_config({"decision_model": {"endpoint": "http://127.0.0.1:8000/v1"}})

selected, confidence, ordered = router._find_selected({
    "answer": {"choice": "local/fast"}, "probability": 0.75, "selected_tools": ["browser_open"]
})
assert selected == "local/fast" and confidence == 0.75 and ordered == ["browser_open"]

router.load_config = lambda _profile="default": config()
router._generic_decision = lambda *_args, **_kwargs: ("local/fast", None, [])
decision = router.decide(
    profile="default", slot="primary", task="", prompt="short task",
    candidates=[{"provider": "local", "model": "fast", "local": True}], native={},
)
assert decision["routed"] is True
assert decision["selected"] == {"provider": "local", "model": "fast", "label": "local/fast", "local": True}
assert "prompt" not in decision

local_rows, excluded, constraints = router._policy_filter(
    router._candidate_rows([
        {"provider": "local", "model": "verified", "local": True},
        {"provider": "custom", "model": "unknown", "local": False},
    ]), "local",
)
assert [row.model for row in local_rows] == ["verified"]
assert excluded == [{"candidate": "custom/unknown", "reason": "not_verified_local"}]
assert constraints == ["local_only"]

router._generic_decision = lambda *_args, **_kwargs: ("not/eligible", None, [])
router.load_config = lambda _profile="default": config(fallback={"provider": "local", "model": "safe"})
fallback = router.decide(
    profile="default", slot="primary", task="", prompt="fallback task",
    candidates=[{"provider": "local", "model": "safe", "local": True}], native={},
)
assert fallback["routed"] is True and fallback["fallback"] is True
assert fallback["selected"]["model"] == "safe"

router._generic_decision = lambda *_args, **_kwargs: ("", None, ["safe_tool"])
tools = [
    {"type": "function", "function": {"name": "safe_tool"}},
    {"type": "function", "function": {"name": "unused_tool"}},
]
routed, trace = router.route_tools(profile="default", prompt="use the safe tool", tools=tools)
assert [row["function"]["name"] for row in routed] == ["safe_tool"]
assert trace and trace["routed"] is True

router._generic_decision = lambda *_args, **_kwargs: ("memory/notes", None, [])
router.load_config = lambda _profile="default": config(memory_routing={"enabled": True, "allow_skip": True})
memory, trace = router.route_memory(profile="default", prompt="find my notes", sources=["notes", "builtin"])
assert memory == ["notes"] and trace and trace["category"] == "memory"

router.load_config = lambda _profile="default": config(escalation={
    "enabled": True, "max_per_session": 1, "error_threshold": 2,
    "allow_after_side_effects": False, "eligible_models": [],
})
blocked = router.evaluate_escalation(
    profile="default", session_id="test-side-effects", current={"provider": "local", "model": "fast"},
    candidates=[{"provider": "local", "model": "fast", "local": True}, {"provider": "local", "model": "quality", "local": True}],
    error_count=3, side_effects=True,
)
assert blocked["routed"] is False and "side-effecting" in blocked["reason"]

escalated = router.evaluate_escalation(
    profile="default", session_id="test-escalate", current={"provider": "local", "model": "fast"},
    candidates=[{"provider": "local", "model": "fast", "local": True}, {"provider": "local", "model": "quality", "local": True}],
    error_count=3, side_effects=False,
)
assert escalated["routed"] is True and escalated["apply"] == "next_turn_only"
assert escalated["replayed"] is False and escalated["side_effects_replayed"] is False

print("PASS: semantic routing modes, policy safety, fallback, tools, memory, and bounded escalation")
