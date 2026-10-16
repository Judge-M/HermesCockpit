"""Backend for the Judge-M Hermes control-plane and typed CLI bridge."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter


router = APIRouter()

PORTAL_URL = os.environ.get("JUDGEM_CONSOLE_URL", "http://192.168.34.116:8088").rstrip("/")
AGENT_PLAYGROUND = {
    "name": "agent-playground",
    "host": "192.168.34.174",
    "portainerAgentPort": 9001,
    "state": "ready",
    "registeredWorkers": 0,
    "note": "Docker host and Portainer agent are online; no Docker Agent worker profile is deployed yet.",
}
LINKS = [
    {"id": "portal", "name": "Judge-M Portal", "kind": "Unified portal", "url": f"{PORTAL_URL}/"},
    {"id": "proxmox", "name": "Proxmox VE", "kind": "Compute and LXC lifecycle", "url": "https://192.168.34.54:8006"},
    {"id": "portainer", "name": "Portainer", "kind": "Docker fleet", "url": "https://192.168.34.116:9443"},
    {"id": "cockpit", "name": "Cockpit", "kind": "Linux systems", "url": "https://192.168.34.116:9090"},
    {"id": "grafana", "name": "Grafana", "kind": "Dashboards", "url": "http://192.168.34.116:3000"},
    {"id": "prometheus", "name": "Prometheus", "kind": "Metrics", "url": "http://192.168.34.116:9091"},
    {"id": "hermes", "name": "Hermes Web", "kind": "Web dashboard", "url": f"{PORTAL_URL}/hermes/"},
    {"id": "mcpx", "name": "Lunar MCPX", "kind": "Tool gateway", "url": "http://192.168.34.235:5173"},
    {"id": "router", "name": "Semantic Router", "kind": "Request routing", "url": "http://192.168.34.235:8899"},
    {"id": "radiance", "name": "Radiance / Qwen", "kind": "Inference API", "url": "http://192.168.34.246:8000"},
]

_CACHE: dict[str, Any] = {"at": 0.0, "payload": None}
PREFERENCES_FILE = Path(os.environ.get("HERMES_HOME", "/root/.hermes")) / "judge-m-control-plane" / "model-menu.json"


def _fetch_json(url: str, timeout: float = 4.0) -> dict[str, Any]:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "judge-m-control-plane/0.1"})
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


async def _load_overview() -> dict[str, Any]:
    now = time.monotonic()
    if _CACHE["payload"] is not None and now - float(_CACHE["at"]) < 5:
        return _CACHE["payload"]

    try:
        overview = await asyncio.to_thread(_fetch_json, f"{PORTAL_URL}/api/overview")
        result = {
            "ok": True,
            "source": PORTAL_URL,
            "overview": overview,
            "workers": AGENT_PLAYGROUND,
            "links": LINKS,
        }
    except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        result = {
            "ok": False,
            "source": PORTAL_URL,
            "error": f"{type(exc).__name__}: {exc}",
            "overview": None,
            "workers": AGENT_PLAYGROUND,
            "links": LINKS,
        }

    _CACHE.update(at=now, payload=result)
    return result


def _read_model_preferences() -> dict[str, Any]:
    try:
        data = json.loads(PREFERENCES_FILE.read_text(encoding="utf-8"))
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
            "labels": labels,
        }
    order = []
    for value in body.get("provider_order") or []:
        slug = str(value).strip().lower()[:96]
        if slug and slug not in order and len(order) < 64:
            order.append(slug)
    return {"version": 1, "provider_order": order, "providers": providers, "updated_at": int(time.time())}


def _write_model_preferences(preferences: dict[str, Any]) -> None:
    PREFERENCES_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = PREFERENCES_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(preferences, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, PREFERENCES_FILE)


def _model_catalog(refresh: bool = False) -> dict[str, Any]:
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
        })
    return {
        "providers": rows,
        "current": {"provider": payload.get("provider") or "", "model": payload.get("model") or ""},
        "preferences": _read_model_preferences(),
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
async def model_menu(refresh: bool = False):
    """Live provider catalog plus the user's hosted prompt-menu curation."""

    try:
        return {"ok": True, **(await asyncio.to_thread(_model_catalog, refresh))}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "providers": [], "preferences": _read_model_preferences()}


@router.post("/model-menu")
async def save_model_menu(body: dict[str, Any]):
    """Persist the allow-list, labels, and provider order for Judge-M prompt menus."""

    preferences = _clean_model_preferences(body)
    await asyncio.to_thread(_write_model_preferences, preferences)
    return {"ok": True, "preferences": preferences}


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
