"""Hermes runtime registrations for native Cockpit semantic routing."""

from __future__ import annotations

from typing import Any, Mapping

from .semantic_routing import (
    ROUTER_TASK,
    candidates_from_catalog,
    decide,
    middleware_profile,
    route_memory,
    route_tools,
)


def _catalog() -> dict[str, Any]:
    # Keep one authoritative model inventory and picker allow-list across the
    # dashboard and runtime plugin.  Import lazily so plugin discovery does not
    # require FastAPI until Hermes has finished bootstrapping.
    from .dashboard.plugin_api import _model_catalog

    return _model_catalog(False)


def _prompt_from_messages(messages: Any) -> str:
    if not isinstance(messages, list):
        return ""
    chunks: list[str] = []
    for message in messages[-12:]:
        if not isinstance(message, Mapping):
            continue
        content = message.get("content")
        if isinstance(content, str):
            chunks.append(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, Mapping) and block.get("type") in {"text", "input_text"}:
                    chunks.append(str(block.get("text") or ""))
    return "\n".join(chunks)[-12000:]


def _tool_request_middleware(**kwargs: Any):
    request = kwargs.get("request")
    if not isinstance(request, dict) or not isinstance(request.get("tools"), list):
        return None
    tools = request["tools"]
    prompt = _prompt_from_messages(request.get("messages") or kwargs.get("messages"))
    routed, trace = route_tools(
        profile=middleware_profile(kwargs), prompt=prompt, tools=tools,
        session_id=str(kwargs.get("session_id") or ""), turn_id=str(kwargs.get("turn_id") or ""),
    )
    if routed is tools:
        return None
    updated = dict(request)
    updated["tools"] = routed
    return {
        "request": updated,
        "source": "judge-m-semantic-routing",
        "reason": f"authorized tool selection ({len(tools)} → {len(routed)})",
        "name": "semantic tool routing",
    }


def _model_route_middleware(**kwargs: Any):
    route = kwargs.get("route")
    if not isinstance(route, Mapping):
        return None
    slot = str(kwargs.get("slot") or "")
    task = str(kwargs.get("task") or "")
    if slot not in {"subagent", "auxiliary"} or task == ROUTER_TASK:
        return None
    prompt = str(kwargs.get("prompt") or kwargs.get("goal") or "")[-12000:]
    profile = middleware_profile(kwargs)
    result = decide(
        profile=profile, slot=slot, task=task, prompt=prompt,
        candidates=[candidate.public() for candidate in candidates_from_catalog(_catalog())],
        native=route, session_id=str(kwargs.get("session_id") or ""),
    )
    selected = result.get("selected") if isinstance(result, Mapping) else None
    if not result.get("routed") or not isinstance(selected, Mapping):
        return None
    updated = dict(route)
    updated.update(provider=selected.get("provider"), model=selected.get("model"))
    return {
        "route": updated,
        "source": "judge-m-semantic-routing",
        "reason": f"{slot} semantic route",
        "name": "semantic model routing",
    }


def _memory_route_middleware(**kwargs: Any):
    sources = kwargs.get("sources")
    if not isinstance(sources, list):
        return None
    routed, trace = route_memory(
        profile=middleware_profile(kwargs), prompt=str(kwargs.get("query") or "")[-12000:],
        sources=[str(source) for source in sources], session_id=str(kwargs.get("session_id") or ""),
    )
    if routed == sources:
        return None
    return {
        "sources": routed,
        "source": "judge-m-semantic-routing",
        "reason": f"authorized memory selection ({len(sources)} → {len(routed)})",
        "name": "semantic memory routing",
    }


def register(ctx) -> None:
    ctx.register_auxiliary_task(
        ROUTER_TASK,
        display_name="Semantic Router",
        description="Decision model used by Cockpit to choose eligible models and authorized tools.",
    )
    ctx.register_middleware("llm_request", _tool_request_middleware)
    ctx.register_middleware("model_route", _model_route_middleware)
    ctx.register_middleware("memory_route", _memory_route_middleware)
