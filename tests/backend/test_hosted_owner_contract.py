"""Regression tests for the hosted-plugin owner-scope handoff contract."""

from __future__ import annotations

import importlib.util
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


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


def _load_plugin_api():
    fastapi = types.ModuleType("fastapi")
    fastapi.APIRouter = _Router
    fastapi.HTTPException = _HTTPException
    fastapi.Request = object
    fastapi.Response = object
    previous = {name: sys.modules.get(name) for name in ("fastapi", "pty", "termios")}
    sys.modules["fastapi"] = fastapi
    # The contract tests only exercise plugin_api's ownership helper. The CLI
    # bridge is loaded as a sibling at import time, but its PTY support is not
    # available in the Windows runtime used by this test suite.
    sys.modules["pty"] = types.ModuleType("pty")
    sys.modules["termios"] = types.ModuleType("termios")
    try:
        path = Path(__file__).parents[2] / "server" / "judge-m-control-plane" / "dashboard" / "plugin_api.py"
        spec = importlib.util.spec_from_file_location("test_hosted_plugin_api", path)
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


plugin_api = _load_plugin_api()


class HostedOwnerContractTests(unittest.TestCase):
    def test_hosted_scope_accepts_only_parent_derived_scope(self):
        scope = "a" * 64
        request = _Request(hosted=True, headers={"x-hermes-owner-scope": scope})
        self.assertEqual(plugin_api._owner_key(request), scope)

    def test_hosted_scope_rejects_missing_or_malformed_header(self):
        for headers in ({}, {"x-hermes-owner-scope": "caller-choice"}):
            with self.assertRaises(plugin_api.HTTPException):
                plugin_api._owner_key(_Request(hosted=True, headers=headers))

    def test_loopback_mode_keeps_single_user_scope(self):
        request = _Request(auth_required=False, headers={"x-hermes-owner-scope": "caller-choice"})
        self.assertEqual(plugin_api._owner_key(request), "__single_user__")

    def test_model_preferences_survive_concurrent_atomic_writes(self):
        with tempfile.TemporaryDirectory(prefix="hermes-cockpit-preferences-") as folder:
            target = Path(folder) / "model-menu.json"
            with patch.object(plugin_api, "_preferences_file", return_value=target):
                payloads = [
                    {"version": 1, "provider_order": [f"provider-{index}"], "providers": {}}
                    for index in range(32)
                ]
                with ThreadPoolExecutor(max_workers=8) as workers:
                    list(workers.map(plugin_api._write_model_preferences, payloads))
                parsed = json.loads(target.read_text(encoding="utf-8"))
                self.assertIn(parsed, payloads)
                self.assertFalse(list(Path(folder).glob(".*.tmp")))


if __name__ == "__main__":
    unittest.main()
