(() => {
  "use strict";

  const TIMEOUT = 9000;
  const definitions = [
    {id: "health", label: "Hermes health", path: "/hermes/api/health"},
    {id: "status", label: "Runtime status", path: "/hermes/api/status"},
    {id: "stats", label: "Host statistics", path: "/hermes/api/system/stats"},
    {id: "sessionStats", label: "Session statistics", path: "/hermes/api/sessions/stats"},
    {id: "profiles", label: "Profiles", path: "/hermes/api/profiles"},
    {id: "egress", label: "Egress", path: "/hermes/api/egress/status"},
    {id: "localModels", label: "Local models", path: "/hermes/api/local-models/status"},
    {id: "computerUse", label: "Computer Use", path: "/hermes/api/tools/computer-use/status"},
    {id: "migration", label: "Gateway plan", path: "/hermes/api/gateway/migrate/plan"}
  ];
  const state = {results: {}, refreshing: false};
  const secretKey = /(?:api[_-]?key|secret|token|password|passwd|credential|authorization|cookie|private[_-]?key|bearer)/i;
  const $ = (id) => document.getElementById(id);
  const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
  const first = (object, paths) => { for (const path of paths) { let value = object; for (const part of path.split(".")) value = value && typeof value === "object" ? value[part] : undefined; if (value !== undefined && value !== null && value !== "") return value; } return undefined; };
  const asList = (payload, keys) => { if (Array.isArray(payload)) return payload; if (!payload || typeof payload !== "object") return []; for (const key of keys) if (Array.isArray(payload[key])) return payload[key]; if (payload.data && typeof payload.data === "object") for (const key of keys) if (Array.isArray(payload.data[key])) return payload.data[key]; return []; };
  const display = (value) => value === undefined || value === null || value === "" ? "Unavailable" : typeof value === "boolean" ? (value ? "Yes" : "No") : typeof value === "number" ? new Intl.NumberFormat().format(value) : String(value);
  const label = (value) => String(value).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const formatDate = (value) => { if (!value) return "Date unavailable"; const date = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value); return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeStyle: "short"}).format(date); };
  const errorText = (result) => result?.status === 401 || result?.status === 403 ? "Authentication required" : result?.error || (result?.status ? `HTTP ${result.status}` : "No response");

  function redact(value, key = "") {
    if (secretKey.test(key)) return "[REDACTED]";
    if (Array.isArray(value)) return value.map((item) => redact(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([child, item]) => [child, redact(item, child)]));
    return value;
  }

  function flatten(value, prefix = "", rows = [], depth = 0) {
    if (rows.length >= 36 || depth > 4 || !value || typeof value !== "object") return rows;
    Object.entries(value).forEach(([key, item]) => {
      if (rows.length >= 36 || secretKey.test(key)) return;
      const path = prefix ? `${prefix}.${key}` : key;
      if (item === null || ["string", "number", "boolean"].includes(typeof item)) rows.push([path, item]);
      else if (Array.isArray(item) && item.every((entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry))) rows.push([path, item.join(", ")]);
      else flatten(item, path, rows, depth + 1);
    });
    return rows;
  }

  async function request(definition) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);
    const started = performance.now();
    try {
      const response = await fetch(definition.path, {credentials: "same-origin", cache: "no-store", headers: {Accept: "application/json"}, signal: controller.signal});
      const body = await response.text();
      let data = null;
      if (body) try { data = JSON.parse(body); } catch { data = {response: body}; }
      return {definition, ok: response.ok, status: response.status, elapsed: Math.round(performance.now() - started), data, error: response.ok ? "" : display(first(data, ["detail", "error", "message"]) || response.statusText)};
    } catch (error) {
      return {definition, ok: false, status: 0, elapsed: Math.round(performance.now() - started), data: null, error: error?.name === "AbortError" ? "Timed out" : error?.message || "Request unavailable"};
    } finally { clearTimeout(timeout); }
  }

  function tone(value) {
    const normalized = String(value ?? "").toLowerCase();
    if (["ok", "ready", "running", "connected", "healthy", "enabled", "active", "available"].some((word) => normalized.includes(word))) return "ok";
    if (["error", "failed", "unhealthy", "critical", "offline"].some((word) => normalized.includes(word))) return "error";
    return "warn";
  }

  function setConnection() {
    const available = definitions.filter((definition) => state.results[definition.id]?.ok).length;
    const pill = $("system-connection");
    pill.className = `status-pill ${available === definitions.length ? "is-ok" : available ? "is-warn" : "is-error"}`;
    pill.lastChild.textContent = available === definitions.length ? "All sources connected" : available ? `${available}/${definitions.length} sources connected` : "Hermes unavailable";
    $("system-auth").hidden = !Object.values(state.results).some((result) => result.status === 401 || result.status === 403);
  }

  function renderSummary() {
    const health = state.results.health, status = state.results.status, sessionStats = state.results.sessionStats;
    const statusData = status?.data || {}, disk = statusData.disk || {};
    $("summary-health").textContent = health?.ok ? display(first(statusData, ["overall"]) || first(health.data, ["status"]) || "Reachable") : "Unavailable";
    $("summary-health-detail").textContent = health?.ok ? `Hermes ${display(first(health.data, ["displayVersion", "version"]))}` : errorText(health);
    const gatewayState = first(statusData, ["gateway_state", "gateway.state", "gateway_mode"]) || (statusData.gateway_running === true ? "running" : statusData.gateway_running === false ? "stopped" : undefined);
    $("summary-gateway").textContent = status?.ok ? display(gatewayState) : "Unavailable";
    $("summary-gateway-detail").textContent = status?.ok ? `${display(statusData.active_agents ?? 0)} active agents · ${display(statusData.active_sessions ?? 0)} active sessions` : errorText(status);
    const used = Number(first(disk, ["used_percent", "percent", "usage_percent"]));
    $("summary-disk").textContent = Number.isFinite(used) ? `${used.toFixed(1)}%` : "Unavailable";
    $("summary-disk-detail").textContent = Number.isFinite(Number(disk.free_mb)) ? `${display(Math.round(Number(disk.free_mb) / 1024))} GB free of ${display(Math.round(Number(disk.total_mb) / 1024))} GB` : status?.ok ? "Hermes did not report disk capacity" : errorText(status);
    const meter = $("summary-disk-meter"); meter.style.width = Number.isFinite(used) ? `${Math.max(0, Math.min(100, used))}%` : "0"; meter.className = used >= 90 ? "is-danger" : used >= 75 ? "is-warning" : "";
    const totals = sessionStats?.data || {};
    $("summary-sessions").textContent = sessionStats?.ok ? display(first(totals, ["total", "active_store"])) : "Unavailable";
    $("summary-sessions-detail").textContent = sessionStats?.ok ? `${display(totals.messages)} messages · ${display(totals.archived ?? 0)} archived` : errorText(sessionStats);
  }

  function renderComponents() {
    const root = $("component-list"), result = state.results.status; root.replaceChildren();
    if (!result?.ok) { root.append(node("div", "unavailable-state", `Runtime status unavailable: ${errorText(result)}`)); return; }
    const components = result.data?.components && typeof result.data.components === "object" ? result.data.components : {};
    const rows = Object.entries(components);
    if (!rows.length) { root.append(node("div", "empty-state", "Hermes returned no component-level health records.")); return; }
    rows.forEach(([name, value]) => {
      const status = typeof value === "object" ? first(value, ["status", "state"]) : value;
      const detail = typeof value === "object" ? Object.entries(value).filter(([key]) => key !== "status").map(([key, item]) => `${label(key)}: ${display(item)}`).join(" · ") : "Reported by Hermes";
      const row = node("div", "component-row"), icon = node("div", `state-icon is-${tone(status)}`), copy = node("div", "row-copy");
      icon.append(node("span", "material-symbols-outlined", tone(status) === "ok" ? "check_circle" : tone(status) === "error" ? "error" : "info"));
      copy.append(node("strong", "", label(name)), node("span", "", detail || "No additional fields")); row.append(icon, copy, node("div", "row-value", display(status))); root.append(row);
    });
  }

  function renderCapacity() {
    const cards = $("capacity-cards"), fields = $("system-fields"), status = state.results.status, stats = state.results.stats; cards.replaceChildren(); fields.replaceChildren();
    const sources = [status?.ok ? status.data?.disk : null, status?.ok ? status.data?.memory : null, stats?.ok ? stats.data : null].filter(Boolean);
    const all = sources.flatMap((source) => flatten(source));
    const candidates = [
      ["Disk free", first(status?.data, ["disk.free_mb"]), "MB reported free"],
      ["Memory available", first(status?.data, ["memory.system_available_mb"]), "MB reported available"],
      ["Swap used", first(status?.data, ["memory.swap_used_mb"]), "MB reported used"]
    ];
    const useful = candidates.filter(([, value]) => value !== undefined && value !== null);
    if (useful.length) useful.forEach(([name, value, detail]) => { const card = node("div", "capacity-card"); card.append(node("small", "", name), node("strong", "", display(value)), node("span", "", detail)); cards.append(card); });
    else cards.append(node("div", stats?.ok || status?.ok ? "empty-state" : "unavailable-state", stats?.ok || status?.ok ? "Hermes is reachable but did not report host resource values." : `Host statistics unavailable: ${errorText(stats || status)}`));
    if (!all.length) { const group = node("div", "empty-state", "No scalar host fields were returned."); fields.append(group); return; }
    all.slice(0, 36).forEach(([key, value]) => { const group = node("div"); group.append(node("dt", "", label(key)), node("dd", "", display(value))); fields.append(group); });
  }

  function capabilityValue(result, paths) { return result?.ok ? first(result.data, paths) : undefined; }
  function renderCapabilities() {
    const root = $("capability-list"); root.replaceChildren();
    const status = state.results.status;
    const capabilities = [
      {name: "Gateway mode", icon: "dns", result: status, value: capabilityValue(status, ["gateway_mode", "gateway_state"]), detail: status?.ok ? `${display(status.data?.active_agents ?? 0)} active agents reported` : errorText(status)},
      {name: "Outbound access", icon: "public", result: state.results.egress, value: capabilityValue(state.results.egress, ["status", "state", "mode", "enabled"]), detail: state.results.egress?.ok ? "Live egress configuration" : errorText(state.results.egress)},
      {name: "Local inference", icon: "memory", result: state.results.localModels, value: capabilityValue(state.results.localModels, ["status", "state", "enabled", "configured", "supervisor.state"]), detail: state.results.localModels?.ok ? "Local model runtime status" : errorText(state.results.localModels)},
      {name: "Computer Use", icon: "desktop_windows", result: state.results.computerUse, value: capabilityValue(state.results.computerUse, ["status", "state", "ready", "enabled", "available"]), detail: state.results.computerUse?.ok ? "Hermes Computer Use readiness" : errorText(state.results.computerUse)},
      {name: "Gateway migration", icon: "move_up", result: state.results.migration, value: capabilityValue(state.results.migration, ["status", "state", "ready", "can_migrate", "mode"]), detail: state.results.migration?.ok ? "Multiplexer migration preflight available" : errorText(state.results.migration)}
    ];
    capabilities.forEach((item) => {
      const value = item.value === undefined ? (item.result?.ok ? "Not reported" : "Unavailable") : display(item.value);
      const row = node("div", "capability-row"), icon = node("div", `state-icon is-${item.result?.ok ? tone(value) : "error"}`), copy = node("div", "row-copy"); icon.append(node("span", "material-symbols-outlined", item.icon)); copy.append(node("strong", "", item.name), node("span", "", item.detail)); row.append(icon, copy, node("div", "row-value", value)); root.append(row);
    });
  }

  function renderProfiles() {
    const root = $("system-profiles"), result = state.results.profiles; root.replaceChildren();
    if (!result?.ok) { root.append(node("div", "unavailable-state", `Profiles unavailable: ${errorText(result)}`)); return; }
    const profiles = asList(result.data, ["profiles", "items", "results"]); $("profiles-summary").textContent = `${profiles.length} profile${profiles.length === 1 ? "" : "s"} returned by Hermes.`;
    if (!profiles.length) { root.append(node("div", "empty-state", "Hermes returned no configured profiles.")); return; }
    profiles.forEach((profile) => {
      const name = display(first(profile, ["display_name", "bot_title", "name", "id"])); const running = profile.gateway_running === true || String(profile.status || "").toLowerCase() === "running";
      const card = node("article", "profile-card"), head = node("div", "profile-card-head"), avatar = node("div", "profile-avatar", name.charAt(0).toUpperCase()), title = node("h3", "", name);
      head.append(avatar, title); card.append(head, node("p", "", display(first(profile, ["description", "bot_description"]) || "No description reported")));
      const meta = node("div", "profile-meta"); meta.append(node("span", `mini-pill${running ? " is-ok" : ""}`, running ? "Gateway running" : "Gateway not running"), node("span", "mini-pill", display(first(profile, ["model", "model_name", "provider_model"]) || "Model not reported"))); card.append(meta); root.append(card);
    });
  }

  function renderEndpoints() {
    const root = $("system-endpoints"); root.replaceChildren(); definitions.forEach((definition) => {
      const result = state.results[definition.id], card = node("article", "endpoint-card"), head = node("div", "endpoint-head"); head.append(node("strong", "", definition.label), node("span", `endpoint-status ${result?.ok ? "is-ok" : "is-error"}`, result?.ok ? `HTTP ${result.status}` : "Unavailable")); card.append(head, node("code", "", definition.path), node("p", "", result ? `${result.elapsed} ms browser fetch${result.ok ? "" : ` · ${errorText(result)}`}` : "Waiting for request")); root.append(card);
    });
  }

  function snapshot() {
    return JSON.stringify({captured_at: new Date().toISOString(), source: "Hermes Cockpit System", note: "Authenticated same-origin GET responses; browser timing is not network RTT.", endpoints: Object.fromEntries(definitions.map((definition) => { const result = state.results[definition.id]; return [definition.path, result ? {ok: result.ok, http_status: result.status, browser_fetch_ms: result.elapsed, error: result.error || undefined, data: redact(result.data)} : {ok: false, error: "Not requested"}]; }))}, null, 2);
  }

  async function refresh() {
    if (state.refreshing) return; state.refreshing = true; const button = $("system-refresh"); button.classList.add("is-busy"); button.disabled = true;
    try {
      const results = await Promise.all(definitions.map(request)); results.forEach((result) => { state.results[result.definition.id] = result; });
      setConnection(); renderSummary(); renderComponents(); renderCapacity(); renderCapabilities(); renderProfiles(); renderEndpoints(); $("system-updated").textContent = `Updated ${new Date().toLocaleTimeString([], {hour: "numeric", minute: "2-digit", second: "2-digit"})}`;
    } finally { state.refreshing = false; button.classList.remove("is-busy"); button.disabled = false; }
  }

  $("system-refresh").addEventListener("click", refresh);
  $("copy-system-snapshot").addEventListener("click", async () => { const button = $("copy-system-snapshot"); try { await navigator.clipboard.writeText(snapshot()); button.lastChild.textContent = "Copied"; } catch { button.lastChild.textContent = "Copy unavailable"; } setTimeout(() => { button.lastChild.textContent = "Copy snapshot"; }, 1600); });
  renderEndpoints(); refresh();
})();
