"""Regression tests for CLI-job ownership across hosted and local mounts."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import types
import unittest


class _Router:
    def __getattr__(self, _name):
        return lambda *args, **kwargs: (lambda function: function)


class _HTTPException(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class _Request:
    def __init__(self, *, auth_required=None, hosted=False, headers=None, session=None, principal=None):
        self.app = types.SimpleNamespace(state=types.SimpleNamespace(
            auth_required=auth_required, hosted_plugin_internal=hosted,
        ))
        self.state = types.SimpleNamespace(session=session, token_principal=principal, principal=None)
        self.headers = headers or {}


def _load_bridge():
    fastapi = types.ModuleType("fastapi")
    fastapi.APIRouter = _Router
    fastapi.HTTPException = _HTTPException
    fastapi.Request = object
    previous = {name: sys.modules.get(name) for name in ("fastapi", "pty", "termios")}
    sys.modules["fastapi"] = fastapi
    sys.modules["pty"] = types.ModuleType("pty")
    sys.modules["termios"] = types.ModuleType("termios")
    try:
        path = Path(__file__).parents[2] / "server" / "judge-m-control-plane" / "dashboard" / "cli_bridge.py"
        spec = importlib.util.spec_from_file_location("test_cli_owner_bridge", path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        for name, module in previous.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


bridge = _load_bridge()


class CliOwnerContractTests(unittest.TestCase):
    def test_hosted_scope_accepts_verified_parent_scope(self):
        scope = "b" * 64
        request = _Request(hosted=True, headers={"x-hermes-owner-scope": scope})
        self.assertEqual(bridge._owner_key(request), scope)

    def test_hosted_scope_rejects_caller_selected_scope(self):
        with self.assertRaises(bridge.HTTPException):
            bridge._owner_key(_Request(hosted=True, headers={"x-hermes-owner-scope": "caller-choice"}))

    def test_loopback_and_token_principal_modes_are_stable(self):
        self.assertEqual(bridge._owner_key(_Request(auth_required=False)), "__single_user__")
        principal = types.SimpleNamespace(provider="oidc", principal="user-7")
        owner = bridge._owner_key(_Request(principal=principal))
        self.assertEqual(owner, bridge._owner_key(_Request(principal=principal)))


if __name__ == "__main__":
    unittest.main()
