"""Backend for the Judge-M Hermes control-plane and typed CLI bridge."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import importlib.util
import ipaddress
import json
import logging
import os
import socket
from pathlib import Path
import secrets
import sys
import tempfile
import threading
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request as UrlRequest, urlopen

from fastapi import APIRouter, HTTPException, Request, Response


router = APIRouter()
logger = logging.getLogger(__name__)

PORTAL_URL = os.environ.get(
    "HERMES_COCKPIT_PORTAL_URL",
    os.environ.get("JUDGEM_CONSOLE_URL", ""),
).strip().rstrip("/")


def _configured_links() -> list[dict[str, str]]:
    """Load optional operator links without shipping one installation's topology."""
    links: list[dict[str, str]] = []
    if PORTAL_URL:
        links.extend([
            {"id": "portal", "name": "Operations portal", "kind": "Unified portal", "url": f"{PORTAL_URL}/"},
            {"id": "hermes", "name": "Hermes Web", "kind": "Web dashboard", "url": f"{PORTAL_URL}/hermes/"},
        ])

    raw = os.environ.get("HERMES_COCKPIT_LINKS_JSON", "").strip()
    if not raw:
        return links
    try:
        configured = json.loads(raw)
    except (TypeError, ValueError):
        return links
    if not isinstance(configured, list):
        return links

    for index, item in enumerate(configured[:32]):
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            continue
        link_id = str(item.get("id") or f"service-{index + 1}").strip()[:64]
        name = str(item.get("name") or link_id).strip()[:96]
        kind = str(item.get("kind") or "Service").strip()[:96]
        links.append({"id": link_id, "name": name, "kind": kind, "url": url})
    return links


LINKS = _configured_links()

_CACHE: dict[str, Any] = {"at": 0.0, "payload": None}
PREFERENCES_ROOT = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))) / "judge-m-control-plane"
PREFERENCES_FILE = PREFERENCES_ROOT / "model-menu.json"
_PREFERENCE_LOCKS: dict[str, threading.Lock] = {}
_PREFERENCE_LOCKS_GUARD = threading.Lock()
_BROWSER_PREVIEW_SALT = secrets.token_bytes(32)
_BROWSER_FRAME_LIMIT = 8 * 1024 * 1024
_SINGLE_USER_OWNER_SCOPE = "__single_user__"
_HOSTED_OWNER_HEADER = "x-hermes-owner-scope"


def _valid_owner_scope(value: str) -> bool:
    return value == _SINGLE_USER_OWNER_SCOPE or (
        len(value) == 64 and all(char in "0123456789abcdef" for char in value)
    )


def _owner_key(request: Request) -> str:
    """Return the server-established owner scope for an authenticated request.

    Cookie/bearer sessions expose a stable provider + subject identity.  Legacy
    loopback Hermes deployments do not attach a user session, but their global
    dashboard gate is explicitly single-user; retain that mode under a distinct
    process scope.  Anything else fails closed rather than treating a caller
    supplied profile/session/preview id as an authorization grant.
    """

    app_state = getattr(getattr(request, "app", None), "state", None)
    if app_state is not None and getattr(app_state, "hosted_plugin_internal", False):
        forwarded = str(request.headers.get(_HOSTED_OWNER_HEADER) or "").strip().lower()
        if _valid_owner_scope(forwarded):
            return forwarded
        raise HTTPException(status_code=401, detail="The hosted plugin request has no verified owner scope")
    if app_state is not None and getattr(app_state, "auth_required", None) is False:
        return _SINGLE_USER_OWNER_SCOPE

    state = getattr(request, "state", None)
    session = getattr(state, "session", None)
    if isinstance(session, dict):
        issuer = session.get("provider") or session.get("iss")
        subject = session.get("sub") or session.get("user_id") or session.get("id")
    elif session is not None:
        issuer = getattr(session, "provider", None) or getattr(session, "iss", None)
        subject = getattr(session, "sub", None) or getattr(session, "user_id", None) or getattr(session, "id", None)
    else:
        issuer = subject = None
    if issuer and subject:
        source = {"issuer": str(issuer), "subject": str(subject)}
        serialized = json.dumps(source, sort_keys=True, default=str)
        return hashlib.sha256(serialized.encode("utf-8", errors="replace")).hexdigest()

    principal = getattr(state, "token_principal", None) or getattr(state, "principal", None)
    if principal is not None:
        provider = getattr(principal, "provider", None)
        value = getattr(principal, "principal", None)
        if provider and value:
            source = {"issuer": str(provider), "subject": str(value)}
            serialized = json.dumps(source, sort_keys=True, default=str)
            return hashlib.sha256(serialized.encode("utf-8", errors="replace")).hexdigest()

    raise HTTPException(status_code=401, detail="An authenticated dashboard user session is required")


def _fetch_json(url: str, timeout: float = 4.0) -> dict[str, Any]:
    request = UrlRequest(url, headers={"Accept": "application/json", "User-Agent": "judge-m-control-plane/0.1"})
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


async def _load_overview() -> dict[str, Any]:
    now = time.monotonic()
    if _CACHE["payload"] is not None and now - float(_CACHE["at"]) < 5:
        return _CACHE["payload"]

    if not PORTAL_URL:
        result = {
            "ok": False,
            "source": None,
            "error": "Optional operations portal is not configured.",
            "overview": None,
            "links": LINKS,
        }
        _CACHE.update(at=now, payload=result)
        return result

    try:
        overview = await asyncio.to_thread(_fetch_json, f"{PORTAL_URL}/api/overview")
        result = {
            "ok": True,
            "source": PORTAL_URL,
            "overview": overview,
            "links": LINKS,
        }
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        logger.warning("Optional operations portal overview request failed", exc_info=True)
        result = {
            "ok": False,
            "source": PORTAL_URL,
            "error": "The optional operations portal is unavailable.",
            "overview": None,
            "links": LINKS,
        }

    _CACHE.update(at=now, payload=result)
    return result


def _preferences_file(owner_key: str = "") -> Path:
    if not owner_key or owner_key == _SINGLE_USER_OWNER_SCOPE:
        return PREFERENCES_FILE
    digest = hashlib.sha256(str(owner_key).encode("utf-8", errors="replace")).hexdigest()[:32]
    return PREFERENCES_ROOT / f"model-menu-{digest}.json"


def _read_model_preferences(owner_key: str = "") -> dict[str, Any]:
    path = _preferences_file(owner_key)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _clean_model_preferences(body: dict[str, Any]) -> dict[str, Any]:
    raw_providers = body.get("providers") if isinstance(body, dict) else {}
    raw_providers = raw_providers if isinstance(raw_providers, dict) else {}
    providers: dict[str, Any] = {}
    for raw_slug, raw in list(raw_providers.items())[:64]:
        slug = str(raw_slug).strip().lower()[:96]
        if not slug or not isinstance(raw, dict):
            continue
        visible = []
        seen = set()
        for value in raw.get("visible_models") or []:
            model_id = str(value).strip()[:256]
            if model_id and model_id.lower() not in seen and len(visible) < 512:
                seen.add(model_id.lower())
                visible.append(model_id)
        routing = []
        routing_seen = set()
        for value in raw.get("routing_models") or []:
            model_id = str(value).strip()[:256]
            if model_id and model_id.lower() not in routing_seen and len(routing) < 512:
                routing_seen.add(model_id.lower())
                routing.append(model_id)
        labels = {}
        if isinstance(raw.get("labels"), dict):
            for model_id, label in list(raw["labels"].items())[:512]:
                model_id, label = str(model_id).strip()[:256], str(label).strip()[:80]
                if model_id and label:
                    labels[model_id] = label
        providers[slug] = {
            "enabled": bool(raw.get("enabled", True)),
            "mode": "curated" if raw.get("mode") == "curated" else "all",
            "visible_models": visible,
            "routing_models": routing,
            "labels": labels,
        }
    order = []
    for value in body.get("provider_order") or []:
        slug = str(value).strip().lower()[:96]
        if slug and slug not in order and len(order) < 64:
            order.append(slug)
    return {"version": 1, "provider_order": order, "providers": providers, "updated_at": int(time.time())}


def _write_model_preferences(preferences: dict[str, Any], owner_key: str = "") -> None:
    path = _preferences_file(owner_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    with _PREFERENCE_LOCKS_GUARD:
        lock = _PREFERENCE_LOCKS.setdefault(str(path), threading.Lock())
    with lock:
        temporary_name = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=path.parent,
                prefix=f".{path.name}.",
                suffix=".tmp",
                delete=False,
            ) as temporary:
                temporary_name = temporary.name
                os.chmod(temporary.name, 0o600)
                temporary.write(json.dumps(preferences, indent=2, sort_keys=True) + "\n")
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_name, path)
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
        finally:
            if temporary_name:
                try:
                    os.unlink(temporary_name)
                except FileNotFoundError:
                    pass


def _model_catalog(refresh: bool = False, owner_key: str = "") -> dict[str, Any]:
    from hermes_cli.inventory import build_model_options_payload, load_picker_context

    payload = build_model_options_payload(
        load_picker_context(), include_unconfigured=True, refresh=bool(refresh)
    )
    rows = []
    for raw in payload.get("providers") or []:
        slug = str(raw.get("slug") or "").strip().lower()
        if not slug:
            continue
        models = [str(model) for model in (raw.get("models") or []) if str(model).strip()]
        authenticated = bool(raw.get("authenticated"))
        user_defined = bool(raw.get("is_user_defined"))
        endpoint = str(
            raw.get("base_url") or raw.get("api_url") or raw.get("endpoint") or raw.get("api_base") or ""
        ).strip()
        local = bool(raw.get("local") is True or raw.get("is_local") is True)
        if endpoint and not local:
            host = (urlparse(endpoint).hostname or "").strip("[]").lower()
            try:
                address = ipaddress.ip_address(host)
                local = bool((address.is_private or address.is_loopback) and not address.is_link_local)
            except ValueError:
                local = host == "localhost" or host.endswith(".local")
        metadata = raw.get("model_metadata") if isinstance(raw.get("model_metadata"), dict) else {}
        rows.append({
            "slug": slug,
            "name": str(raw.get("name") or raw.get("label") or slug),
            "models": models,
            "current": bool(raw.get("is_current")),
            "configured": bool(authenticated or user_defined or models),
            "authenticated": authenticated,
            "user_defined": user_defined,
            "total_models": int(raw.get("total_models") or len(models)),
            "warning": str(raw.get("warning") or ""),
            "source": str(raw.get("source") or ""),
            "local": local,
            "model_metadata": metadata,
        })
    return {
        "providers": rows,
        "current": {"provider": payload.get("provider") or "", "model": payload.get("model") or ""},
        "preferences": _read_model_preferences(owner_key),
    }


@router.get("/health")
async def health():
    return {"ok": True, "plugin": "judge-m-control-plane", "mode": "control-plane"}


@router.get("/overview")
async def overview():
    """Return a normalized, read-only snapshot for web and desktop clients."""

    return await _load_overview()


@router.get("/links")
async def links():
    return {"links": LINKS}


@router.get("/model-menu")
async def model_menu(request: Request, refresh: bool = False):
    """Live provider catalog plus the user's hosted prompt-menu curation."""

    owner_key = _owner_key(request)
    try:
        return {"ok": True, **(await asyncio.to_thread(_model_catalog, refresh, owner_key))}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unable to load the model catalog")
        raise HTTPException(
            status_code=503,
            detail="The provider and model inventory is temporarily unavailable.",
        ) from exc


@router.post("/model-menu")
async def save_model_menu(body: dict[str, Any], request: Request):
    """Persist the allow-list, labels, and provider order for Judge-M prompt menus."""

    preferences = _clean_model_preferences(body)
    await asyncio.to_thread(_write_model_preferences, preferences, _owner_key(request))
    return {"ok": True, "preferences": preferences}


def _load_semantic_routing_module():
    """Load the runtime module when dashboard APIs are mounted standalone by Hermes."""

    state_path = (Path(__file__).parent.parent / "routing_state.py").resolve()

    def resolved_path(module):
        value = getattr(module, "__file__", None)
        if not value:
            return None
        try:
            return Path(value).resolve()
        except (OSError, RuntimeError, TypeError, ValueError):
            return None

    state_module = next(
        (
            module for module in list(sys.modules.values())
            if resolved_path(module) == state_path
        ),
        None,
    )
    module_name = "judge_m_control_plane_routing_state"
    if state_module is None:
        state_module = sys.modules.get(module_name)
        if state_module is not None and resolved_path(state_module) != state_path:
            raise RuntimeError(
                f"Canonical routing-state alias points to {resolved_path(state_module)}"
            )
    if state_module is None:
        spec = importlib.util.spec_from_file_location(module_name, state_path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Could not load shared routing state from {state_path}")
        state_module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = state_module
        try:
            spec.loader.exec_module(state_module)
        except Exception:
            sys.modules.pop(module_name, None)
            raise
    loader = getattr(state_module, "load_semantic_routing", None)
    if loader is None:
        raise RuntimeError(f"Shared routing state has no semantic-routing loader: {state_path}")
    return loader()


@router.get("/semantic-routing")
async def semantic_routing_config(request: Request, profile: str = "default"):
    """Return profile-scoped native semantic-routing controls and eligible models."""

    module = _load_semantic_routing_module()
    catalog = await asyncio.to_thread(_model_catalog, False, _owner_key(request))
    config = await asyncio.to_thread(module.load_config, profile)
    candidates = [candidate.public() for candidate in module.candidates_from_catalog(catalog, config["policy"])]
    return {"ok": True, "profile": profile, "config": config, "candidates": candidates}


@router.put("/semantic-routing")
async def save_semantic_routing_config(body: dict[str, Any], request: Request, profile: str = "default"):
    """Validate and atomically persist profile-scoped semantic-routing controls."""

    module = _load_semantic_routing_module()
    # Keep the profile selector intentionally user-scoped: Hermes profiles are
    # operator-managed configuration namespaces, while the dashboard request
    # still must be authenticated before a write is allowed.
    _owner_key(request)
    try:
        config = await asyncio.to_thread(module.save_config, profile, body)
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "profile": profile, "config": config}


@router.post("/semantic-routing/decide")
async def semantic_routing_decide(body: dict[str, Any], request: Request):
    """Resolve one requested slot to a concrete eligible Hermes provider/model pair."""

    module = _load_semantic_routing_module()
    owner_key = _owner_key(request)
    profile = str(body.get("profile") or "default")
    catalog = await asyncio.to_thread(_model_catalog, False, owner_key)
    config = await asyncio.to_thread(module.load_config, profile)
    authoritative = [candidate.public() for candidate in module.candidates_from_catalog(catalog, "balanced")]
    requested = body.get("candidates")
    if isinstance(requested, list):
        requested_keys = {
            f"{str(row.get('provider') or '').lower()}/{str(row.get('model') or '')}".lower()
            for row in requested if isinstance(row, dict)
        }
        candidates = [row for row in authoritative if f"{row['provider']}/{row['model']}".lower() in requested_keys]
    else:
        candidates = authoritative
    result = await asyncio.to_thread(
        module.decide,
        profile=profile,
        slot=str(body.get("slot") or "primary"),
        task=str(body.get("task") or ""),
        prompt=str(body.get("prompt") or "")[:12000],
        candidates=candidates,
        native=body.get("native") if isinstance(body.get("native"), dict) else {},
        session_id=str(body.get("session_id") or ""),
        requirements=body.get("requirements") if isinstance(body.get("requirements"), dict) else {},
        owner_id=owner_key,
    )
    return {"ok": True, "decision": result}


@router.get("/semantic-routing/decisions")
async def semantic_routing_decisions(
    request: Request, profile: str = "", session_id: str = "", limit: int = 50,
):
    """Return bounded, prompt-redacted routing records for Cockpit's inspector."""

    module = _load_semantic_routing_module()
    return {"ok": True, "decisions": module.decision_traces(
        profile=profile, session_id=session_id, limit=limit, owner_id=_owner_key(request),
    )}


@router.get("/semantic-routing/metrics")
async def semantic_routing_metrics(request: Request, profile: str = ""):
    module = _load_semantic_routing_module()
    return {"ok": True, "metrics": module.routing_metrics(profile=profile, owner_id=_owner_key(request))}


@router.post("/semantic-routing/escalate")
async def semantic_routing_escalate(body: dict[str, Any], request: Request):
    module = _load_semantic_routing_module()
    owner_key = _owner_key(request)
    profile = str(body.get("profile") or "default")
    catalog = await asyncio.to_thread(_model_catalog, False, owner_key)
    candidates = [candidate.public() for candidate in module.candidates_from_catalog(catalog, "balanced")]
    decision = await asyncio.to_thread(
        module.evaluate_escalation, profile=profile, session_id=str(body.get("session_id") or ""),
        current=body.get("current") if isinstance(body.get("current"), dict) else {}, candidates=candidates,
        error_count=int(body.get("error_count") or 0), side_effects=bool(body.get("side_effects")),
        owner_id=owner_key,
    )
    return {"ok": True, "decision": decision}


@router.post("/semantic-routing/verify")
async def semantic_routing_verify(body: dict[str, Any], request: Request):
    module = _load_semantic_routing_module()
    result = await asyncio.to_thread(
        module.verify_output, profile=str(body.get("profile") or "default"),
        prompt=str(body.get("prompt") or "")[:12000], output=str(body.get("output") or "")[:100000],
        session_id=str(body.get("session_id") or ""),
        owner_id=_owner_key(request),
    )
    return {"ok": True, "verification": result}


@router.post("/semantic-routing/outcome")
async def semantic_routing_outcome(body: dict[str, Any], request: Request):
    module = _load_semantic_routing_module()
    saved = module.record_outcome(
        decision_id=str(body.get("decision_id") or ""),
        outcome=body.get("outcome") if isinstance(body.get("outcome"), dict) else {},
        owner_id=_owner_key(request),
    )
    if not saved:
        raise HTTPException(status_code=404, detail="Routing decision is no longer in the bounded trace window")
    return {"ok": True}


def _browser_preview_id(session_key: str) -> str:
    return hashlib.sha256(_BROWSER_PREVIEW_SALT + session_key.encode("utf-8", "replace")).hexdigest()[:24]


def _browser_owner_allowed(info: dict[str, Any], owner_key: str) -> bool:
    """Resolve the native session's verified owner, never a caller's session id."""

    claimed = next((info.get(key) for key in ("owner_key", "owner_scope", "authenticated_owner") if info.get(key)), None)
    if claimed is None:
        if owner_key == _SINGLE_USER_OWNER_SCOPE:
            return True
        try:
            from hermes_cli.plugin_runtime_context import routing_context

            context = routing_context({"session_id": str(info.get("owner_task_id") or info.get("session_key") or "")})
            claimed = context.get("owner_scope")
        except ImportError:
            return False
        if not claimed or claimed == "__unresolved__":
            return False
    return hmac.compare_digest(str(claimed), owner_key)


def _browser_preview_rows(requested_session: str = "", owner_key: str = "") -> list[dict[str, Any]]:
    """Return authenticated, redacted metadata for live agent-browser sessions.

    The browser socket, CDP URL, raw task key, and copied-profile location never leave
    the server.  Cockpit gets only an opaque process-local id and display metadata.
    """

    try:
        from tools import browser_tool
        from tools.browser_supervisor import SUPERVISOR_REGISTRY
    except Exception:
        return []

    lock = getattr(browser_tool, "_cleanup_lock", None)
    if lock is None:
        active = dict(getattr(browser_tool, "_active_sessions", {}))
        activity = dict(getattr(browser_tool, "_session_last_activity", {}))
    else:
        with lock:
            active = dict(getattr(browser_tool, "_active_sessions", {}))
            activity = dict(getattr(browser_tool, "_session_last_activity", {}))

    rows = []
    for session_key, raw in active.items():
        info = raw if isinstance(raw, dict) else {}
        if not owner_key or not _browser_owner_allowed(info, owner_key):
            continue
        owner = str(info.get("owner_task_id") or "")
        if requested_session and requested_session not in {session_key, owner} and not session_key.startswith(f"{requested_session}::"):
            continue
        supervisor_key = session_key
        supervisor = SUPERVISOR_REGISTRY.get(session_key)
        if supervisor is None and owner:
            supervisor = SUPERVISOR_REGISTRY.get(owner)
            if supervisor is not None:
                supervisor_key = owner
        url, title, preview_ready = "", "", False
        if supervisor is not None:
            try:
                snapshot = supervisor.snapshot()
                preview_ready = bool(getattr(snapshot, "active", False))
                tree = getattr(snapshot, "frame_tree", None)
                top = tree.get("top", {}) if isinstance(tree, dict) else {}
                url = str(top.get("url") or "")
            except Exception:
                preview_ready = False
        features = info.get("features") if isinstance(info.get("features"), dict) else {}
        rows.append({
            "id": _browser_preview_id(session_key),
            "supervisor_key": supervisor_key,
            "url": url,
            "title": title,
            "preview_ready": preview_ready,
            "real_profile": bool(features.get("real_profile")),
            "backend": str(info.get("backend") or info.get("provider") or "local Chromium"),
            "last_activity": float(activity.get(session_key) or 0),
        })
    rows.sort(key=lambda row: row["last_activity"], reverse=True)
    return rows


def _browser_preview_public(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if key != "supervisor_key"}


def _capture_browser_preview(preview_id: str, owner_key: str) -> bytes:
    from tools.browser_supervisor import SUPERVISOR_REGISTRY

    row = next((candidate for candidate in _browser_preview_rows(owner_key=owner_key) if candidate["id"] == preview_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="That browser session is no longer active.")
    if not row["preview_ready"]:
        raise HTTPException(status_code=409, detail="The browser is starting; a live frame is not ready yet.")
    try:
        capture = SUPERVISOR_REGISTRY.capture(row["supervisor_key"], timeout=3.0)
        reply = capture.call(
            "Page.captureScreenshot",
            {"format": "jpeg", "quality": 76, "fromSurface": True, "optimizeForSpeed": True},
            session_id=capture.page_session_id,
            timeout=5.0,
        )
        encoded = ((reply.get("result") or {}).get("data") or "") if isinstance(reply, dict) else ""
        frame = base64.b64decode(encoded, validate=True)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=409, detail="The live browser frame is temporarily unavailable.") from exc
    if not frame or len(frame) > _BROWSER_FRAME_LIMIT:
        raise HTTPException(status_code=502, detail="Hermes returned an invalid browser frame.")
    return frame


@router.get("/browser-preview")
async def browser_preview(request: Request, response: Response, session_id: str = ""):
    """Describe the most relevant active isolated browser without exposing CDP."""

    owner_key = _owner_key(request)
    if getattr(request.app.state, "hosted_plugin_internal", False):
        raise HTTPException(status_code=409, detail="Use the authenticated gateway browser.preview method; the browser runs in the Hermes process.")
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Vary"] = "Cookie, Authorization"
    requested_session = session_id.strip()
    if not requested_session:
        return {"ok": True, "active": False, "session": None, "active_count": 0, "mode": "live-cdp-frame"}
    rows = await asyncio.to_thread(_browser_preview_rows, requested_session, owner_key)
    return {
        "ok": True,
        "active": bool(rows),
        "session": _browser_preview_public(rows[0]) if rows else None,
        "active_count": len(rows),
        "mode": "live-cdp-frame",
    }


@router.get("/browser-preview/{preview_id}/frame")
async def browser_preview_frame(preview_id: str, request: Request):
    """Capture one compressed frame through Hermes' in-process CDP supervisor."""

    if not preview_id or len(preview_id) != 24 or any(char not in "0123456789abcdef" for char in preview_id):
        raise HTTPException(status_code=404, detail="Unknown browser preview.")
    frame = await asyncio.to_thread(_capture_browser_preview, preview_id, _owner_key(request))
    etag = hashlib.sha256(frame).hexdigest()[:24]
    return Response(
        content=frame,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store, private", "ETag": f'"{etag}"', "X-Content-Type-Options": "nosniff"},
    )


def _mount_cli_bridge() -> None:
    """Load the sibling bridge without relying on dashboard_dir being on sys.path."""

    bridge_path = Path(__file__).with_name("cli_bridge.py")
    module_name = f"{__name__}_cli_bridge"
    spec = importlib.util.spec_from_file_location(module_name, bridge_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load CLI bridge from {bridge_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    router.include_router(module.router)


_mount_cli_bridge()
