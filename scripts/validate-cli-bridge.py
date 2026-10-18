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
assert len(module.CLI_ONLY_COMMANDS) == 43, "Native CLI-only registry changed without an inventory update"
assert len(module.PARTIAL_API_GAP_COMMANDS) == 127, "Partial-family gap registry changed without an inventory update"
assert not module.CLI_ONLY_COMMANDS & module.PARTIAL_API_GAP_COMMANDS, "Bridge registries overlap"
assert len(operations) == 170, f"Expected 170 operations, found {len(operations)}"
assert len(families) == 44, f"Expected 44 families, found {len(families)}"
assert all(operation["availability"] for operation in operations), "One or more reviewed commands are unavailable"
assert {operation["command"] for operation in operations} == module.ALLOWED_COMMANDS
assert sum(operation["coverage"] == "cli_only" for operation in operations) == 43
assert sum(operation["coverage"] == "partial_api_gap" for operation in operations) == 127
assert all(operation["confirmation"] for operation in operations if operation["risk"] == "high")

for command in module.ALLOWED_COMMANDS:
    parser, _metadata = module._load_parsers()[command]
    for action in parser._actions:
        if isinstance(action, module.argparse._SubParsersAction) or action.dest == "help" or action.help is module.argparse.SUPPRESS:
            continue
        module._path_policy(command, action)

required_partial_gaps = {
    "auth priority", "auth reset", "auth refresh", "auth upgrade",
    "profile alias", "profile purge-identity", "profile migrate-identity",
    "profile install", "profile update", "profile info",
    "sessions optimize", "sessions repair", "sessions set-journal-mode",
    "sessions recover", "sessions pin", "sessions unpin", "sessions pinned",
    "skills trust", "skills untrust", "skills publish",
    "skills snapshot export", "skills snapshot import", "skills update",
    "skills tap add", "skills tap remove", "skills repair-official",
    "mcp serve", "mcp configure", "mcp picker",
}
assert required_partial_gaps <= module.PARTIAL_API_GAP_COMMANDS

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

profile_parser, _metadata = module._load_parsers()["profile info"]
profile_name_action = next(action for action in profile_parser._actions if action.dest == "profile_name")
assert module._path_policy("profile info", profile_name_action) is None, "profile_name was misclassified as a file path"

trust_parser, _metadata = module._load_parsers()["skills trust"]
trust_path = next(action for action in trust_parser._actions if action.dest == "path")
try:
    module._clean_values("/etc", "path", False, module._path_policy("skills trust", trust_path))
except module.HTTPException as exc:
    assert exc.status_code == 422
else:
    raise AssertionError("Skills trust accepted a project path outside the reviewed roots")

profile_install_parser, _metadata = module._load_parsers()["profile install"]
profile_source = next(action for action in profile_install_parser._actions if action.dest == "source")
profile_source_policy = module._path_policy("profile install", profile_source)
assert module._clean_values("https://github.com/example/profile.git", "source", False, profile_source_policy)
try:
    module._clean_values("https://token@example.test/profile.git", "source", False, profile_source_policy)
except module.HTTPException as exc:
    assert exc.status_code == 422
else:
    raise AssertionError("Credential-bearing distribution URL was accepted")

snapshot_parser, _metadata = module._load_parsers()["skills snapshot export"]
snapshot_output = next(action for action in snapshot_parser._actions if action.dest == "output")
assert module._clean_values("-", "output", False, module._path_policy("skills snapshot export", snapshot_output)) == ["-"]

skills_update_operation = next(operation for operation in operations if operation["command"] == "skills update")
assert skills_update_operation["coverage"] == "partial_api_gap"
assert len(skills_update_operation["positionals"]) == 1
target_argument = skills_update_operation["positionals"][0]
assert target_argument["name"] == "name"
assert target_argument["label"] == "Target skill"
assert target_argument["kind"] == "text"
assert target_argument["required"] is False
force_argument = next(argument for argument in skills_update_operation["arguments"] if argument["name"] == "force")
assert force_argument["kind"] == "boolean"
assert force_argument["flags"] == ["--force"]
skills_update_parser, _metadata = module._load_parsers()["skills update"]
skills_update_argv, skills_update_redacted, skills_update_secrets = module._build_argv(
    "skills update",
    skills_update_parser,
    "default",
    {"force": True},
    {"name": "web-search"},
)
assert skills_update_argv == [
    module.HERMES_EXE, "--profile", "default", "skills", "update", "--force", "--", "web-search"
]
assert skills_update_redacted == skills_update_argv
assert skills_update_secrets == []

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

priority_parser, _metadata = module._load_parsers()["auth priority"]
priority_argv, priority_redacted, priority_secrets = module._build_argv(
    "auth priority",
    priority_parser,
    "default",
    {},
    {"provider": "openai", "target": "primary", "priority": 0},
)
assert priority_argv == [
    module.HERMES_EXE, "--profile", "default", "auth", "priority", "--", "openai", "primary", "0"
]
assert priority_redacted == priority_argv
assert priority_secrets == []

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

print(
    f"PASS: {len(operations)} operations "
    f"({len(module.CLI_ONLY_COMMANDS)} CLI-only + {len(module.PARTIAL_API_GAP_COMMANDS)} partial-family gaps); "
    f"{len(families)} families; executable, redaction, path, typed-argv, and option-boundary checks"
)
