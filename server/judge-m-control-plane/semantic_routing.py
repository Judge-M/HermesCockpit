"""Native semantic-routing policy and adapters for Judge-M Cockpit.

The module deliberately returns concrete Hermes provider/model pairs.  It never
creates a pseudo-provider, exposes credentials, or expands an authorized tool
set.  All failures fall back to the route Hermes had already resolved.
"""

from __future__ import annotations

from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from dataclasses import dataclass
import hashlib
import http.client
import ipaddress
import json
import logging
import re
import secrets
import socket
import threading
import time
import uuid
from typing import Any, Iterable, Mapping, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import (
    HTTPHandler,
    HTTPRedirectHandler,
    HTTPSHandler,
    ProxyHandler,
    Request,
    build_opener,
)


logger = logging.getLogger(__name__)

ROUTER_TASK = "judge_m_semantic_router"
POLICIES = {"balanced", "fast", "quality", "cost", "local"}
MODES = {"inherit", "fixed", "native", "semantic"}
ADAPTERS = {"auto", "system_one", "generic_structured"}
MEMORY_STRATEGIES = {"provider_native", "keyword", "semantic", "structured", "hybrid"}

_TRACE_LIMIT = 200
_TRACES: deque[dict[str, Any]] = deque(maxlen=_TRACE_LIMIT)
_TRACE_LOCK = threading.RLock()
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_LOCK = threading.RLock()
_TOOL_SELECTIONS: dict[tuple[str, str, str, str], list[str]] = {}
_TOOL_SELECTIONS_LOCK = threading.RLock()
_ESCALATIONS: dict[tuple[str, str, str], int] = {}
_ESCALATION_LOCK = threading.RLock()
_CIRCUITS: dict[tuple[str, str], dict[str, float]] = {}
_CIRCUIT_LOCK = threading.RLock()
_FINGERPRINT_SALT = secrets.token_bytes(32)
_SINGLE_USER_OWNER_SCOPE = "__single_user__"


class _RejectRedirects(HTTPRedirectHandler):
    """Do not let a configured decision endpoint escape its validated origin."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        raise URLError("decision endpoints may not redirect")


class _PinnedHTTPConnection(http.client.HTTPConnection):
    """Connect to the address selected by endpoint validation, not a fresh DNS result."""

    def __init__(self, host: str, pinned_address: str, **kwargs: Any):
        self._pinned_address = pinned_address
        super().__init__(host, **kwargs)

    def connect(self) -> None:
        self.sock = self._create_connection(
            (self._pinned_address, self.port), self.timeout, self.source_address
        )
        if self._tunnel_host:
            self._tunnel()


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS connection pinned to a validated address while retaining URL-host SNI."""

    def __init__(self, host: str, pinned_address: str, **kwargs: Any):
        self._pinned_address = pinned_address
        super().__init__(host, **kwargs)

    def connect(self) -> None:
        self.sock = self._create_connection(
            (self._pinned_address, self.port), self.timeout, self.source_address
        )
        if self._tunnel_host:
            self._tunnel()
        server_hostname = (self._tunnel_host or self.host).strip("[]")
        self.sock = self._context.wrap_socket(self.sock, server_hostname=server_hostname)


class _PinnedHTTPHandler(HTTPHandler):
    def __init__(self, pinned_address: str):
        super().__init__()
        self._pinned_address = pinned_address

    def http_open(self, req):  # noqa: D401
        return self.do_open(
            lambda host, **kwargs: _PinnedHTTPConnection(host, self._pinned_address, **kwargs), req
        )


class _PinnedHTTPSHandler(HTTPSHandler):
    def __init__(self, pinned_address: str):
        super().__init__()
        self._pinned_address = pinned_address

    def https_open(self, req):  # noqa: D401
        return self.do_open(
            lambda host, **kwargs: _PinnedHTTPSConnection(host, self._pinned_address, **kwargs),
            req,
            context=self._context,
        )


def _decision_opener(pinned_address: str):
    # Disable environment proxies: otherwise the request would connect to the
    # proxy rather than the address validated immediately before this call.
    return build_opener(
        ProxyHandler({}),
        _PinnedHTTPHandler(pinned_address),
        _PinnedHTTPSHandler(pinned_address),
        _RejectRedirects(),
    )


DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": False,
    "policy": "balanced",
    "default_mode": "semantic",
    "decision_model": {"provider": "", "model": "", "adapter": "auto", "endpoint": ""},
    "fallback": {"provider": "", "model": ""},
    "slots": {"primary": {"mode": "inherit"}, "subagent": {"mode": "inherit"}, "auxiliary": {}},
    "tool_routing": {"enabled": True, "max_tools": 24, "decision_model": {}},
    "memory_routing": {
        "enabled": True, "allow_skip": True, "strategy": "provider_native", "decision_model": {},
    },
    "shadow": {"enabled": False, "decision_model": {}},
    "escalation": {
        "enabled": False, "max_per_session": 1, "error_threshold": 2,
        "allow_after_side_effects": False, "eligible_models": [],
    },
    "verification": {
        "enabled": False, "model_count": 1, "models": [], "synthesis_model": {},
        "timeout_seconds": 20, "max_output_chars": 24000,
    },
    "context_optimization": {"tool_narrowing": True, "memory_routing": True},
    "cache": {"enabled": False, "ttl_seconds": 90, "max_entries": 256},
    "timeout_seconds": 8,
}


@dataclass(frozen=True)
class Candidate:
    provider: str
    model: str
    label: str = ""
    local: bool = False
    metadata: Optional[dict[str, Any]] = None

    @property
    def key(self) -> str:
        return f"{self.provider}/{self.model}"

    def public(self) -> dict[str, Any]:
        value = {"provider": self.provider, "model": self.model, "label": self.label or self.key, "local": self.local}
        if self.metadata:
            value["metadata"] = deepcopy(self.metadata)
        return value


def _clean_text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _profile_config_path(profile: str):
    from hermes_cli.profiles import get_profile_dir, normalize_profile_name

    return get_profile_dir(normalize_profile_name(profile or "default")) / "config.yaml"


def _deep_merge(base: dict[str, Any], incoming: Mapping[str, Any]) -> dict[str, Any]:
    result = deepcopy(base)
    for key, value in incoming.items():
        if isinstance(result.get(key), dict) and isinstance(value, Mapping):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def _bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(maximum, int(value)))
    except (TypeError, ValueError):
        return default


def _normalize_decision_model(value: Any) -> dict[str, str]:
    value = value if isinstance(value, Mapping) else {}
    adapter = _clean_text(value.get("adapter"), 32).lower() or "auto"
    return {
        "provider": _clean_text(value.get("provider"), 96).lower(),
        "model": _clean_text(value.get("model"), 256),
        "adapter": adapter if adapter in ADAPTERS else "auto",
        "endpoint": _clean_text(value.get("endpoint"), 1000),
    }


def _normalize_model_refs(values: Any, limit: int = 16) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    for value in values if isinstance(values, list) else []:
        if not isinstance(value, Mapping):
            continue
        provider = _clean_text(value.get("provider"), 96).lower()
        model = _clean_text(value.get("model"), 256)
        key = f"{provider}/{model}".lower()
        if provider and model and key not in seen and len(rows) < limit:
            seen.add(key)
            rows.append({"provider": provider, "model": model})
    return rows


def _canonical_endpoint_address(value: ipaddress.IPv4Address | ipaddress.IPv6Address):
    mapped = value.ipv4_mapped if isinstance(value, ipaddress.IPv6Address) else None
    return mapped or value


def _blocked_endpoint_address(value: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    value = _canonical_endpoint_address(value)
    return value.is_link_local or value.is_multicast or value.is_unspecified or str(value) in {
        "169.254.169.254",
        "100.100.100.200",
        "fd00:ec2::254",
    }


def _unsafe_endpoint_address(value: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    value = _canonical_endpoint_address(value)
    return value.is_private or value.is_loopback or _blocked_endpoint_address(value)


def _validated_endpoint(endpoint: str):
    """Validate an endpoint and return its parsed URL plus the address to connect to."""
    if not endpoint:
        return None, None
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Decision endpoint must be an HTTP(S) URL without embedded credentials")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        raise ValueError("Decision endpoint has an invalid port") from exc
    host = parsed.hostname.strip("[]").lower()
    host_for_ip = host.split("%", 1)[0]
    try:
        address = _canonical_endpoint_address(ipaddress.ip_address(host_for_ip))
    except ValueError:
        address = None

    local = host == "localhost" or host.endswith(".local")
    if address is not None:
        if _blocked_endpoint_address(address):
            raise ValueError("Decision endpoint targets a blocked local metadata or link-local address")
        # Explicit private/loopback IPs are a deliberate local-endpoint escape hatch.
        local = local or address.is_private or address.is_loopback
        pinned_address = str(address)
    else:
        try:
            resolved = []
            seen = set()
            for result in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM):
                if not result[4] or not result[4][0]:
                    continue
                candidate = _canonical_endpoint_address(
                    ipaddress.ip_address(result[4][0].split("%", 1)[0])
                )
                if str(candidate) not in seen:
                    seen.add(str(candidate))
                    resolved.append(candidate)
        except (OSError, ValueError) as exc:
            raise ValueError("Decision endpoint hostname could not be resolved") from exc
        if not resolved:
            raise ValueError("Decision endpoint hostname could not be resolved")
        # Local names may resolve to private/loopback addresses, but link-local,
        # metadata, multicast, and unspecified targets are never permitted.
        if any(_blocked_endpoint_address(value) for value in resolved):
            raise ValueError("Decision endpoint targets a blocked local metadata or link-local address")
        if not local and any(_unsafe_endpoint_address(value) for value in resolved):
            raise ValueError("Decision endpoint hostname resolves to a blocked local or metadata address")
        pinned_address = str(resolved[0])
    if parsed.scheme != "https" and not local:
        raise ValueError("Public decision endpoints must use HTTPS")
    return parsed, pinned_address


def _validate_custom_endpoint(endpoint: str) -> None:
    _validated_endpoint(endpoint)


def normalize_config(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, Mapping) else {}
    cfg = _deep_merge(DEFAULT_CONFIG, raw)
    cfg["enabled"] = bool(cfg.get("enabled"))
    cfg["policy"] = _clean_text(cfg.get("policy"), 24).lower()
    if cfg["policy"] not in POLICIES:
        cfg["policy"] = "balanced"
    default_mode = _clean_text(cfg.get("default_mode"), 24).lower()
    cfg["default_mode"] = default_mode if default_mode in {"native", "semantic"} else "semantic"
    cfg["decision_model"] = _normalize_decision_model(cfg.get("decision_model"))
    _validate_custom_endpoint(cfg["decision_model"]["endpoint"])

    fallback = cfg.get("fallback") if isinstance(cfg.get("fallback"), Mapping) else {}
    cfg["fallback"] = {
        "provider": _clean_text(fallback.get("provider"), 96).lower(),
        "model": _clean_text(fallback.get("model"), 256),
    }

    slots = cfg.get("slots") if isinstance(cfg.get("slots"), Mapping) else {}
    primary = slots.get("primary") if isinstance(slots.get("primary"), Mapping) else {}
    subagent = slots.get("subagent") if isinstance(slots.get("subagent"), Mapping) else {}
    auxiliary = slots.get("auxiliary") if isinstance(slots.get("auxiliary"), Mapping) else {}
    clean_aux: dict[str, Any] = {}
    for key, value in list(auxiliary.items())[:128]:
        task = _clean_text(key, 128)
        if not task or task == ROUTER_TASK or not isinstance(value, Mapping):
            continue
        mode = _clean_text(value.get("mode"), 24).lower()
        clean_aux[task] = {"mode": mode if mode in MODES else "inherit"}
    cfg["slots"] = {
        "primary": {"mode": primary.get("mode") if primary.get("mode") in MODES else "inherit"},
        "subagent": {"mode": subagent.get("mode") if subagent.get("mode") in MODES else "inherit"},
        "auxiliary": clean_aux,
    }

    tools = cfg.get("tool_routing") if isinstance(cfg.get("tool_routing"), Mapping) else {}
    cfg["tool_routing"] = {
        "enabled": bool(tools.get("enabled", True)),
        "max_tools": _bounded_int(tools.get("max_tools"), 24, 1, 128),
        "decision_model": _normalize_decision_model(tools.get("decision_model")),
    }
    _validate_custom_endpoint(cfg["tool_routing"]["decision_model"]["endpoint"])

    memory = cfg.get("memory_routing") if isinstance(cfg.get("memory_routing"), Mapping) else {}
    strategy = _clean_text(memory.get("strategy"), 32).lower() or "provider_native"
    cfg["memory_routing"] = {
        "enabled": bool(memory.get("enabled", True)),
        "allow_skip": bool(memory.get("allow_skip", True)),
        "strategy": strategy if strategy in MEMORY_STRATEGIES else "provider_native",
        "decision_model": _normalize_decision_model(memory.get("decision_model")),
    }
    _validate_custom_endpoint(cfg["memory_routing"]["decision_model"]["endpoint"])

    shadow = cfg.get("shadow") if isinstance(cfg.get("shadow"), Mapping) else {}
    cfg["shadow"] = {
        "enabled": bool(shadow.get("enabled")),
        "decision_model": _normalize_decision_model(shadow.get("decision_model")),
    }
    _validate_custom_endpoint(cfg["shadow"]["decision_model"]["endpoint"])

    escalation = cfg.get("escalation") if isinstance(cfg.get("escalation"), Mapping) else {}
    cfg["escalation"] = {
        "enabled": bool(escalation.get("enabled")),
        "max_per_session": _bounded_int(escalation.get("max_per_session"), 1, 0, 5),
        "error_threshold": _bounded_int(escalation.get("error_threshold"), 2, 1, 10),
        "allow_after_side_effects": bool(escalation.get("allow_after_side_effects", False)),
        "eligible_models": _normalize_model_refs(escalation.get("eligible_models"), 32),
    }

    verification = cfg.get("verification") if isinstance(cfg.get("verification"), Mapping) else {}
    cfg["verification"] = {
        "enabled": bool(verification.get("enabled")),
        "model_count": _bounded_int(verification.get("model_count"), 1, 1, 3),
        "models": _normalize_model_refs(verification.get("models"), 3),
        "synthesis_model": _normalize_decision_model(verification.get("synthesis_model")),
        "timeout_seconds": _bounded_int(verification.get("timeout_seconds"), 20, 2, 60),
        "max_output_chars": _bounded_int(verification.get("max_output_chars"), 24000, 1000, 100000),
    }
    _validate_custom_endpoint(cfg["verification"]["synthesis_model"]["endpoint"])

    context = cfg.get("context_optimization") if isinstance(cfg.get("context_optimization"), Mapping) else {}
    cfg["context_optimization"] = {
        "tool_narrowing": bool(context.get("tool_narrowing", True)),
        "memory_routing": bool(context.get("memory_routing", True)),
    }
    cache = cfg.get("cache") if isinstance(cfg.get("cache"), Mapping) else {}
    legacy_ttl = cfg.get("cache_ttl_seconds", DEFAULT_CONFIG["cache"]["ttl_seconds"])
    cfg["cache"] = {
        "enabled": bool(cache.get("enabled", False)),
        "ttl_seconds": _bounded_int(cache.get("ttl_seconds", legacy_ttl), 90, 0, 3600),
        "max_entries": _bounded_int(cache.get("max_entries"), 256, 16, 2048),
    }
    cfg.pop("cache_ttl_seconds", None)
    cfg["timeout_seconds"] = _bounded_int(cfg.get("timeout_seconds"), 8, 1, 30)
    return cfg


def load_config(profile: str = "default") -> dict[str, Any]:
    from hermes_cli.config import read_user_config_raw

    path = _profile_config_path(profile)
    try:
        raw = read_user_config_raw(path)
    except Exception:
        raw = {}
    return normalize_config(raw.get("smart_model_routing") if isinstance(raw, dict) else {})


def save_config(profile: str, incoming: Mapping[str, Any]) -> dict[str, Any]:
    from hermes_cli.config import atomic_config_write, read_user_config_raw

    path = _profile_config_path(profile)
    current = read_user_config_raw(path) if path.exists() else {}
    if not isinstance(current, dict):
        raise ValueError("Hermes profile configuration is not a mapping")
    cleaned = normalize_config(incoming)
    current["smart_model_routing"] = cleaned
    atomic_config_write(path, current)
    with _CACHE_LOCK:
        _CACHE.clear()
    with _CIRCUIT_LOCK:
        _CIRCUITS.clear()
    with _TOOL_SELECTIONS_LOCK:
        _TOOL_SELECTIONS.clear()
    return cleaned


def slot_mode(cfg: Mapping[str, Any], slot: str, task: str = "") -> str:
    slots = cfg.get("slots") if isinstance(cfg.get("slots"), Mapping) else {}
    if slot == "auxiliary":
        aux = slots.get("auxiliary") if isinstance(slots.get("auxiliary"), Mapping) else {}
        row = aux.get(task) if isinstance(aux.get(task), Mapping) else {}
    else:
        row = slots.get(slot) if isinstance(slots.get(slot), Mapping) else {}
    configured = str(row.get("mode") or "inherit")
    if configured == "inherit":
        return str(cfg.get("default_mode") or "semantic") if cfg.get("enabled") else "native"
    return configured


def candidates_from_catalog(catalog: Mapping[str, Any], policy: str = "balanced") -> list[Candidate]:
    preferences = catalog.get("preferences") if isinstance(catalog.get("preferences"), Mapping) else {}
    pref_rows = preferences.get("providers") if isinstance(preferences.get("providers"), Mapping) else {}
    result: list[Candidate] = []
    for provider in catalog.get("providers") or []:
        if not isinstance(provider, Mapping):
            continue
        slug = _clean_text(provider.get("slug"), 96).lower()
        if not slug or not bool(provider.get("configured")):
            continue
        pref = pref_rows.get(slug) if isinstance(pref_rows.get(slug), Mapping) else {}
        if pref and not bool(pref.get("enabled", True)):
            continue
        routing_models = pref.get("routing_models") if isinstance(pref.get("routing_models"), list) else []
        visible_models = pref.get("visible_models") if isinstance(pref.get("visible_models"), list) else []
        explicit_allow = {_clean_text(value, 256) for value in routing_models if _clean_text(value, 256)}
        curated = {_clean_text(value, 256) for value in visible_models if _clean_text(value, 256)}
        models = [_clean_text(value, 256) for value in provider.get("models") or []]
        if explicit_allow:
            models = [model for model in models if model in explicit_allow]
        elif pref.get("mode") == "curated" and curated:
            models = [model for model in models if model in curated]
        # Local-only is a security policy.  Never infer locality merely because
        # the endpoint was user-defined; cloud-compatible endpoints are also user-defined.
        is_local = provider.get("local") is True
        metadata_rows = provider.get("model_metadata") if isinstance(provider.get("model_metadata"), Mapping) else {}
        for model in models:
            if model:
                metadata = metadata_rows.get(model) if isinstance(metadata_rows.get(model), Mapping) else {}
                result.append(Candidate(
                    slug, model, f"{provider.get('name') or slug} · {model}", is_local,
                    {key: deepcopy(value) for key, value in metadata.items() if key in {
                        "modalities", "tool_calling", "structured_output", "context_limit",
                        "input_cost", "output_cost", "latency_ms", "health", "source",
                    }},
                ))
    if policy == "local":
        result = [candidate for candidate in result if candidate.local]
    return result[:512]


def _candidate_rows(raw: Iterable[Any]) -> list[Candidate]:
    rows: list[Candidate] = []
    seen: set[str] = set()
    for value in raw:
        if not isinstance(value, Mapping):
            continue
        provider = _clean_text(value.get("provider"), 96).lower()
        model = _clean_text(value.get("model"), 256)
        metadata = value.get("metadata") if isinstance(value.get("metadata"), Mapping) else {}
        candidate = Candidate(
            provider, model, _clean_text(value.get("label"), 320), bool(value.get("local")),
            {key: deepcopy(item) for key, item in metadata.items() if key in {
                "modalities", "tool_calling", "structured_output", "context_limit",
                "input_cost", "output_cost", "latency_ms", "health", "source",
            }},
        )
        if provider and model and candidate.key.lower() not in seen:
            seen.add(candidate.key.lower())
            rows.append(candidate)
    return rows[:512]


def _prompt_fingerprint(text: str) -> str:
    return hashlib.sha256(_FINGERPRINT_SALT + text.encode("utf-8", "replace")).hexdigest()[:16]


def _config_version(cfg: Mapping[str, Any]) -> str:
    return hashlib.sha256(json.dumps(cfg, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:12]


def _public_error(exc: BaseException) -> dict[str, str]:
    return {"type": type(exc).__name__, "message": "decision backend unavailable or returned an invalid result"}


def _policy_filter(
    rows: list[Candidate], policy: str, *, requirements: Optional[Mapping[str, Any]] = None,
) -> tuple[list[Candidate], list[dict[str, str]], list[str]]:
    requirements = requirements if isinstance(requirements, Mapping) else {}
    required_modalities = {str(value).lower() for value in requirements.get("modalities") or []}
    needs_tools = requirements.get("tool_calling") is True
    needs_structured = requirements.get("structured_output") is True
    eligible: list[Candidate] = []
    excluded: list[dict[str, str]] = []
    constraints: list[str] = []
    if policy == "local":
        constraints.append("local_only")
    if required_modalities:
        constraints.append("modalities:" + ",".join(sorted(required_modalities)))
    if needs_tools:
        constraints.append("tool_calling")
    if needs_structured:
        constraints.append("structured_output")
    for row in rows:
        metadata = row.metadata or {}
        reason = ""
        if policy == "local" and not row.local:
            reason = "not_verified_local"
        elif str(metadata.get("health") or "").lower() in {"down", "unavailable", "disabled"}:
            reason = "unavailable"
        elif required_modalities:
            modalities = {str(value).lower() for value in metadata.get("modalities") or []}
            if not required_modalities.issubset(modalities):
                reason = "capability_unknown_or_incompatible"
        elif needs_tools and metadata.get("tool_calling") is not True:
            reason = "tool_calling_unknown_or_unsupported"
        elif needs_structured and metadata.get("structured_output") is not True:
            reason = "structured_output_unknown_or_unsupported"
        if reason:
            excluded.append({"candidate": row.key, "reason": reason})
        else:
            eligible.append(row)
    # Deterministic policy ordering constrains the model without pretending that
    # missing telemetry is known. Unknown values sort after known values.
    if policy == "fast":
        eligible.sort(key=lambda row: (float((row.metadata or {}).get("latency_ms") or float("inf")), row.key))
    elif policy == "cost":
        eligible.sort(key=lambda row: (
            float((row.metadata or {}).get("input_cost") or float("inf"))
            + float((row.metadata or {}).get("output_cost") or float("inf")), row.key,
        ))
    elif policy == "quality":
        eligible.sort(key=lambda row: (-int((row.metadata or {}).get("context_limit") or 0), row.key))
    return eligible, excluded, constraints


def _router_key(model: Mapping[str, Any]) -> str:
    return f"{model.get('provider', '')}/{model.get('model', '')}/{model.get('endpoint', '')}"


def _circuit_open(model: Mapping[str, Any], owner_id: Any = "") -> bool:
    key = (_owner_scope(owner_id), _router_key(model))
    with _CIRCUIT_LOCK:
        state = _CIRCUITS.get(key) or {}
        return float(state.get("open_until") or 0) > time.monotonic()


def _note_router_result(model: Mapping[str, Any], success: bool, owner_id: Any = "") -> None:
    key = (_owner_scope(owner_id), _router_key(model))
    with _CIRCUIT_LOCK:
        state = _CIRCUITS.setdefault(key, {"failures": 0.0, "open_until": 0.0})
        if success:
            state.update(failures=0.0, open_until=0.0)
        else:
            state["failures"] = float(state.get("failures") or 0) + 1
            if state["failures"] >= 3:
                state["open_until"] = time.monotonic() + 30


def _owner_scope(owner_id: Any) -> str:
    """Normalize a server-established owner scope without storing raw identity data."""

    value = _clean_text(owner_id, 128)
    return value or _SINGLE_USER_OWNER_SCOPE


def _trace(record: dict[str, Any], *, owner_id: Any = None) -> None:
    owner_scope = _owner_scope(owner_id if owner_id is not None else record.get("_owner_scope"))
    forbidden = {
        "prompt", "messages", "api_key", "authorization", "access_token", "token", "secret",
        "verdict", "answer", "output", "content", "body", "response", "raw_response",
    }

    def scrub(value: Any) -> Any:
        if isinstance(value, Mapping):
            return {
                key: scrub(item)
                for key, item in value.items()
                if str(key).lower() not in forbidden
            }
        if isinstance(value, list):
            return [scrub(item) for item in value]
        if isinstance(value, tuple):
            return [scrub(item) for item in value]
        return value

    public = scrub(record)
    public.pop("_owner_scope", None)
    public["at"] = time.time()
    # These identifiers are safe routing metadata and must remain public even
    # when the surrounding record is recursively redacted.
    decision_id = public.get("decision_id")
    if not isinstance(decision_id, str) or not decision_id:
        decision_id = uuid.uuid4().hex
    public["decision_id"] = decision_id
    correlation_id = public.get("correlation_id")
    public["correlation_id"] = correlation_id if isinstance(correlation_id, str) and correlation_id else decision_id
    public["_owner_scope"] = owner_scope
    with _TRACE_LOCK:
        _TRACES.append(public)
    state = globals().get("_ROUTING_STATE")
    append_trace = getattr(state, "append_trace", None)
    if append_trace is not None:
        append_trace(public)


def _public_trace(row: Mapping[str, Any]) -> dict[str, Any]:
    return {key: deepcopy(value) for key, value in row.items() if not key.startswith("_")}


def decision_traces(
    *, profile: str = "", session_id: str = "", limit: int = 50, owner_id: Any = "",
) -> list[dict[str, Any]]:
    owner_scope = _owner_scope(owner_id)
    state = globals().get("_ROUTING_STATE")
    read_traces = getattr(state, "read_traces", None)
    if read_traces is not None:
        rows = read_traces(
            owner_scope=owner_scope,
            profile=profile,
            session_id=session_id,
            limit=limit,
        )
        if rows is not None:
            return [_public_trace(row) for row in rows]
        trace_store_enabled = getattr(state, "trace_store_enabled", None)
        if trace_store_enabled is not None and trace_store_enabled():
            return [{
                "category": "trace_store",
                "available": False,
                "reason": "routing trace history is unavailable",
            }]
    with _TRACE_LOCK:
        rows = list(_TRACES)
    rows = [row for row in rows if row.get("_owner_scope", _SINGLE_USER_OWNER_SCOPE) == owner_scope]
    if profile:
        rows = [row for row in rows if row.get("profile") == profile]
    if session_id:
        rows = [row for row in rows if row.get("session_id") == session_id]
    return [_public_trace(row) for row in rows[-max(1, min(200, int(limit or 50))):][::-1]]


def routing_metrics(*, profile: str = "", owner_id: Any = "") -> dict[str, Any]:
    rows = decision_traces(profile=profile, limit=200, owner_id=owner_id)
    latencies = sorted(float(row["latency_ms"]) for row in rows if isinstance(row.get("latency_ms"), (int, float)))
    selections: dict[str, int] = {}
    for row in rows:
        selected = row.get("selected") if isinstance(row.get("selected"), Mapping) else {}
        key = f"{selected.get('provider', '')}/{selected.get('model', '')}".strip("/")
        if key:
            selections[key] = selections.get(key, 0) + 1
    percentile = lambda ratio: latencies[min(len(latencies) - 1, int((len(latencies) - 1) * ratio))] if latencies else None
    return {
        "decisions": len(rows),
        "fallbacks": sum(bool(row.get("fallback")) for row in rows),
        "cache_hits": sum(bool(row.get("cache_hit")) for row in rows),
        "provider_errors": sum(bool(row.get("error")) for row in rows),
        "escalations": sum(row.get("category") == "escalation" and bool(row.get("routed")) for row in rows),
        "verifications": sum(row.get("category") == "verification" for row in rows),
        "shadow_disagreements": sum(bool((row.get("shadow") or {}).get("disagreed")) for row in rows if isinstance(row.get("shadow"), Mapping)),
        "latency_ms": {"p50": percentile(.5), "p95": percentile(.95)},
        "selection_frequency": selections,
    }


def _fallback_candidate(cfg: Mapping[str, Any], candidates: list[Candidate], native: Mapping[str, Any]) -> Optional[Candidate]:
    wanted = cfg.get("fallback") if isinstance(cfg.get("fallback"), Mapping) else {}
    pairs = [
        (_clean_text(wanted.get("provider"), 96).lower(), _clean_text(wanted.get("model"), 256)),
        (_clean_text(native.get("provider"), 96).lower(), _clean_text(native.get("model"), 256)),
    ]
    for provider, model in pairs:
        if provider and model:
            for candidate in candidates:
                if candidate.provider == provider and candidate.model == model:
                    return candidate
    return candidates[0] if candidates else None


def _adapter_name(decision_model: Mapping[str, Any]) -> str:
    adapter = str(decision_model.get("adapter") or "auto")
    if adapter != "auto":
        return adapter
    marker = f"{decision_model.get('provider', '')}/{decision_model.get('model', '')}".lower()
    return "system_one" if any(token in marker for token in ("d3", "jev", "typesafe", "semantic-router")) else "generic_structured"


def _extract_json(text: str) -> Any:
    stripped = str(text or "").strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*|\s*```$", "", stripped, flags=re.I | re.S)
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", stripped, flags=re.S)
        if match:
            return json.loads(match.group(0))
        raise


def _find_selected(value: Any) -> tuple[str, Optional[float], list[str]]:
    selected, confidence, ordered = "", None, []
    if isinstance(value, Mapping):
        for key in ("selected", "choice", "answer", "route", "model", "label"):
            raw = value.get(key)
            if isinstance(raw, str) and raw.strip():
                selected = raw.strip()
                break
            if isinstance(raw, Mapping):
                nested, nested_conf, nested_ordered = _find_selected(raw)
                selected, confidence, ordered = nested or selected, nested_conf, nested_ordered
        for key in ("confidence", "probability", "score"):
            raw = value.get(key)
            if isinstance(raw, (int, float)) and not isinstance(raw, bool):
                confidence = max(0.0, min(1.0, float(raw)))
                break
        for key in ("selected_tools", "tools", "ranking", "ordered"):
            raw = value.get(key)
            if isinstance(raw, list):
                ordered = [_clean_text(item.get("name") if isinstance(item, Mapping) else item, 256) for item in raw]
                ordered = [item for item in ordered if item]
                break
        if not selected:
            for raw in value.values():
                nested, nested_conf, nested_ordered = _find_selected(raw)
                if nested:
                    return nested, confidence if confidence is not None else nested_conf, ordered or nested_ordered
    elif isinstance(value, list):
        for raw in value:
            nested, nested_conf, nested_ordered = _find_selected(raw)
            if nested:
                return nested, nested_conf, nested_ordered
    return selected, confidence, ordered


def _system_one_decision(
    cfg: Mapping[str, Any], prompt: str, candidates: list[Candidate],
    *, decision_model: Optional[Mapping[str, Any]] = None, decision_type: str = "select_model",
) -> tuple[str, Optional[float], list[str]]:
    decision_model = decision_model or cfg["decision_model"]
    endpoint = str(decision_model.get("endpoint") or "").rstrip("/")
    api_key = None
    if not endpoint:
        from agent.auxiliary_client import _resolve_task_provider_model

        _, _, base_url, api_key, _ = _resolve_task_provider_model(
            ROUTER_TASK, decision_model.get("provider"), decision_model.get("model")
        )
        endpoint = str(base_url or "").rstrip("/")
    if not endpoint:
        raise ValueError("The decision model has no System One endpoint")
    if not endpoint.endswith(("/v1/decisions", "/v1/systemone", "/systemone")):
        endpoint += "/v1/decisions"
    choices = [{"label": candidate.key, "description": candidate.label or candidate.key} for candidate in candidates]
    payload = {
        "state": prompt[:12000],
        "model": decision_model.get("model"),
        "context": {"decision_type": decision_type, "policy": cfg["policy"]},
        "questions": [{"type": "choice", "id": "route", "prompt": f"Choose the best eligible candidate for {decision_type} under the stated policy.", "choices": choices}],
    }
    headers = {"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "judge-m-control-plane/0.4"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = Request(endpoint, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    # Resolve and validate exactly once immediately before opening the socket;
    # the transport pins that validated address to close the DNS/connect race.
    _, pinned_address = _validated_endpoint(endpoint)
    with _decision_opener(pinned_address).open(request, timeout=int(cfg["timeout_seconds"])) as response:
        result = json.loads(response.read().decode("utf-8"))
    return _find_selected(result)


def _generic_decision(
    cfg: Mapping[str, Any], prompt: str, candidates: list[Candidate], *,
    tool_names: Optional[list[str]] = None, decision_model: Optional[Mapping[str, Any]] = None,
    decision_type: str = "select_model",
) -> tuple[str, Optional[float], list[str]]:
    from agent.auxiliary_client import call_llm, extract_content_or_reasoning

    decision_model = decision_model or cfg["decision_model"]
    choice_lines = "\n".join(f"- {candidate.key}: {candidate.label or candidate.key}" for candidate in candidates)
    if tool_names is None:
        contract = 'Return JSON only: {"selected":"provider/model"}. Do not invent a route.'
    else:
        contract = 'Return JSON only: {"selected_tools":["exact_tool_name", ...]}. Include only tools needed for the task, in best-first order.'
    messages = [
        {"role": "system", "content": f"You are a deterministic {decision_type} routing classifier. " + contract},
        {"role": "user", "content": f"Policy: {cfg['policy']}\nDecision type: {decision_type}\nTask:\n{prompt[:12000]}\nEligible choices:\n{choice_lines}"},
    ]
    response = call_llm(
        messages=messages, task=ROUTER_TASK, provider=decision_model.get("provider") or None,
        model=decision_model.get("model") or None, timeout=int(cfg["timeout_seconds"]),
        temperature=0, max_tokens=800,
    )
    text = response if isinstance(response, str) else extract_content_or_reasoning(response)
    return _find_selected(_extract_json(text))


def _invoke_decision(
    cfg: Mapping[str, Any], prompt: str, rows: list[Candidate], decision_model: Mapping[str, Any],
    *, decision_type: str = "select_model", tool_names: Optional[list[str]] = None,
    owner_id: Any = "",
) -> tuple[str, Optional[float], list[str], str, int]:
    if not decision_model.get("provider") or not decision_model.get("model"):
        raise ValueError("decision model is not configured")
    owner_scope = _owner_scope(owner_id)
    if _circuit_open(decision_model, owner_scope):
        raise RuntimeError("decision backend circuit is temporarily open")
    adapter = _adapter_name(decision_model)
    started = time.monotonic()
    try:
        if adapter == "system_one":
            selected, score, ordered = _system_one_decision(
                cfg, prompt, rows, decision_model=decision_model, decision_type=decision_type,
            )
        else:
            selected, score, ordered = _generic_decision(
                cfg, prompt, rows, tool_names=tool_names, decision_model=decision_model,
                decision_type=decision_type,
            )
        _note_router_result(decision_model, True, owner_scope)
        return selected, score, ordered, adapter, round((time.monotonic() - started) * 1000)
    except Exception:
        _note_router_result(decision_model, False, owner_scope)
        raise


def decide(
    *, profile: str, slot: str, task: str, prompt: str, candidates: Iterable[Any],
    native: Optional[Mapping[str, Any]] = None, session_id: str = "",
    requirements: Optional[Mapping[str, Any]] = None, owner_id: Any = "",
) -> dict[str, Any]:
    owner_scope = _owner_scope(owner_id)
    cfg = load_config(profile)
    all_rows = _candidate_rows(candidates)
    rows, excluded, constraints = _policy_filter(all_rows, cfg["policy"], requirements=requirements)
    fallback = _fallback_candidate(cfg, rows, native or {})
    mode = slot_mode(cfg, slot, task)
    base = {
        "enabled": cfg["enabled"], "mode": mode, "configured_mode": (
            ((cfg.get("slots") or {}).get("auxiliary") or {}).get(task, {}).get("mode", "inherit")
            if slot == "auxiliary" else ((cfg.get("slots") or {}).get(slot) or {}).get("mode", "inherit")
        ),
        "slot": slot, "task": task, "category": "model", "policy": cfg["policy"],
        "profile": profile, "session_id": session_id, "config_version": _config_version(cfg),
        "prompt_fingerprint": _prompt_fingerprint(prompt), "candidate_count": len(rows),
        "eligible": [row.key for row in rows], "excluded": excluded, "constraints": constraints,
    }
    if not cfg["enabled"] or mode != "semantic" or task == ROUTER_TASK:
        result = {**base, "routed": False, "selected": None, "reason": "native route retained"}
        if cfg["enabled"]:
            _trace(result, owner_id=owner_scope)
        return result
    if not rows:
        result = {**base, "routed": False, "selected": None, "fallback": True, "reason": "no eligible models"}
        _trace(result, owner_id=owner_scope)
        return result

    decision_model = cfg["decision_model"]
    cache_cfg = cfg["cache"]
    cache_key = json.dumps([
        owner_scope, profile, session_id, slot, task, base["config_version"], _router_key(decision_model),
        base["prompt_fingerprint"], [row.public() for row in rows],
    ], sort_keys=True, separators=(",", ":"))
    now = time.monotonic()
    if cache_cfg["enabled"]:
        with _CACHE_LOCK:
            cached = _CACHE.get(cache_key)
            if cached and cached[0] > now:
                result = {**deepcopy(cached[1]), "cache_hit": True, "latency_ms": 0}
                _trace(result, owner_id=owner_scope)
                return result

    started = time.monotonic()
    try:
        selected_key, score, _ordered, adapter, latency = _invoke_decision(
            cfg, prompt, rows, decision_model, decision_type="select_model", owner_id=owner_scope,
        )
        selected = next((row for row in rows if selected_key.lower() in {row.key.lower(), row.model.lower()}), None)
        if selected is None:
            raise ValueError("decision model returned a route outside the eligible set")
        result = {
            **base, "routed": True, "selected": selected.public(), "adapter": adapter,
            "decision_model": {"provider": decision_model["provider"], "model": decision_model["model"]},
            "latency_ms": latency, "cache_hit": False,
        }
        if score is not None:
            result["reported_score"] = score

        shadow_cfg = cfg["shadow"]
        shadow_model = shadow_cfg["decision_model"]
        if shadow_cfg["enabled"] and shadow_model.get("provider") and shadow_model.get("model"):
            try:
                shadow_key, shadow_score, _ranking, shadow_adapter, shadow_latency = _invoke_decision(
                    cfg, prompt, rows, shadow_model, decision_type="select_model", owner_id=owner_scope,
                )
                shadow_selected = next((row for row in rows if shadow_key.lower() in {row.key.lower(), row.model.lower()}), None)
                result["shadow"] = {
                    "selected": shadow_selected.public() if shadow_selected else None,
                    "decision_model": {"provider": shadow_model["provider"], "model": shadow_model["model"]},
                    "adapter": shadow_adapter, "latency_ms": shadow_latency,
                    "reported_score": shadow_score, "disagreed": bool(shadow_selected and shadow_selected.key != selected.key),
                    "controlled_execution": False,
                }
            except Exception as exc:
                result["shadow"] = {"error": _public_error(exc), "controlled_execution": False}
    except Exception as exc:
        logger.warning("Semantic routing fell back for %s/%s: %s", slot, task, exc)
        result = {
            **base, "routed": fallback is not None, "selected": fallback.public() if fallback else None,
            "fallback": True, "error": _public_error(exc),
            "reason": "configured eligible fallback" if fallback else "native route retained",
            "latency_ms": round((time.monotonic() - started) * 1000),
        }
    _trace(result, owner_id=owner_scope)
    if cache_cfg["enabled"] and result.get("routed") and not result.get("fallback"):
        with _CACHE_LOCK:
            if len(_CACHE) >= int(cache_cfg["max_entries"]):
                oldest = min(_CACHE, key=lambda key: _CACHE[key][0])
                _CACHE.pop(oldest, None)
            _CACHE[cache_key] = (now + int(cache_cfg["ttl_seconds"]), deepcopy(result))
    return result


def _resource_decision_model(cfg: Mapping[str, Any], resource: str) -> dict[str, Any]:
    controls = cfg.get(resource) if isinstance(cfg.get(resource), Mapping) else {}
    dedicated = controls.get("decision_model") if isinstance(controls.get("decision_model"), Mapping) else {}
    return dict(dedicated) if dedicated.get("provider") and dedicated.get("model") else dict(cfg["decision_model"])


def route_tools(
    *, profile: str, prompt: str, tools: list[dict[str, Any]], session_id: str = "", turn_id: str = "",
    owner_id: Any = "",
) -> tuple[list[dict[str, Any]], Optional[dict[str, Any]]]:
    owner_scope = _owner_scope(owner_id)
    cfg = load_config(profile)
    controls = cfg["tool_routing"]
    if not cfg["enabled"] or not controls["enabled"] or not cfg["context_optimization"]["tool_narrowing"] or len(tools) < 2:
        return tools, None
    names = [_clean_text(tool.get("function", {}).get("name") if isinstance(tool.get("function"), Mapping) else tool.get("name"), 256) for tool in tools]
    authorized = {name: tool for name, tool in zip(names, tools) if name}
    turn_key = (owner_scope, profile, session_id, turn_id)
    if turn_id:
        with _TOOL_SELECTIONS_LOCK:
            pinned = _TOOL_SELECTIONS.get(turn_key)
        if pinned is not None:
            routed = [authorized[name] for name in pinned if name in authorized]
            if routed:
                return routed, {"category": "tools", "routed": True, "pinned": True, "selected_tools": pinned,
                                "profile": profile, "session_id": session_id, "turn_id": turn_id}
    rows = []
    for name, tool in zip(names, tools):
        function = tool.get("function") if isinstance(tool.get("function"), Mapping) else tool
        description = _clean_text(function.get("description") if isinstance(function, Mapping) else "", 500)
        if name:
            rows.append(Candidate("tool", name, description or name))
    decision_model = _resource_decision_model(cfg, "tool_routing")
    started = time.monotonic()
    try:
        selected, score, ordered, adapter, latency = _invoke_decision(
            cfg, prompt, rows, decision_model, decision_type="select_tools", tool_names=names,
            owner_id=owner_scope,
        )
        if not ordered and selected:
            ordered = [selected]
        selected_names = []
        for name in ordered:
            normalized = name.removeprefix("tool/")
            if normalized in authorized and normalized not in selected_names:
                selected_names.append(normalized)
        if not selected_names:
            raise ValueError("decision model did not return authorized tool names")
        final_names = selected_names[: int(controls["max_tools"])]
        routed = [authorized[name] for name in final_names]
        if turn_id:
            with _TOOL_SELECTIONS_LOCK:
                _TOOL_SELECTIONS[turn_key] = list(final_names)
                if len(_TOOL_SELECTIONS) > 256:
                    _TOOL_SELECTIONS.pop(next(iter(_TOOL_SELECTIONS)))
        trace = {
            "enabled": True, "routed": True, "slot": "tools", "category": "tools", "task": "tool_selection",
            "profile": profile, "session_id": session_id, "turn_id": turn_id, "policy": cfg["policy"],
            "prompt_fingerprint": _prompt_fingerprint(prompt), "candidate_count": len(tools),
            "eligible": names, "excluded": [], "config_version": _config_version(cfg),
            "selected_tools": final_names, "adapter": adapter, "latency_ms": latency,
        }
        if score is not None:
            trace["reported_score"] = score
        _trace(trace, owner_id=owner_scope)
        return routed, trace
    except Exception as exc:
        trace = {
            "enabled": True, "routed": False, "fallback": True, "slot": "tools", "category": "tools", "task": "tool_selection",
            "profile": profile, "session_id": session_id, "turn_id": turn_id, "policy": cfg["policy"],
            "prompt_fingerprint": _prompt_fingerprint(prompt), "candidate_count": len(tools),
            "eligible": names, "excluded": [], "config_version": _config_version(cfg),
            "error": _public_error(exc), "reason": "native authorized tool set retained",
            "latency_ms": round((time.monotonic() - started) * 1000),
        }
        _trace(trace, owner_id=owner_scope)
        return tools, trace


def route_memory(
    *, profile: str, prompt: str, sources: list[str], session_id: str = "",
    owner_id: Any = "",
) -> tuple[list[str], Optional[dict[str, Any]]]:
    """Select only from memory providers Hermes already authorized for this turn."""
    owner_scope = _owner_scope(owner_id)
    cfg = load_config(profile)
    controls = cfg["memory_routing"]
    authorized = list(dict.fromkeys(_clean_text(source, 128) for source in sources if _clean_text(source, 128)))
    if not cfg["enabled"] or not controls["enabled"] or not cfg["context_optimization"]["memory_routing"] or not authorized:
        return authorized, None
    rows = [Candidate("memory", source, f"Authorized Hermes memory source: {source}") for source in authorized]
    if controls["allow_skip"]:
        rows.append(Candidate("memory", "__skip__", "Skip memory retrieval when it cannot help this request"))
    decision_model = _resource_decision_model(cfg, "memory_routing")
    started = time.monotonic()
    try:
        selected, score, _ordered, adapter, latency = _invoke_decision(
            cfg, prompt, rows, decision_model, decision_type=f"select_memory:{controls['strategy']}",
            owner_id=owner_scope,
        )
        selected_name = selected.removeprefix("memory/")
        if selected_name == "__skip__" and controls["allow_skip"]:
            routed: list[str] = []
        elif selected_name in authorized:
            routed = [selected_name]
        else:
            raise ValueError("decision model returned an unauthorized memory source")
        trace = {
            "enabled": True, "routed": True, "slot": "memory", "category": "memory", "task": "memory_selection",
            "profile": profile, "session_id": session_id, "policy": cfg["policy"], "strategy": controls["strategy"],
            "prompt_fingerprint": _prompt_fingerprint(prompt), "candidate_count": len(authorized),
            "eligible": authorized + (["__skip__"] if controls["allow_skip"] else []), "excluded": [],
            "selected_memory": routed, "skipped": not routed, "adapter": adapter, "latency_ms": latency,
            "config_version": _config_version(cfg),
        }
        if score is not None:
            trace["reported_score"] = score
        _trace(trace, owner_id=owner_scope)
        return routed, trace
    except Exception as exc:
        trace = {
            "enabled": True, "routed": False, "fallback": True, "slot": "memory", "category": "memory",
            "task": "memory_selection", "profile": profile, "session_id": session_id, "policy": cfg["policy"],
            "prompt_fingerprint": _prompt_fingerprint(prompt), "candidate_count": len(authorized),
            "eligible": authorized, "excluded": [], "config_version": _config_version(cfg),
            "error": _public_error(exc), "reason": "native authorized memory sources retained",
            "latency_ms": round((time.monotonic() - started) * 1000),
        }
        _trace(trace, owner_id=owner_scope)
        return authorized, trace


def evaluate_escalation(
    *, profile: str, session_id: str, current: Mapping[str, Any], candidates: Iterable[Any],
    error_count: int = 0, side_effects: bool = False, owner_id: Any = "",
) -> dict[str, Any]:
    """Choose a next-turn model only; never replay a turn or an external action."""
    owner_scope = _owner_scope(owner_id)
    cfg = load_config(profile)
    controls = cfg["escalation"]
    base = {
        "category": "escalation", "slot": "primary", "task": "safe_escalation", "profile": profile,
        "session_id": session_id, "config_version": _config_version(cfg), "routed": False,
    }
    key = (owner_scope, profile, session_id)
    with _ESCALATION_LOCK:
        used = _ESCALATIONS.get(key, 0)
    if not controls["enabled"]:
        return {**base, "reason": "escalation disabled"}
    if side_effects and not controls["allow_after_side_effects"]:
        result = {**base, "reason": "blocked after a side-effecting tool action"}; _trace(result, owner_id=owner_scope); return result
    if int(error_count or 0) < controls["error_threshold"]:
        return {**base, "reason": "error threshold not reached"}
    if used >= controls["max_per_session"]:
        result = {**base, "reason": "session escalation limit reached"}; _trace(result, owner_id=owner_scope); return result
    rows, excluded, constraints = _policy_filter(_candidate_rows(candidates), cfg["policy"])
    allow = {f"{row['provider']}/{row['model']}".lower() for row in controls["eligible_models"]}
    if allow:
        rows = [row for row in rows if row.key.lower() in allow]
    current_key = f"{current.get('provider', '')}/{current.get('model', '')}".lower()
    selected = next((row for row in rows if row.key.lower() != current_key), None)
    if selected is None:
        result = {**base, "reason": "no different eligible escalation model", "excluded": excluded}; _trace(result, owner_id=owner_scope); return result
    with _ESCALATION_LOCK:
        _ESCALATIONS[key] = used + 1
    result = {
        **base, "routed": True, "selected": selected.public(), "apply": "next_turn_only",
        "replayed": False, "side_effects_replayed": False, "eligible": [row.key for row in rows],
        "excluded": excluded, "constraints": constraints,
    }
    _trace(result, owner_id=owner_scope)
    return result


def verify_output(
    *, profile: str, prompt: str, output: str, session_id: str = "",
    owner_id: Any = "",
) -> dict[str, Any]:
    """Run bounded, tool-free auxiliary verification; this never executes user tools."""
    cfg = load_config(profile)
    controls = cfg["verification"]
    base = {"category": "verification", "slot": "verification", "task": "verify_output", "profile": profile,
            "session_id": session_id, "config_version": _config_version(cfg), "routed": False}
    if not controls["enabled"] or not controls["models"]:
        return {**base, "reason": "verification disabled or no verifier models configured", "verdicts": []}
    from agent.auxiliary_client import call_llm, extract_content_or_reasoning
    content = output[: controls["max_output_chars"]]
    models = controls["models"][: controls["model_count"]]

    def run_verifier(model: Mapping[str, str]) -> dict[str, Any]:
        try:
            response = call_llm(
                messages=[
                    {"role": "system", "content": "Verify the answer for factual, logical, safety, and task-completion problems. Do not call tools. Return concise JSON."},
                    {"role": "user", "content": f"Request:\n{prompt[:12000]}\n\nAnswer:\n{content}"},
                ], task="judge_m_verification", provider=model["provider"], model=model["model"],
                timeout=controls["timeout_seconds"], temperature=0, max_tokens=1000,
            )
            text = response if isinstance(response, str) else extract_content_or_reasoning(response)
            return {"provider": model["provider"], "model": model["model"], "verdict": _clean_text(text, 8000)}
        except Exception as exc:
            return {"provider": model["provider"], "model": model["model"], "error": _public_error(exc)}

    verdicts: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=len(models), thread_name_prefix="semantic-verify") as pool:
        futures = {pool.submit(run_verifier, model): index for index, model in enumerate(models)}
        indexed = [(futures[future], future.result()) for future in as_completed(futures)]
        verdicts = [value for _index, value in sorted(indexed)]

    synthesis = None
    synthesis_model = controls["synthesis_model"]
    if synthesis_model.get("provider") and synthesis_model.get("model"):
        try:
            response = call_llm(
                messages=[
                    {"role": "system", "content": "Reconcile independent verifier findings. Do not call tools. Distinguish agreement from evidence and return a concise consolidated verdict."},
                    {"role": "user", "content": json.dumps({"request": prompt[:12000], "answer": content, "verdicts": verdicts}, ensure_ascii=False)},
                ], task="judge_m_verification_synthesis", provider=synthesis_model["provider"],
                model=synthesis_model["model"], timeout=controls["timeout_seconds"],
                temperature=0, max_tokens=1200,
            )
            text = response if isinstance(response, str) else extract_content_or_reasoning(response)
            synthesis = {"provider": synthesis_model["provider"], "model": synthesis_model["model"],
                         "verdict": _clean_text(text, 10000)}
        except Exception as exc:
            synthesis = {"provider": synthesis_model["provider"], "model": synthesis_model["model"],
                         "error": _public_error(exc)}
    result = {**base, "routed": True, "verdicts": verdicts, "tool_calls_allowed": False,
              "parallel": len(models) > 1, "synthesis": synthesis,
              "prompt_fingerprint": _prompt_fingerprint(prompt)}
    _trace(result, owner_id=_owner_scope(owner_id))
    return result


def record_outcome(*, decision_id: str, outcome: Mapping[str, Any], owner_id: Any = "") -> bool:
    """Attach bounded outcome metadata to a recent redacted trace."""
    allowed = {key: deepcopy(outcome[key]) for key in ("status", "latency_ms", "error_count", "cancelled") if key in outcome}
    owner_scope = _owner_scope(owner_id)
    updated = False
    state = globals().get("_ROUTING_STATE")
    update_trace_outcome = getattr(state, "update_trace_outcome", None)
    if update_trace_outcome is not None:
        updated = update_trace_outcome(
            owner_scope=owner_scope,
            decision_id=decision_id,
            outcome=allowed,
        )
    with _TRACE_LOCK:
        for row in reversed(_TRACES):
            if row.get("decision_id") == decision_id and row.get("_owner_scope", _SINGLE_USER_OWNER_SCOPE) == owner_scope:
                row["outcome"] = allowed
                updated = True
                break
    return updated


def middleware_profile(context: Mapping[str, Any]) -> str:
    value = context.get("profile") or context.get("profile_name")
    if value:
        return _clean_text(value, 96)
    try:
        from hermes_cli.profiles import current_profile_name

        return current_profile_name(default="default") or "default"
    except Exception:
        return "default"
