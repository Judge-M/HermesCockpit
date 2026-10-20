"""Focused contract tests for the native browser.preview runtime patch."""

from __future__ import annotations

import base64
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parents[2]
PATCH_PATH = ROOT / "server" / "hermes-runtime-patches" / "browser-preview-gateway.patch"
FIXTURE_ROOT = ROOT / "hermes-v0.21.7"
FRONTEND_PATH = ROOT / "dist" / "hermes-client.js"


class _FakeSupervisor:
    task_id = "agent-1"

    def __init__(self, *, active=True):
        self.active = active
        self.frame_tree = {"top": {"url": "https://example.test/"}}

    def snapshot(self):
        return types.SimpleNamespace(active=self.active, frame_tree=self.frame_tree)


class _FakeCapture:
    page_session_id = "page-session"

    def __init__(self, frame: bytes):
        self.frame = frame

    def call(self, *_args, **_kwargs):
        return {"result": {"data": base64.b64encode(self.frame).decode("ascii")}}


class _FakeRegistry:
    def __init__(self, supervisor, frame):
        self.supervisor = supervisor
        self.capture_handle = _FakeCapture(frame)

    def get(self, key):
        return self.supervisor if key == self.supervisor.task_id else None

    def capture(self, key, **_kwargs):
        if key != self.supervisor.task_id:
            raise RuntimeError("wrong supervisor")
        return self.capture_handle


def _load_patched_handlers(*, frame=b"jpeg", transport=None):
    """Execute only the added patch body against native-style test doubles."""
    lines = PATCH_PATH.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line == "+_BROWSER_PREVIEW_FRAME_LIMIT = 2 * 1024 * 1024")
    end = next(i for i, line in enumerate(lines[start:], start) if line.startswith(" @_session_method"))
    source = "\n".join(line[1:] for line in lines[start:end] if line.startswith("+"))

    session_transport = transport or object()
    session = {
        "session_key": "canonical-session",
        "agent": types.SimpleNamespace(session_id="agent-1", task_id="agent-1"),
        "transport": session_transport,
    }
    sessions = {"runtime": session}
    registered = {}
    current = {"transport": session_transport}
    supervisor = _FakeSupervisor()
    browser_tool = types.ModuleType("tools.browser_tool")
    browser_tool._cleanup_lock = None
    browser_tool._active_sessions = {
        "agent-1": {"session_key": "agent-1", "owner_task_id": "canonical-session", "features": {}}
    }
    registry = _FakeRegistry(supervisor, frame)
    tools_package = types.ModuleType("tools")
    supervisor_module = types.ModuleType("tools.browser_supervisor")
    tools_package.browser_tool = browser_tool
    supervisor_module.SUPERVISOR_REGISTRY = registry

    def method(name):
        def decorate(function):
            registered[name] = function
            return function
        return decorate

    def _sess_nowait(params, rid):
        session_record = sessions.get(params.get("session_id"))
        return (session_record, None) if session_record else (None, {"error": rid})

    def _with_session(function):
        def handler(rid, params):
            session_record, error = _sess_nowait(params, rid)
            return error or function(rid, params, session_record)
        return handler

    namespace = {
        "method": method,
        "_with_session": _with_session,
        "_ok": lambda rid, result: {"id": rid, "result": result},
        "_err": lambda rid, code, message: {"id": rid, "error": {"code": code, "message": message}},
        "current_transport": lambda: current["transport"],
        "_stdio_transport": object(),
        "_session_transport_contains": lambda record, peer: peer is record.get("transport"),
    }
    with patch.dict(sys.modules, {
        "tools": tools_package,
        "tools.browser_tool": browser_tool,
        "tools.browser_supervisor": supervisor_module,
    }):
        exec(compile(source, str(PATCH_PATH), "exec"), namespace)
        return registered["browser.preview"], session, current, supervisor, {
            "tools": tools_package,
            "tools.browser_tool": browser_tool,
            "tools.browser_supervisor": supervisor_module,
        }


class BrowserPreviewPatchTests(unittest.TestCase):
    def test_patch_registers_authenticated_native_rpc(self):
        text = PATCH_PATH.read_text(encoding="utf-8")
        self.assertIn('@method("browser.preview")', text)
        self.assertIn("@_with_session", text)
        self.assertIn("_session_transport_contains(session, transport)", text)
        self.assertNotIn('"browser_session_id": browser_key', text)

    def test_authenticated_owner_can_capture_a_bounded_data_url(self):
        handler, _session, _current, _supervisor, modules = _load_patched_handlers()
        with patch.dict(sys.modules, modules):
            result = handler("request-1", {"session_id": "runtime", "profile": "default"})
        self.assertTrue(result["result"]["preview_ready"])
        self.assertEqual(result["result"]["data_url"], "data:image/jpeg;base64," + base64.b64encode(b"jpeg").decode())
        self.assertNotIn("browser_session_id", result["result"])

    def test_foreign_transport_is_rejected_before_browser_lookup(self):
        handler, _session, current, _supervisor, modules = _load_patched_handlers()
        current["transport"] = object()
        with patch.dict(sys.modules, modules):
            result = handler("request-2", {"session_id": "runtime", "profile": "default"})
        self.assertEqual(result["error"]["code"], 4001)

    def test_oversized_frame_fails_closed(self):
        handler, _session, _current, _supervisor, modules = _load_patched_handlers(
            frame=b"x" * (2 * 1024 * 1024 + 1)
        )
        with patch.dict(sys.modules, modules):
            result = handler("request-3", {"session_id": "runtime", "profile": "default"})
        self.assertFalse(result["result"]["preview_ready"])
        self.assertIsNone(result["result"]["data_url"])
        self.assertEqual(result["result"]["reason"], "frame_too_large")

    def test_patch_applies_cleanly_to_read_only_fixture(self):
        if not FIXTURE_ROOT.is_dir():
            self.skipTest("upstream fixture is not present")
        import subprocess

        check = subprocess.run(
            ["git", "apply", "--check", "--whitespace=error", str(PATCH_PATH)],
            cwd=FIXTURE_ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(check.returncode, 0, check.stderr)

    def test_frontend_uses_gateway_data_url_and_explicit_unavailable_state(self):
        text = FRONTEND_PATH.read_text(encoding="utf-8")
        browser_block = text.split("function renderBrowserPreview", 1)[1].split("function setWorkspaceMode", 1)[0]
        self.assertIn('gateway().call("browser.preview"', browser_block)
        self.assertIn("frame.src = session.data_url", browser_block)
        self.assertIn("Native browser preview unavailable", browser_block)
        self.assertNotIn("/browser-preview/", browser_block)


if __name__ == "__main__":
    unittest.main()
