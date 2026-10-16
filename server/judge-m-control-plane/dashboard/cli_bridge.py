"""Authenticated, allowlisted Hermes CLI bridge for Judge-M Cockpit.

The dashboard plugin's authentication gate protects this router. Commands are
constructed from the installed argparse tree and executed directly with
``create_subprocess_exec``; user data is never evaluated by a shell.
"""

from __future__ import annotations

import argparse
import asyncio
from collections import OrderedDict
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import shutil
import signal
import termios
import time
from typing import Any
import uuid

from fastapi import APIRouter, HTTPException, Request


router = APIRouter()

HERMES_EXE = os.environ.get("HERMES_CLI_BRIDGE_EXECUTABLE") or shutil.which("hermes") or "/root/.local/bin/hermes"
OUTPUT_LIMIT = 256 * 1024
MAX_RUNNING_JOBS = 4
MAX_RETAINED_JOBS = 64
DEFAULT_TIMEOUT = 300
LONG_TIMEOUT = 24 * 60 * 60
PROFILE_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
ANSI_PATTERN = re.compile(r"\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
OUTPUT_ASSIGNMENT_PATTERN = re.compile(
    r"(?i)\b(password|passwd|secret|token|credential|authorization|api[_-]?key|private[_-]?key|client[_-]?secret)"
    r"([\s\"']*[:=][\s\"']*)([^\s,}\"']+)"
)
OUTPUT_BEARER_PATTERN = re.compile(
    r"(?i)\b(Bearer\s+|Basic\s+|sk-|sk_live_|ghp_|github_pat_|xox[baprs]-|AKIA)"
    r"[A-Za-z0-9+/_=.-]{8,}"
)

# Deliberately frozen against Hermes 0.21.7. New command paths remain denied
# until they are reviewed and added here.
ALLOWED_COMMANDS = {
    "browser close-profile",
    "codex-runtime migrate",
    "proxy start",
    "proxy status",
    "proxy providers",
    "lsp status",
    "lsp list",
    "lsp install",
    "lsp install-all",
    "lsp restart",
    "lsp which",
    "send",
    "pause",
    "resume",
    "verify",
    "approvals suggest",
    "approvals test",
    "import-agent",
    "console",
    "bundles list",
    "bundles show",
    "bundles create",
    "bundles delete",
    "bundles reload",
    "connectors list",
    "connectors accounts",
    "connectors connect",
    "connectors rename",
    "connectors disconnect",
    "usage",
    "claw migrate",
    "claw cleanup",
    "vault add",
    "vault list",
    "vault rm",
    "vault sources",
    "uninstall",
    "acp",
    "completion",
    "dashboard",
    "dashboard register",
    "serve",
    "desktop",
}

INTERACTIVE_COMMANDS = {
    "connectors connect",
    "claw migrate",
    "claw cleanup",
    "vault add",
    "uninstall",
    "console",
    "dashboard register",
}

LONG_RUNNING_COMMANDS = {
    "proxy start",
    "console",
    "acp",
    "dashboard",
    "serve",
    "desktop",
}

HIGH_RISK_CONFIRMATIONS = {
    "browser close-profile": "CLOSE BROWSER",
    "pause": "PAUSE HERMES",
    "bundles delete": "DELETE BUNDLE",
    "connectors disconnect": "DISCONNECT ACCOUNT",
    "claw cleanup": "CLEAN OPENCLAW",
    "vault rm": "DELETE VAULT ITEM",
    "uninstall": "UNINSTALL HERMES",
    "proxy start": "START PROXY",
    "acp": "START ACP",
    "dashboard": "START DASHBOARD",
    "serve": "START HERMES SERVER",
    "desktop": "START HERMES DESKTOP",
}

MEDIUM_RISK_WORDS = {
    "install", "install-all", "restart", "migrate", "create", "reload",
    "connect", "rename", "resume", "import-agent", "verify",
}

SENSITIVE_WORDS = ("password", "passwd", "secret", "token", "api_key", "apikey", "credential")
PATH_WORDS = ("path", "file", "dir", "directory", "cwd", "repo", "archive", "output")
AMBIGUOUS_PATH_NAMES = {"source", "target", "config", "manifest", "database", "db"}

_PARSER_CACHE: dict[str, tuple[argparse.ArgumentParser, dict[str, Any]]] | None = None
_JOBS: "OrderedDict[str, dict[str, Any]]" = OrderedDict()
_JOBS_LOCK = asyncio.Lock()

ACTIVE_JOB_STATES = {"queued", "starting", "running"}
WORKSPACE_PATH_ROOTS = tuple(Path(value) for value in (
    "/workspace", "/opt", "/srv", "/mnt", "/tmp", "/root/workspace", "/root/projects",
))
PATH_POLICIES = {
    ("send", "file"): WORKSPACE_PATH_ROOTS,
    ("verify", "path"): WORKSPACE_PATH_ROOTS,
    ("approvals suggest", "db"): (Path("/root/.hermes"),),
    ("claw migrate", "source"): (Path("/root/.openclaw"), *WORKSPACE_PATH_ROOTS),
    ("claw migrate", "workspace_target"): WORKSPACE_PATH_ROOTS,
    ("claw cleanup", "source"): (Path("/root/.openclaw"),),
    ("serve", "ssh_session_token_file"): (Path("/root/.hermes"), Path("/tmp")),
    ("desktop", "hermes_root"): (Path("/root/.hermes/hermes-agent"), *WORKSPACE_PATH_ROOTS),
    ("desktop", "cwd"): WORKSPACE_PATH_ROOTS,
}


def _json_value(value: Any) -> Any:
    if value is argparse.SUPPRESS:
        return None
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return str(value)


def _canonical_children(parser: argparse.ArgumentParser) -> list[tuple[str, list[str], argparse.ArgumentParser, str]]:
    result = []
    for action in parser._actions:
        if not isinstance(action, argparse._SubParsersAction):
            continue
        help_by_name = {item.dest: item.help for item in action._choices_actions}
        grouped: dict[int, dict[str, Any]] = {}
        for name, child in action.choices.items():
            grouped.setdefault(id(child), {"parser": child, "names": []})["names"].append(name)
        for group in grouped.values():
            names = group["names"]
            canonical = next((name for name in names if name in help_by_name), names[0])
            result.append((canonical, [name for name in names if name != canonical], group["parser"], help_by_name.get(canonical) or ""))
    return result


def _load_parsers() -> dict[str, tuple[argparse.ArgumentParser, dict[str, Any]]]:
    global _PARSER_CACHE
    if _PARSER_CACHE is not None:
        return _PARSER_CACHE

    from hermes_cli.main import _build_cli_parser

    root, _ = _build_cli_parser()
    found: dict[str, tuple[argparse.ArgumentParser, dict[str, Any]]] = {}

    def walk(parser: argparse.ArgumentParser, parts: tuple[str, ...] = ()) -> None:
        for name, aliases, child, help_text in _canonical_children(parser):
            child_parts = parts + (name,)
            command = " ".join(child_parts)
            found[command] = (child, {"aliases": aliases, "help": help_text})
            walk(child, child_parts)

    walk(root)
    _PARSER_CACHE = found
    return found


def _operation_id(command: str) -> str:
    return command.replace("-", "_").replace(" ", ".")


def _preferred_flag(action: argparse.Action) -> str:
    long_flags = [flag for flag in action.option_strings if flag.startswith("--")]
    return (long_flags or list(action.option_strings))[0]


def _is_sensitive(name: str) -> bool:
    lowered = name.lower()
    return any(word in lowered for word in SENSITIVE_WORDS)


def _argument_kind(action: argparse.Action) -> str:
    name = str(action.dest or "").lower()
    if _is_sensitive(name):
        return "secret"
    if isinstance(action, (argparse._StoreTrueAction, argparse._StoreFalseAction)):
        return "boolean"
    if action.choices is not None:
        return "choice"
    if action.type is int:
        return "integer"
    if action.type is float:
        return "number"
    if any(word in name for word in PATH_WORDS):
        return "path"
    return "text"


def _action_schema(action: argparse.Action, positional: bool) -> dict[str, Any]:
    name = str(action.dest)
    choices = None
    if action.choices is not None and not isinstance(action.choices, dict):
        try:
            choices = [_json_value(item) for item in list(action.choices)]
        except TypeError:
            choices = None
    multiple = action.nargs in ("+", "*") or isinstance(action, argparse._AppendAction)
    sensitive = _is_sensitive(name)
    default = None if sensitive else _json_value(action.default)
    return {
        "name": name,
        "label": name.replace("_", " ").strip().title(),
        "kind": _argument_kind(action),
        "required": bool(getattr(action, "required", False) or (positional and action.nargs not in ("?", "*"))),
        "choices": choices,
        "default": default,
        "help": "" if action.help is argparse.SUPPRESS else str(action.help or ""),
        "multiple": multiple,
        "nargs": _json_value(action.nargs),
        "flags": list(action.option_strings),
        "positional": positional,
        "sensitive": sensitive,
    }


def _risk_for(command: str) -> str:
    if command in HIGH_RISK_CONFIRMATIONS:
        return "high"
    leaf = command.split()[-1]
    return "medium" if leaf in MEDIUM_RISK_WORDS else "low"


def _operation(command: str, parser: argparse.ArgumentParser, metadata: dict[str, Any]) -> dict[str, Any]:
    options = []
    positionals = []
    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction) or action.dest == "help" or action.help is argparse.SUPPRESS:
            continue
        schema = _action_schema(action, not bool(action.option_strings))
        (positionals if schema["positional"] else options).append(schema)
    executable = PathLike(HERMES_EXE).is_executable()
    return {
        "id": _operation_id(command),
        "command": command,
        "title": (metadata.get("help") or command).strip(),
        "description": str(parser.description or metadata.get("help") or "").strip(),
        "family": command.split()[0],
        "aliases": metadata.get("aliases") or [],
        "risk": _risk_for(command),
        "confirmation": HIGH_RISK_CONFIRMATIONS.get(command),
        "interactive": command in INTERACTIVE_COMMANDS,
        "long_running": command in LONG_RUNNING_COMMANDS,
        "availability": executable,
        "unavailable_reason": "" if executable else f"Hermes executable not found at {HERMES_EXE}",
        "arguments": options,
        "positionals": positionals,
        "technical": {"argv_prefix": [HERMES_EXE, *command.split()]},
    }


class PathLike:
    """Tiny executable check wrapper kept isolated for straightforward tests."""

    def __init__(self, value: str):
        self.value = value

    def is_executable(self) -> bool:
        return os.path.isfile(self.value) and os.access(self.value, os.X_OK)


def _operations() -> list[dict[str, Any]]:
    parsers = _load_parsers()
    missing = sorted(ALLOWED_COMMANDS - set(parsers))
    operations = [
        _operation(command, *parsers[command])
        for command in sorted(ALLOWED_COMMANDS & set(parsers))
    ]
    if missing:
        for command in missing:
            operations.append({
                "id": _operation_id(command),
                "command": command,
                "title": command.replace("-", " ").title(),
                "description": "This reviewed command is not present in the installed Hermes parser.",
                "family": command.split()[0],
                "aliases": [],
                "risk": _risk_for(command),
                "confirmation": HIGH_RISK_CONFIRMATIONS.get(command),
                "interactive": command in INTERACTIVE_COMMANDS,
                "long_running": command in LONG_RUNNING_COMMANDS,
                "availability": False,
                "unavailable_reason": "Command is absent from the installed Hermes parser.",
                "arguments": [],
                "positionals": [],
                "technical": {"argv_prefix": [HERMES_EXE, *command.split()]},
            })
    return operations


def _operation_lookup(operation_id: str) -> tuple[str, argparse.ArgumentParser, dict[str, Any], dict[str, Any]]:
    for operation in _operations():
        if operation["id"] == operation_id:
            if not operation["availability"]:
                raise HTTPException(status_code=409, detail=operation["unavailable_reason"])
            parser, metadata = _load_parsers()[operation["command"]]
            return operation["command"], parser, metadata, operation
    raise HTTPException(status_code=404, detail="Unknown or unapproved Hermes operation")


def _clean_scalar(value: Any, name: str) -> str:
    if isinstance(value, (dict, list)):
        raise HTTPException(status_code=422, detail=f"{name} must be a single value")
    text = str(value)
    if "\x00" in text:
        raise HTTPException(status_code=422, detail=f"{name} contains a null byte")
    if len(text.encode("utf-8")) > 32768:
        raise HTTPException(status_code=422, detail=f"{name} is too long")
    return text


def _validate_path(value: str, name: str, allowed_roots: tuple[Path, ...]) -> str:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = Path("/root") / candidate
    try:
        resolved = candidate.resolve(strict=False)
    except (OSError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid path for {name}") from exc
    if not any(resolved == root or resolved.is_relative_to(root) for root in allowed_roots):
        raise HTTPException(status_code=422, detail=f"{name} must stay within an approved workspace path")
    return str(resolved)


def _clean_values(
    value: Any,
    name: str,
    multiple: bool,
    allowed_path_roots: tuple[Path, ...] | None = None,
) -> list[str]:
    if value is None or value == "":
        return []
    if multiple:
        raw = value if isinstance(value, list) else [value]
        if len(raw) > 64:
            raise HTTPException(status_code=422, detail=f"{name} has too many values")
        cleaned = [_clean_scalar(item, name) for item in raw]
    else:
        cleaned = [_clean_scalar(value, name)]
    if allowed_path_roots is not None:
        cleaned = [_validate_path(item, name, allowed_path_roots) for item in cleaned]
    return cleaned


def _validate_option_values(action: argparse.Action, values: list[str]) -> None:
    """Keep option values from being reinterpreted as hidden Hermes flags."""

    for value in values:
        if action.type in (int, float):
            try:
                action.type(value)
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=422, detail=f"Invalid numeric value for {action.dest}") from exc
        if not value.startswith("-"):
            continue
        if action.type in (int, float):
            continue
        raise HTTPException(status_code=422, detail=f"{action.dest} values cannot begin with a dash")


def _path_policy(command: str, action: argparse.Action) -> tuple[Path, ...] | None:
    policy = PATH_POLICIES.get((command, str(action.dest)))
    name = str(action.dest).lower()
    help_text = str(action.help or "").lower()
    obvious = any(word in name for word in PATH_WORDS)
    ambiguous = name in AMBIGUOUS_PATH_NAMES and re.search(r"\b(path|file|directory)\b", help_text)
    if (obvious or ambiguous) and policy is None:
        raise HTTPException(status_code=409, detail=f"{action.dest} has no reviewed path policy in this bridge version")
    return policy


def _normalize_embedded_paths(command: str, action: argparse.Action, values: list[str]) -> list[str]:
    if command != "send" or action.dest != "message":
        return values

    def replace_media(match: re.Match[str]) -> str:
        resolved = _validate_path(match.group(1), "MEDIA attachment", WORKSPACE_PATH_ROOTS)
        return f"MEDIA:{resolved}"

    return [re.sub(r"MEDIA:([^\s]+)", replace_media, value) for value in values]


def _validate_choices(action: argparse.Action, values: list[str]) -> None:
    if action.choices is None:
        return
    allowed = {str(value) for value in action.choices}
    for value in values:
        if value not in allowed:
            raise HTTPException(status_code=422, detail=f"Invalid value for {action.dest}")


def _build_argv(
    command: str,
    parser: argparse.ArgumentParser,
    profile: str,
    arguments: dict[str, Any],
    positionals: dict[str, Any],
) -> tuple[list[str], list[str], list[str]]:
    option_actions: dict[str, argparse.Action] = {}
    positional_actions: list[argparse.Action] = []
    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction) or action.dest == "help" or action.help is argparse.SUPPRESS:
            continue
        if action.option_strings:
            option_actions[action.dest] = action
        else:
            positional_actions.append(action)

    unknown_arguments = sorted(set(arguments) - set(option_actions))
    unknown_positionals = sorted(set(positionals) - {action.dest for action in positional_actions})
    if unknown_arguments or unknown_positionals:
        raise HTTPException(status_code=422, detail={
            "unknown_arguments": unknown_arguments,
            "unknown_positionals": unknown_positionals,
        })

    argv = [HERMES_EXE]
    redacted = [HERMES_EXE]
    secret_values: list[str] = []
    if profile:
        if not PROFILE_PATTERN.fullmatch(profile):
            raise HTTPException(status_code=422, detail="Invalid profile name")
        argv.extend(["--profile", profile])
        redacted.extend(["--profile", profile])
    argv.extend(command.split())
    redacted.extend(command.split())

    for name, action in option_actions.items():
        if name not in arguments:
            continue
        value = arguments[name]
        flag = _preferred_flag(action)
        if isinstance(action, argparse._StoreTrueAction):
            if bool(value):
                argv.append(flag)
                redacted.append(flag)
            continue
        if isinstance(action, argparse._StoreFalseAction):
            if value is False or str(value).lower() in {"false", "0", "no"}:
                argv.append(flag)
                redacted.append(flag)
            continue
        if isinstance(action, argparse._CountAction):
            try:
                count = max(0, min(int(value), 10))
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=422, detail=f"Invalid count for {name}") from exc
            argv.extend([flag] * count)
            redacted.extend([flag] * count)
            continue
        values = _clean_values(
            value,
            name,
            action.nargs in ("+", "*") or isinstance(action, argparse._AppendAction),
            _path_policy(command, action),
        )
        values = _normalize_embedded_paths(command, action, values)
        _validate_choices(action, values)
        _validate_option_values(action, values)
        if not values:
            continue
        if _is_sensitive(name):
            secret_values.extend(item for item in values if len(item) >= 4)
        if isinstance(action, argparse._AppendAction):
            for item in values:
                argv.extend([flag, item])
                redacted.extend([flag, "[redacted]" if _is_sensitive(name) else item])
        else:
            argv.append(flag)
            redacted.append(flag)
            argv.extend(values)
            redacted.extend(["[redacted]" if _is_sensitive(name) else item for item in values])

    positional_values: list[str] = []
    redacted_positionals: list[str] = []
    for action in positional_actions:
        values = _clean_values(
            positionals.get(action.dest),
            action.dest,
            action.nargs in ("+", "*"),
            _path_policy(command, action),
        )
        values = _normalize_embedded_paths(command, action, values)
        _validate_choices(action, values)
        required = action.nargs not in ("?", "*")
        if required and not values:
            raise HTTPException(status_code=422, detail=f"Missing required value: {action.dest}")
        positional_values.extend(values)
        if _is_sensitive(action.dest):
            secret_values.extend(item for item in values if len(item) >= 4)
        redacted_positionals.extend(["[redacted]" if _is_sensitive(action.dest) else item for item in values])
    if positional_values:
        argv.append("--")
        redacted.append("--")
        argv.extend(positional_values)
        redacted.extend(redacted_positionals)
    return argv, redacted, secret_values


def _redact_literal_secrets(value: str, secrets: list[str]) -> str:
    usable = sorted({secret for secret in secrets if len(secret) >= 4}, key=len, reverse=True)
    if not usable:
        return value
    pattern = re.compile("|".join(re.escape(secret) for secret in usable))
    return pattern.sub("[redacted]", value)


def _append_output(job: dict[str, Any], text: str) -> None:
    cleaned = ANSI_PATTERN.sub("", text).replace("\r\n", "\n").replace("\r", "\n")
    raw = (job.get("_raw_output", "") + cleaned)[-(OUTPUT_LIMIT + 65536):]
    job["_raw_output"] = raw
    combined = raw
    combined = OUTPUT_ASSIGNMENT_PATTERN.sub(r"\1\2[redacted]", combined)
    combined = OUTPUT_BEARER_PATTERN.sub("[redacted]", combined)
    combined = _redact_literal_secrets(
        combined,
        [*job.get("_argv_redactions", []), *job.get("_input_redactions", [])],
    )
    job["output"] = combined[-OUTPUT_LIMIT:]
    job["updated_at"] = time.time()


def _public_job(job: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in job.items() if not key.startswith("_")}


async def _pump_pipe(stream: asyncio.StreamReader | None, job: dict[str, Any]) -> None:
    if stream is None:
        return
    while True:
        chunk = await stream.read(4096)
        if not chunk:
            break
        _append_output(job, chunk.decode("utf-8", errors="replace"))


async def _pump_pty(master_fd: int, job: dict[str, Any]) -> None:
    while True:
        try:
            chunk = await asyncio.to_thread(os.read, master_fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        _append_output(job, chunk.decode("utf-8", errors="replace"))


def _safe_environment() -> dict[str, str]:
    environment = os.environ.copy()
    for key in ("PYTHONPATH", "PYTHONHOME", "LD_PRELOAD", "BASH_ENV", "ENV"):
        environment.pop(key, None)
    environment.setdefault("HOME", "/root")
    environment.setdefault("PATH", "/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
    environment["NO_COLOR"] = "1"
    environment["TERM"] = "xterm-256color"
    return environment


async def _run_job(job: dict[str, Any], argv: list[str], use_pty: bool, timeout: int) -> None:
    job["status"] = "starting"
    job["updated_at"] = time.time()
    master_fd = None
    slave_fd = None
    try:
        if use_pty:
            master_fd, slave_fd = pty.openpty()
            attributes = termios.tcgetattr(slave_fd)
            attributes[3] &= ~(termios.ECHO | termios.ECHONL)
            termios.tcsetattr(slave_fd, termios.TCSANOW, attributes)
            process = await asyncio.create_subprocess_exec(
                *argv,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd="/root",
                env=_safe_environment(),
                start_new_session=True,
            )
            os.close(slave_fd)
            slave_fd = None
            job["_master_fd"] = master_fd
            pump = asyncio.create_task(_pump_pty(master_fd, job))
        else:
            process = await asyncio.create_subprocess_exec(
                *argv,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd="/root",
                env=_safe_environment(),
                start_new_session=True,
            )
            job["_stdin"] = process.stdin
            pump = asyncio.create_task(_pump_pipe(process.stdout, job))
        job["_process"] = process
        job["pid"] = process.pid
        job["status"] = "running"
        job["updated_at"] = time.time()
        try:
            exit_code = await asyncio.wait_for(process.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            job["status"] = "timed_out"
            _terminate_process_tree(process)
            try:
                await asyncio.wait_for(process.wait(), timeout=5)
            except asyncio.TimeoutError:
                _kill_process_tree(process)
                await process.wait()
            exit_code = process.returncode
        await pump
        job["exit_code"] = exit_code
        if job["status"] not in {"timed_out", "stopped"}:
            job["status"] = "completed" if exit_code == 0 else "failed"
    except asyncio.CancelledError:
        process = job.get("_process")
        if process and process.returncode is None:
            await _stop_process(process)
        job["status"] = "stopped"
        raise
    except Exception as exc:
        job["status"] = "failed"
        job["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        job["updated_at"] = time.time()
        job["finished_at"] = time.time()
        job.pop("_stdin", None)
        job.pop("_process", None)
        job.pop("_master_fd", None)
        if slave_fd is not None:
            try:
                os.close(slave_fd)
            except OSError:
                pass
        if master_fd is not None:
            try:
                os.close(master_fd)
            except OSError:
                pass


def _terminate_process_tree(process: asyncio.subprocess.Process) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        try:
            process.terminate()
        except ProcessLookupError:
            pass


def _kill_process_tree(process: asyncio.subprocess.Process) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            process.kill()
        except ProcessLookupError:
            pass


async def _stop_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    _terminate_process_tree(process)
    try:
        await asyncio.wait_for(asyncio.shield(process.wait()), timeout=5)
    except asyncio.TimeoutError:
        _kill_process_tree(process)
        await asyncio.shield(process.wait())


def _owner_key(request: Request) -> str:
    """Return a stable, non-reversible job owner key for the authenticated caller."""

    session = getattr(request.state, "session", None)
    if isinstance(session, dict):
        issuer = session.get("provider") or session.get("iss")
        subject = session.get("sub") or session.get("user_id") or session.get("id")
        if not issuer or not subject:
            raise HTTPException(status_code=401, detail="The dashboard session has no stable user identity")
        source = {"issuer": str(issuer), "subject": str(subject)}
    elif session is not None:
        issuer = getattr(session, "provider", None) or getattr(session, "iss", None)
        subject = getattr(session, "sub", None) or getattr(session, "user_id", None) or getattr(session, "id", None)
        if not issuer or not subject:
            raise HTTPException(status_code=401, detail="The dashboard session has no stable user identity")
        source = {"issuer": str(issuer), "subject": str(subject)}
    else:
        raise HTTPException(status_code=401, detail="An authenticated dashboard user session is required")
    try:
        serialized = json.dumps(source, sort_keys=True, default=str)
    except (TypeError, ValueError):
        serialized = repr(source)
    return hashlib.sha256(serialized.encode("utf-8", errors="replace")).hexdigest()


def _owned_job(job_id: str, owner: str) -> dict[str, Any]:
    job = _JOBS.get(job_id)
    if not job or job.get("_owner") != owner:
        raise HTTPException(status_code=404, detail="Unknown CLI job")
    return job


async def _reserve_job(job: dict[str, Any]) -> None:
    async with _JOBS_LOCK:
        running = sum(1 for existing in _JOBS.values() if existing["status"] in ACTIVE_JOB_STATES)
        if running >= MAX_RUNNING_JOBS:
            raise HTTPException(status_code=429, detail="Too many Hermes jobs are already running")
        while len(_JOBS) >= MAX_RETAINED_JOBS:
            removable = next((job_id for job_id, existing in _JOBS.items() if existing["status"] not in ACTIVE_JOB_STATES), None)
            if removable is None:
                raise HTTPException(status_code=429, detail="The Hermes job history is full")
            _JOBS.pop(removable, None)
        _JOBS[job["job_id"]] = job


@router.get("/cli-operations")
async def list_cli_operations():
    operations = await asyncio.to_thread(_operations)
    return {
        "ok": True,
        "executable": HERMES_EXE,
        "operations": operations,
        "counts": {
            "registered": len(operations),
            "available": sum(1 for operation in operations if operation["availability"]),
            "families": len({operation["family"] for operation in operations}),
        },
        "security": {
            "shell": False,
            "allowlisted": True,
            "max_running_jobs": MAX_RUNNING_JOBS,
            "output_limit_bytes": OUTPUT_LIMIT,
        },
    }


@router.post("/cli-operations/{operation_id}/run")
async def run_cli_operation(operation_id: str, body: dict[str, Any], request: Request):
    command, parser, _metadata, operation = await asyncio.to_thread(_operation_lookup, operation_id)
    confirmation = str(body.get("confirmation") or "")
    expected = operation.get("confirmation")
    if expected and confirmation != expected:
        raise HTTPException(status_code=409, detail=f"Type {expected} to confirm this action")
    arguments = body.get("arguments") or {}
    positionals = body.get("positionals") or {}
    if not isinstance(arguments, dict) or not isinstance(positionals, dict):
        raise HTTPException(status_code=422, detail="arguments and positionals must be objects")
    profile = str(body.get("profile") or "").strip()
    argv, redacted_argv, secret_values = await asyncio.to_thread(
        _build_argv, command, parser, profile, arguments, positionals
    )

    now = time.time()
    job_id = uuid.uuid4().hex
    job = {
        "job_id": job_id,
        "operation_id": operation_id,
        "command": command,
        "profile": profile or "default",
        "risk": operation["risk"],
        "status": "queued",
        "argv": redacted_argv,
        "output": "",
        "error": "",
        "exit_code": None,
        "pid": None,
        "accepts_input": bool(operation["interactive"]),
        "created_at": now,
        "updated_at": now,
        "finished_at": None,
        "_owner": _owner_key(request),
        "_argv_redactions": secret_values,
        "_input_redactions": [],
        "_raw_output": "",
    }
    await _reserve_job(job)
    timeout = LONG_TIMEOUT if operation["long_running"] else DEFAULT_TIMEOUT
    task = asyncio.create_task(_run_job(job, argv, bool(operation["interactive"]), timeout))
    job["_task"] = task
    return {"ok": True, "job": _public_job(job)}


@router.get("/cli-jobs")
async def list_cli_jobs(request: Request):
    owner = _owner_key(request)
    return {"jobs": [_public_job(job) for job in reversed(_JOBS.values()) if job.get("_owner") == owner]}


@router.get("/cli-jobs/{job_id}")
async def get_cli_job(job_id: str, request: Request):
    job = _owned_job(job_id, _owner_key(request))
    return {"job": _public_job(job)}


@router.post("/cli-jobs/{job_id}/input")
async def send_cli_job_input(job_id: str, body: dict[str, Any], request: Request):
    job = _owned_job(job_id, _owner_key(request))
    if job["status"] != "running" or not job.get("accepts_input"):
        raise HTTPException(status_code=409, detail="This job is not accepting input")
    text = _clean_scalar(body.get("text", ""), "input")
    if len(text) > 8192:
        raise HTTPException(status_code=422, detail="Input is too long")
    payload = (text + "\n").encode("utf-8")
    redactions = job.setdefault("_input_redactions", [])
    if len(text) >= 4 and text not in redactions:
        redactions.append(text)
        del redactions[:-16]
    master_fd = job.get("_master_fd")
    writer = job.get("_stdin")
    if master_fd is not None:
        await asyncio.to_thread(os.write, master_fd, payload)
    elif writer is not None:
        writer.write(payload)
        await writer.drain()
    else:
        raise HTTPException(status_code=409, detail="The process input stream is unavailable")
    return {"ok": True}


@router.delete("/cli-jobs/{job_id}")
async def stop_cli_job(job_id: str, request: Request):
    job = _owned_job(job_id, _owner_key(request))
    process = job.get("_process")
    task = job.get("_task")
    if process and process.returncode is None:
        await _stop_process(process)
    if task and not task.done():
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    job["status"] = "stopped"
    job["updated_at"] = time.time()
    job["finished_at"] = time.time()
    return {"ok": True, "job": _public_job(job)}
