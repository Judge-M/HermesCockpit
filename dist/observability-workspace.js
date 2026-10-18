(() => {
  "use strict";

  const INTERVAL = 30000, TIMEOUT = 10000;
  const state = {results: {}, paused: false, refreshing: false, history: [], models: [], usage: null};
  const secretKey = /(?:api[_-]?key|secret|token|password|passwd|credential|authorization|cookie|private[_-]?key|bearer)/i;
  const $ = (id) => document.getElementById(id);
  const make = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
  const compact = new Intl.NumberFormat(undefined, {notation: "compact", maximumFractionDigits: 1});
  const number = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat().format(Number(value)) : "Unavailable";
  const compactNumber = (value) => Number.isFinite(Number(value)) ? compact.format(Number(value)) : "Unavailable";
  const first = (object, paths) => { for (const path of paths) { let value = object; for (const part of path.split(".")) value = value && typeof value === "object" ? value[part] : undefined; if (value !== undefined && value !== null && value !== "") return value; } return undefined; };
  const list = (payload, keys) => { if (Array.isArray(payload)) return payload; if (!payload || typeof payload !== "object") return []; for (const key of keys) if (Array.isArray(payload[key])) return payload[key]; if (payload.data && typeof payload.data === "object") for (const key of keys) if (Array.isArray(payload.data[key])) return payload.data[key]; return []; };
  const display = (value) => value === undefined || value === null || value === "" ? "Unavailable" : typeof value === "boolean" ? (value ? "Yes" : "No") : typeof value === "number" ? number(value) : String(value);
  const date = (value, short = false) => { if (!value) return "Unavailable"; const parsed = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value); if (Number.isNaN(parsed.getTime())) return String(value); return short ? parsed.toLocaleDateString(undefined, {month: "short", day: "numeric"}) : new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeStyle: "short"}).format(parsed); };
  const errorText = (result) => result?.status === 401 || result?.status === 403 ? "Authentication required" : result?.error || (result?.status ? `HTTP ${result.status}` : "No response");

  function definitions() {
    const days = Number($("telemetry-range").value) || 30;
    return [
      {id: "health", label: "Health", path: "/hermes/api/health"},
      {id: "status", label: "Status", path: "/hermes/api/status"},
      {id: "stats", label: "System statistics", path: "/hermes/api/system/stats"},
      {id: "sessionStats", label: "Session statistics", path: "/hermes/api/sessions/stats"},
      {id: "sessions", label: "Recent sessions", path: "/hermes/api/sessions?limit=8&order=recent&min_messages=1"},
      {id: "profiles", label: "Profiles", path: "/hermes/api/profiles"},
      {id: "usage", label: "Usage analytics", path: `/hermes/api/analytics/usage?days=${days}`},
      {id: "models", label: "Model analytics", path: `/hermes/api/analytics/models?days=${days}`}
    ];
  }

  function redact(value, key = "") {
    if (secretKey.test(key)) return "[REDACTED]";
    if (Array.isArray(value)) return value.map((item) => redact(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([child, item]) => [child, redact(item, child)]));
    return value;
  }
  function redactText(value) {
    return String(value)
      .replace(/((?:api[_-]?key|secret|token|password|authorization|bearer)\s*[=:]\s*)([^\s,;"']+)/gi, "$1[REDACTED]")
      .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]");
  }

  async function request(definition) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT), started = performance.now();
    try {
      const response = await fetch(definition.path, {credentials: "same-origin", cache: "no-store", headers: {Accept: "application/json"}, signal: controller.signal});
      const raw = await response.text(); let data = null; if (raw) try { data = JSON.parse(raw); } catch { data = {response: raw}; }
      return {definition, ok: response.ok, status: response.status, elapsed: Math.round(performance.now() - started), data, error: response.ok ? "" : String(first(data, ["detail", "error", "message"]) || response.statusText)};
    } catch (error) { return {definition, ok: false, status: 0, elapsed: Math.round(performance.now() - started), data: null, error: error?.name === "AbortError" ? "Timed out" : error?.message || "Request unavailable"}; }
    finally { clearTimeout(timer); }
  }

  function showView(name) {
    document.querySelectorAll(".telemetry-tabs button").forEach((button) => { const active = button.dataset.view === name; button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active)); });
    document.querySelectorAll(".telemetry-view").forEach((panel) => { const active = panel.dataset.panel === name; panel.classList.toggle("is-active", active); panel.hidden = !active; });
  }

  function renderConnection(currentDefinitions) {
    const available = currentDefinitions.filter((definition) => state.results[definition.id]?.ok).length, pill = $("telemetry-connection");
    pill.className = `status-pill ${available === currentDefinitions.length ? "is-ok" : available ? "is-warn" : "is-error"}`;
    pill.lastChild.textContent = available === currentDefinitions.length ? "All sources connected" : available ? `${available}/${currentDefinitions.length} sources connected` : "Hermes unavailable";
    $("telemetry-auth").hidden = !Object.values(state.results).some((result) => result.status === 401 || result.status === 403);
  }

  function renderMetrics() {
    const totals = state.usage?.totals || {}, period = state.usage?.period_days || Number($("telemetry-range").value), modelTotals = state.results.models?.data?.totals || {};
    $("metric-calls").textContent = compactNumber(totals.total_api_calls); $("metric-calls-note").textContent = state.results.usage?.ok ? `${number(totals.total_api_calls)} calls over ${period} days` : errorText(state.results.usage);
    $("metric-sessions").textContent = compactNumber(totals.total_sessions); $("metric-sessions-note").textContent = state.results.usage?.ok ? `${number(totals.total_sessions)} session records in analytics` : errorText(state.results.usage);
    const totalTokens = Number(totals.total_input || 0) + Number(totals.total_output || 0); $("metric-tokens").textContent = state.results.usage?.ok ? compactNumber(totalTokens) : "Unavailable"; $("metric-tokens-note").textContent = state.results.usage?.ok ? `${compactNumber(totals.total_input)} input · ${compactNumber(totals.total_output)} output` : errorText(state.results.usage);
    $("metric-models").textContent = state.results.models?.ok ? number(modelTotals.distinct_models ?? new Set(state.models.map((row) => row.model)).size) : "Unavailable"; $("metric-models-note").textContent = state.results.models?.ok ? "Models with recorded activity" : errorText(state.results.models);
  }

  function renderChart() {
    const root = $("usage-chart"); root.replaceChildren(); const daily = Array.isArray(state.usage?.daily) ? state.usage.daily : [];
    if (!state.results.usage?.ok) { root.append(make("div", "error-state", `Usage analytics unavailable: ${errorText(state.results.usage)}`)); return; }
    if (!daily.length) { root.append(make("div", "empty-state", "No daily usage records were returned for this period.")); return; }
    const maxCalls = Math.max(...daily.map((row) => Number(row.api_calls) || 0), 1), maxTokens = Math.max(...daily.map((row) => Number(row.input_tokens || 0) + Number(row.output_tokens || 0)), 1);
    daily.forEach((row) => {
      const column = make("div", "day-column"), bars = make("div", "bar-area"), calls = make("div", "day-bar calls"), tokens = make("div", "day-bar tokens"), callsValue = Number(row.api_calls) || 0, tokenValue = Number(row.input_tokens || 0) + Number(row.output_tokens || 0);
      calls.style.height = `${Math.max(2, callsValue / maxCalls * 100)}%`; tokens.style.height = `${Math.max(2, tokenValue / maxTokens * 100)}%`; calls.title = `${number(callsValue)} API calls`; tokens.title = `${number(tokenValue)} tokens`; bars.append(calls, tokens); column.append(bars, make("div", "day-label", date(row.day, true))); root.append(column);
    });
  }

  function renderSessionStore() {
    const root = $("session-store"), sources = $("session-sources"), result = state.results.sessionStats; root.replaceChildren(); sources.replaceChildren();
    if (!result?.ok) { root.append(make("div", "error-state", `Session statistics unavailable: ${errorText(result)}`)); return; }
    const data = result.data || {}; [["Total sessions", data.total], ["Active store", data.active_store], ["Archived", data.archived], ["Messages", data.messages]].forEach(([name, value]) => { const group = make("div", "definition-row"); group.append(make("dt", "", name), make("dd", "", number(value))); root.append(group); });
    if (data.by_source && typeof data.by_source === "object") Object.entries(data.by_source).forEach(([name, value]) => sources.append(make("span", "source-pill", `${name}: ${number(value)}`)));
    if (!sources.childElementCount) sources.append(make("span", "source-pill", "No source breakdown reported"));
  }

  function renderRanks(rootId, rows, options = {}) {
    const root = $(rootId); root.replaceChildren();
    if (!Array.isArray(rows) || !rows.length) { root.append(make("div", "empty-state", options.empty || "No activity was returned for this period.")); return; }
    const getValue = options.value || ((row) => row.count ?? row.api_calls ?? 0), max = Math.max(...rows.map((row) => Number(getValue(row)) || 0), 1);
    rows.slice(0, options.limit || 12).forEach((row, index) => {
      const item = make("div", "rank-row"), copy = make("div", "rank-copy"), value = Number(getValue(row)) || 0, name = options.name ? options.name(row) : row.name || row.model || row.tool || row.skill || "Unnamed";
      copy.append(make("strong", "", name), make("span", "", options.detail ? options.detail(row) : "Recorded by Hermes")); item.append(make("div", "rank-number", String(index + 1).padStart(2, "0")), copy, make("div", "rank-value", options.format ? options.format(value, row) : compactNumber(value)));
      const meter = make("div", "rank-meter"), fill = make("i"); fill.style.width = `${Math.max(1, value / max * 100)}%`; meter.append(fill); item.append(meter); root.append(item);
    });
  }

  function renderModels() {
    renderRanks("top-models", state.models, {limit: 5, value: (row) => row.api_calls, name: (row) => row.model, detail: (row) => `${row.provider || "Provider unavailable"} · ${number(row.sessions)} sessions`, format: (value) => `${number(value)} calls`});
    const body = $("model-table-body"), query = $("model-filter").value.trim().toLowerCase(); body.replaceChildren();
    if (!state.results.models?.ok) { const row = body.insertRow(); const cell = row.insertCell(); cell.colSpan = 8; cell.textContent = `Model analytics unavailable: ${errorText(state.results.models)}`; return; }
    const filtered = state.models.filter((row) => !query || `${row.model || ""} ${row.provider || ""}`.toLowerCase().includes(query));
    if (!filtered.length) { const row = body.insertRow(); const cell = row.insertCell(); cell.colSpan = 8; cell.textContent = state.models.length ? "No models match the filter." : "No model activity was returned for this period."; return; }
    filtered.forEach((model) => { const row = body.insertRow(); [model.model, model.provider, model.sessions, model.api_calls, model.tool_calls, compactNumber(model.input_tokens), compactNumber(model.output_tokens), date(model.last_used_at)].forEach((value) => { const cell = row.insertCell(); cell.textContent = display(value); }); });
  }

  function renderToolsAndSkills() {
    const tools = Array.isArray(state.usage?.tools) ? state.usage.tools : [], skills = Array.isArray(state.usage?.skills?.top_skills) ? state.usage.skills.top_skills : [];
    renderRanks("top-tools", tools, {limit: 5, value: (row) => row.count, name: (row) => row.tool, detail: (row) => `${Number(row.percentage || 0).toFixed(1)}% of recorded calls`, format: (value) => number(value)});
    renderRanks("tool-usage", tools, {limit: 30, value: (row) => row.count, name: (row) => row.tool, detail: (row) => `${Number(row.percentage || 0).toFixed(1)}% of recorded calls`, format: (value) => number(value)});
    renderRanks("skill-usage", skills, {limit: 30, value: (row) => row.total_count, name: (row) => row.skill, detail: (row) => `${number(row.view_count)} views · ${number(row.manage_count)} management actions`, format: (value) => number(value)});
  }

  function renderInventory() {
    const sessionsRoot = $("telemetry-sessions"), profilesRoot = $("telemetry-profiles"), sessionsResult = state.results.sessions, profilesResult = state.results.profiles; sessionsRoot.replaceChildren(); profilesRoot.replaceChildren();
    if (!sessionsResult?.ok) sessionsRoot.append(make("div", "error-state", `Sessions unavailable: ${errorText(sessionsResult)}`));
    else { const sessions = list(sessionsResult.data, ["sessions", "items", "results"]); if (!sessions.length) sessionsRoot.append(make("div", "empty-state", "No recent sessions were returned.")); sessions.slice(0, 8).forEach((session) => { const row = make("div", "compact-row"), copy = make("div"); copy.append(make("strong", "", display(first(session, ["title", "name", "session_id", "id"]))), make("small", "", `${display(first(session, ["profile", "profile_name"]) || "Profile unavailable")} · ${date(first(session, ["updated_at", "last_activity", "modified_at", "created_at"]))}`)); row.append(copy, make("span", "", `${number(first(session, ["message_count", "messages_count", "num_messages"]) || 0)} msgs`)); sessionsRoot.append(row); }); }
    if (!profilesResult?.ok) profilesRoot.append(make("div", "error-state", `Profiles unavailable: ${errorText(profilesResult)}`));
    else { const profiles = list(profilesResult.data, ["profiles", "items", "results"]); if (!profiles.length) profilesRoot.append(make("div", "empty-state", "No configured profiles were returned.")); profiles.forEach((profile) => { const row = make("div", "compact-row"), copy = make("div"), running = profile.gateway_running === true || String(profile.status || "").toLowerCase() === "running"; copy.append(make("strong", "", display(first(profile, ["display_name", "bot_title", "name", "id"]))), make("small", "", display(first(profile, ["model", "model_name", "provider_model"]) || "Model not reported"))); row.append(copy, make("span", "", running ? "Gateway running" : "Gateway stopped")); profilesRoot.append(row); }); }
  }

  function renderEndpoints(currentDefinitions) {
    const root = $("telemetry-endpoints"); root.replaceChildren(); currentDefinitions.forEach((definition) => { const result = state.results[definition.id], card = make("article", "endpoint-card"), head = make("div"); head.append(make("strong", "", definition.label), make("span", result?.ok ? "is-ok" : "", result?.ok ? `HTTP ${result.status}` : "Unavailable")); card.append(head, make("code", "", definition.path), make("small", "", result ? `${result.elapsed} ms browser fetch${result.ok ? "" : ` · ${errorText(result)}`}` : "Waiting for request")); root.append(card); });
    const history = $("poll-history"); history.replaceChildren(); if (!state.history.length) history.append(make("li", "", "No refreshes completed yet.")); else state.history.forEach((entry) => history.append(make("li", entry.ok === currentDefinitions.length ? "is-ok" : "is-warn", `${entry.at.toLocaleTimeString()} · ${entry.ok}/${currentDefinitions.length} sources`)));
  }

  function snapshot(currentDefinitions = definitions()) {
    return JSON.stringify({captured_at: new Date().toISOString(), source: "Hermes Cockpit Observability", period_days: Number($("telemetry-range").value), note: "Authenticated same-origin GET responses; browser fetch duration is not model latency or network RTT.", endpoints: Object.fromEntries(currentDefinitions.map((definition) => { const result = state.results[definition.id]; return [definition.path, result ? {ok: result.ok, http_status: result.status, browser_fetch_ms: result.elapsed, error: result.error || undefined, data: redact(result.data)} : {ok: false, error: "Not requested"}]; }))}, null, 2);
  }

  async function refresh() {
    if (state.refreshing || state.paused || document.hidden) return; state.refreshing = true; const button = $("telemetry-refresh"), currentDefinitions = definitions(); button.classList.add("is-busy"); button.disabled = true;
    try {
      const results = await Promise.all(currentDefinitions.map(request)); results.forEach((result) => { state.results[result.definition.id] = result; }); state.usage = state.results.usage?.ok ? state.results.usage.data : null; state.models = state.results.models?.ok ? list(state.results.models.data, ["models", "items", "results"]) : [];
      renderConnection(currentDefinitions); renderMetrics(); renderChart(); renderSessionStore(); renderModels(); renderToolsAndSkills(); renderInventory(); const available = results.filter((result) => result.ok).length; state.history.unshift({at: new Date(), ok: available}); state.history = state.history.slice(0, 12); renderEndpoints(currentDefinitions); $("telemetry-updated").textContent = `Updated ${new Date().toLocaleTimeString([], {hour: "numeric", minute: "2-digit", second: "2-digit"})}`;
    } finally { state.refreshing = false; button.classList.remove("is-busy"); button.disabled = false; }
  }

  async function loadLogs() {
    const button = $("logs-refresh"), output = $("log-output"), status = $("log-state"), params = new URLSearchParams({file: $("log-file").value, lines: $("log-lines").value});
    if ($("log-level").value) params.set("level", $("log-level").value); if ($("log-search").value.trim()) params.set("search", $("log-search").value.trim()); if ($("log-component").value.trim()) params.set("component", $("log-component").value.trim());
    button.disabled = true; button.firstElementChild.classList.add("spin"); status.className = "log-state"; status.textContent = "Loading logs…"; output.hidden = true;
    const result = await request({id: "logs", label: "Logs", path: `/hermes/api/logs?${params}`}); button.disabled = false; button.firstElementChild.classList.remove("spin");
    if (!result.ok) { status.className = "log-state is-error"; status.textContent = `Logs unavailable: ${errorText(result)}`; return; }
    const payload = redact(result.data), logValue = first(payload, ["logs", "lines", "entries", "content", "text", "response"]); let rendered;
    if (Array.isArray(logValue)) rendered = logValue.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).join("\n"); else if (typeof logValue === "string") rendered = logValue; else rendered = JSON.stringify(payload, null, 2);
    rendered = redactText(rendered || ""); status.textContent = rendered ? `${$("log-file").value} log · fetched ${new Date().toLocaleTimeString()}` : "The logs API returned no matching lines."; output.textContent = rendered; output.hidden = !rendered;
  }

  document.querySelectorAll(".telemetry-tabs button").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  document.querySelectorAll("[data-open-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.openView)));
  $("telemetry-refresh").addEventListener("click", refresh); $("telemetry-range").addEventListener("change", () => { state.results = {}; refresh(); }); $("model-filter").addEventListener("input", renderModels); $("logs-refresh").addEventListener("click", loadLogs); $("log-filters").addEventListener("submit", (event) => { event.preventDefault(); loadLogs(); });
  $("telemetry-pause").addEventListener("click", () => { state.paused = !state.paused; const icon = $("telemetry-pause").firstElementChild, text = $("telemetry-pause").lastElementChild; icon.textContent = state.paused ? "play_arrow" : "pause"; text.textContent = state.paused ? "Resume" : "Pause"; if (!state.paused) refresh(); });
  $("telemetry-copy").addEventListener("click", async () => { const text = $("telemetry-copy").lastElementChild; try { await navigator.clipboard.writeText(snapshot()); text.textContent = "Copied"; } catch { text.textContent = "Copy unavailable"; } setTimeout(() => { text.textContent = "Copy snapshot"; }, 1600); });
  $("clear-poll-history").addEventListener("click", () => { state.history = []; renderEndpoints(definitions()); }); document.addEventListener("visibilitychange", () => { if (!document.hidden && !state.paused) refresh(); });
  renderEndpoints(definitions()); refresh(); setInterval(refresh, INTERVAL);
})();
