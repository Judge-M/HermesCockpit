"""Shared semantic-routing loader and bounded redacted trace store."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
from typing import Any


CANONICAL_ROUTING_STATE_MODULE = "judge_m_control_plane_routing_state"
CANONICAL_SEMANTIC_MODULE = "judge_m_control_plane_semantic_routing"
TRACE_DB_ENV = "HERMES_ROUTING_TRACE_DB"
TRACE_MEMORY_ONLY_ENV = "HERMES_ROUTING_TRACE_MEMORY_ONLY"
TRACE_LIMIT = 200
TRACE_PAYLOAD_LIMIT = 256 * 1024


def _module_path(module: Any) -> Path | None:
    value = getattr(module, "__file__", None)
    if not value:
        return None
    try:
        return Path(value).resolve()
    except (OSError, RuntimeError, TypeError, ValueError):
        return None


def _semantic_path() -> Path:
    return Path(__file__).with_name("semantic_routing.py").resolve()


def _state_module() -> Any:
    return sys.modules.get(__name__) or sys.modules.get(CANONICAL_ROUTING_STATE_MODULE)


def _bind_state(module: Any) -> Any:
    state = _state_module()
    if state is not None:
        setattr(module, "_ROUTING_STATE", state)
    return module


def load_semantic_routing() -> Any:
    """Return the one in-process semantic-routing module for this source file."""

    target = _semantic_path()
    for module in list(sys.modules.values()):
        if _module_path(module) == target:
            return _bind_state(module)

    cached = sys.modules.get(CANONICAL_SEMANTIC_MODULE)
    if cached is not None:
        cached_path = _module_path(cached)
        if cached_path == target:
            return _bind_state(cached)
        raise RuntimeError(f"Canonical semantic-routing alias points to {cached_path}")

    spec = importlib.util.spec_from_file_location(CANONICAL_SEMANTIC_MODULE, target)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load semantic-routing module from {target}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[CANONICAL_SEMANTIC_MODULE] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(CANONICAL_SEMANTIC_MODULE, None)
        raise
    return _bind_state(module)


def trace_store_enabled() -> bool:
    return os.environ.get(TRACE_MEMORY_ONLY_ENV, "").strip() != "1"


def _trace_db_path() -> Path:
    configured = os.environ.get(TRACE_DB_ENV, "").strip()
    if configured:
        return Path(configured).expanduser().resolve(strict=False)

    # Resolve lazily so hosted package requests follow the current routed
    # Hermes profile in both the runtime and standalone dashboard processes.
    try:
        from hermes_cli.config import get_hermes_home
    except (ImportError, AttributeError):
        get_hermes_home = None
    if get_hermes_home is not None:
        try:
            routed_home = get_hermes_home()
        except (OSError, RuntimeError, TypeError, ValueError):
            routed_home = None
        if routed_home:
            return Path(routed_home).expanduser() / "judge-m-control-plane" / "routing-traces.sqlite3"

    hermes_home = os.environ.get("HERMES_HOME", "").strip()
    root = Path(hermes_home).expanduser() if hermes_home else Path.home() / ".hermes"
    return root / "judge-m-control-plane" / "routing-traces.sqlite3"


def _connect() -> sqlite3.Connection:
    path = _trace_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(path), timeout=5)
    connection.execute("PRAGMA busy_timeout = 5000")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS routing_traces (
            trace_id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_scope TEXT NOT NULL,
            decision_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at REAL NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS routing_traces_owner ON routing_traces(owner_scope, trace_id)"
    )
    return connection


def _prune(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        DELETE FROM routing_traces
        WHERE trace_id IN (
            SELECT trace_id FROM routing_traces
            ORDER BY trace_id DESC LIMIT -1 OFFSET ?
        )
        """,
        (TRACE_LIMIT,),
    )


def append_trace(row: dict[str, Any]) -> bool:
    if not trace_store_enabled():
        return False
    try:
        payload = json.dumps(row, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        if len(payload.encode("utf-8")) > TRACE_PAYLOAD_LIMIT:
            return False
        owner_scope = str(row.get("_owner_scope") or "__single_user__")
        decision_id = str(row.get("decision_id") or "")
        connection = _connect()
        try:
            with connection:
                connection.execute(
                    "INSERT INTO routing_traces(owner_scope, decision_id, payload, created_at) VALUES (?, ?, ?, ?)",
                    (owner_scope, decision_id, payload, time.time()),
                )
                _prune(connection)
        finally:
            connection.close()
        return True
    except (ImportError, OSError, RuntimeError, AttributeError, sqlite3.Error, TypeError, ValueError):
        return False


def read_traces(
    *, owner_scope: str, profile: str = "", session_id: str = "", limit: int = 50,
) -> list[dict[str, Any]] | None:
    if not trace_store_enabled():
        return None
    bounded_limit = max(1, min(200, int(limit or 50)))
    try:
        connection = _connect()
        try:
            rows = connection.execute(
                "SELECT payload FROM routing_traces WHERE owner_scope = ? ORDER BY trace_id DESC",
                (owner_scope,),
            ).fetchall()
        finally:
            connection.close()
        result = []
        for (payload,) in rows:
            try:
                row = json.loads(payload)
            except (TypeError, ValueError):
                continue
            if not isinstance(row, dict):
                continue
            if not row.get("decision_id"):
                continue
            if profile and row.get("profile") != profile:
                continue
            if session_id and row.get("session_id") != session_id:
                continue
            result.append(row)
            if len(result) >= bounded_limit:
                break
        return result
    except (ImportError, OSError, RuntimeError, AttributeError, sqlite3.Error, TypeError, ValueError):
        return None


def update_trace_outcome(*, owner_scope: str, decision_id: str, outcome: dict[str, Any]) -> bool:
    if not trace_store_enabled():
        return False
    try:
        connection = _connect()
        try:
            selected = connection.execute(
                """
                SELECT trace_id, payload FROM routing_traces
                WHERE owner_scope = ? AND decision_id = ?
                ORDER BY trace_id DESC LIMIT 1
                """,
                (owner_scope, decision_id),
            ).fetchone()
            if selected is None:
                return False
            trace_id, payload = selected
            row = json.loads(payload)
            if not isinstance(row, dict):
                return False
            row["outcome"] = outcome
            serialized = json.dumps(row, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            if len(serialized.encode("utf-8")) > TRACE_PAYLOAD_LIMIT:
                return False
            connection.execute(
                "UPDATE routing_traces SET payload = ? WHERE trace_id = ?",
                (serialized, trace_id),
            )
            connection.commit()
        finally:
            connection.close()
        return True
    except (ImportError, OSError, RuntimeError, AttributeError, sqlite3.Error, TypeError, ValueError):
        return False
