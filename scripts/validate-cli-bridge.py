"""Smoke-check the CLI bridge against an installed Hermes parser.

Run this inside the Hermes host/container. The bridge path may be supplied as
the first argument; otherwise the repository copy is used.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace


bridge_path = Path(sys.argv[1] if len(sys.argv) > 1 else "server/judge-m-control-plane/dashboard/cli_bridge.py")
spec = importlib.util.spec_from_file_location("judge_m_cli_bridge_validation", bridge_path)
if spec is None or spec.loader is None:
    raise SystemExit(f"Could not load {bridge_path}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

operations = module._operations()
families = {operation["family"] for operation in operations}
assert len(operations) == 43, f"Expected 43 operations, found {len(operations)}"
assert len(families) == 22, f"Expected 22 families, found {len(families)}"
assert all(operation["availability"] for operation in operations), "One or more reviewed commands are unavailable"

sample_job = {"output": ""}
module._append_output(sample_job, "token=supersecret123 Bearer abcdefghijklmnop")
assert "supersecret123" not in sample_job["output"]
assert "abcdefghijklmnop" not in sample_job["output"]

split_job = {"output": ""}
module._append_output(split_job, "api_")
module._append_output(split_job, "key=splitboundarysecret")
assert "splitboundarysecret" not in split_job["output"]

short_input_job = {"output": "already safe", "_raw_output": "already safe", "_input_redactions": ["a", "yes"]}
module._append_output(short_input_job, " and steady")
assert short_input_job["output"] == "already safe and steady"

placeholder_job = {"output": "", "_raw_output": "", "_input_redactions": ["reda"]}
module._append_output(placeholder_job, "reda")
module._append_output(placeholder_job, " again")
assert placeholder_job["output"] == "[redacted] again"

try:
    module._clean_values("/etc/shadow", "file_path", False, module.WORKSPACE_PATH_ROOTS)
except module.HTTPException as exc:
    assert exc.status_code == 422
else:
    raise AssertionError("Path outside the approved workspace roots was accepted")

try:
    module._clean_values("/root/.ssh/id_ed25519", "source", False, module.PATH_POLICIES[("claw migrate", "source")])
except module.HTTPException as exc:
    assert exc.status_code == 422
else:
    raise AssertionError("Sensitive root path was accepted through a non-obvious path field")

send_parser, _metadata = module._load_parsers()["send"]
send_option = next(action for action in send_parser._actions if action.option_strings and action.dest != "help")
message_action = next(action for action in send_parser._actions if action.dest == "message")
try:
    module._normalize_embedded_paths("send", message_action, ["MEDIA:/root/.ssh/id_ed25519"])
except module.HTTPException as exc:
    assert exc.status_code == 422
else:
    raise AssertionError("Sensitive path was accepted through an embedded MEDIA attachment")
try:
    module._validate_option_values(send_option, ["--hidden-flag"])
except module.HTTPException as exc:
    assert exc.status_code == 422
else:
    raise AssertionError("Option-like user data was accepted")

proxy_parser, _metadata = module._load_parsers()["proxy start"]
port_option = next(action for action in proxy_parser._actions if action.dest == "port")
try:
    module._validate_option_values(port_option, ["--hidden-flag"])
except module.HTTPException as exc:
    assert exc.status_code == 422
else:
    raise AssertionError("Option-like data bypassed validation through a numeric field")

assert all(operation["technical"]["argv_prefix"][0] == module.HERMES_EXE for operation in operations)

request_one = SimpleNamespace(state=SimpleNamespace(session=SimpleNamespace(provider="basic", user_id="owner-1", email="old@example.test")))
request_two = SimpleNamespace(state=SimpleNamespace(session=SimpleNamespace(provider="basic", user_id="owner-1", email="new@example.test")))
assert module._owner_key(request_one) == module._owner_key(request_two)

if len(sys.argv) > 2:
    plugin_path = Path(sys.argv[2])
    plugin_spec = importlib.util.spec_from_file_location("judge_m_control_plane_validation", plugin_path)
    if plugin_spec is None or plugin_spec.loader is None:
        raise SystemExit(f"Could not load {plugin_path}")
    plugin_module = importlib.util.module_from_spec(plugin_spec)
    sys.modules[plugin_spec.name] = plugin_module
    plugin_spec.loader.exec_module(plugin_module)
    mounted = {route.path for route in plugin_module.router.routes}
    expected_routes = {
        "/cli-operations",
        "/cli-operations/{operation_id}/run",
        "/cli-jobs",
        "/cli-jobs/{job_id}",
        "/cli-jobs/{job_id}/input",
    }
    assert expected_routes <= mounted, f"Missing mounted routes: {sorted(expected_routes - mounted)}"

print(f"PASS: {len(operations)} operations; {len(families)} families; executable, redaction, path, and option-boundary checks")
