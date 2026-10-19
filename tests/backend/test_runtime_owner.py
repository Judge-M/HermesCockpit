"""Regression coverage for authenticated runtime routing context."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import threading
import types
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parents[2]


def load_context():
    text = (ROOT / "server/hermes-runtime-patches/hosted-plugin-owner-scope.patch").read_text(encoding="utf-8")
    section = text.split("+++ b/hermes_cli/plugin_runtime_context.py\n", 1)[1]
    source = "\n".join(line[1:] for line in section.splitlines() if line.startswith("+"))
    module = types.ModuleType("review_native_owner_context")
    exec(compile(source, "hermes_cli/plugin_runtime_context.py", "exec"), module.__dict__)
    return module


context_module = load_context()


class RuntimeOwnerTests(unittest.TestCase):
    def test_owner_comes_from_native_session_and_ignores_payload_claim(self):
        record = {"session_key": "stored", "auth_user_id": "password:user-7"}
        server = types.SimpleNamespace(
            _sessions_lock=threading.RLock(), _sessions={"runtime": record},
            _session_auth_user_id=lambda row: row["auth_user_id"],
        )
        with patch.dict(sys.modules, {"tui_gateway.server": server}):
            context = context_module.routing_context({"session_id": "stored", "owner_scope": "forged"})
        expected = hashlib.sha256(json.dumps(
            {"issuer": "password", "subject": "user-7"}, sort_keys=True,
        ).encode()).hexdigest()
        self.assertEqual(context["owner_scope"], expected)
        self.assertEqual(context["session_id"], "runtime")
        self.assertTrue(context["_owner_context_verified"])

    def test_runtime_uses_the_owner_model_allow_list(self):
        spec = importlib.util.spec_from_file_location(
            "owner_runtime_plugin", ROOT / "server/judge-m-control-plane/__init__.py",
            submodule_search_locations=[str(ROOT / "server/judge-m-control-plane")],
        )
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {spec.name: module}):
            spec.loader.exec_module(module)
            catalog = {"providers": [{"slug": "p", "configured": True, "models": ["allowed", "excluded"]}],
                       "preferences": {"providers": {"p": {"enabled": True, "routing_models": ["allowed"]}}}}
            owner = "a" * 64
            with patch.object(module, "_catalog", return_value=catalog) as inventory, patch.object(
                module, "decide", return_value={"routed": False}
            ) as decide:
                module._model_route_middleware(
                    route={"provider": "p", "model": "allowed"}, slot="subagent",
                    owner_scope=owner, _owner_context_verified=True, session_id="runtime",
                )
            inventory.assert_called_once_with(owner)
            self.assertEqual(decide.call_args.kwargs["owner_id"], owner)
            self.assertEqual([row["model"] for row in decide.call_args.kwargs["candidates"]], ["allowed"])

    def test_unresolved_gateway_identity_retains_native_route(self):
        # Trust marker alone must not turn an unresolved owner into single-user mode.
        spec = importlib.util.spec_from_file_location(
            "unresolved_runtime_plugin", ROOT / "server/judge-m-control-plane/__init__.py",
            submodule_search_locations=[str(ROOT / "server/judge-m-control-plane")],
        )
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {spec.name: module}):
            spec.loader.exec_module(module)
            with patch.object(module, "_catalog") as inventory:
                result = module._model_route_middleware(
                    route={"provider": "p", "model": "native"}, slot="subagent",
                    owner_scope="__unresolved__", _owner_context_verified=True,
                )
            self.assertIsNone(result)
            inventory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
