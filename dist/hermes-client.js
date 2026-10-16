(function () {
  "use strict";

  const root = document.body;
  if (root?.dataset.hermesClient !== "true") return;

  const API_BASE = root.dataset.hermesBase || "/hermes";
  const feed = document.getElementById("execution-feed");
  const composer = document.getElementById("composer-input");
  const sidebar = document.getElementById("live-control-sidebar");
  const executeButton = document.getElementById("execute-prompt");
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const state = {
    socket: null,
    terminal: null,
    resizeObserver: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    intentionalClose: false,
    connected: false,
    resume: null,
    profile: "",
    health: null,
    currentModel: null,
    sessionKey: getSessionValue("hermes-cockpit-channel", randomId("cockpit")),
    attachKey: getSessionValue("hermes-cockpit-attach", randomId("attach"))
  };

  function randomId(prefix) {
    const value = globalThis.crypto?.randomUUID?.().replaceAll("-", "") ||
      Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `${prefix}-${value}`;
  }

  function getSessionValue(key, fallback) {
    try {
      const current = sessionStorage.getItem(key);
      if (current) return current;
      sessionStorage.setItem(key, fallback);
    } catch (_) {}
    return fallback;
  }

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function request(path, options = {}) {
    const response = await fetch(apiUrl(path), {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    if (response.status === 401 || response.status === 403) throw new AuthRequiredError(response.status);
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const payload = await response.json();
        detail = payload.detail || payload.error || detail;
      } catch (_) {}
      throw new Error(detail);
    }
    return response.json();
  }

  class AuthRequiredError extends Error {
    constructor(status) {
      super("Sign in to Hermes to continue.");
      this.name = "AuthRequiredError";
      this.status = status;
    }
  }

  function text(node, value) {
    if (node) node.textContent = value == null ? "" : String(value);
  }

  function setConnection(status, detail = "") {
    state.connected = status === "connected";
    const badge = document.getElementById("cockpit-connection");
    const label = document.getElementById("cockpit-connection-label");
    if (badge) badge.dataset.state = status;
    text(label, detail || ({ connected: "Connected", connecting: "Connecting…", offline: "Offline" }[status] || status));
    const headerStatus = document.getElementById("cockpit-header-status");
    if (headerStatus) {
      headerStatus.dataset.state = status;
      headerStatus.textContent = detail || status;
    }
    if (executeButton) executeButton.disabled = !state.connected;
    const notice = document.getElementById("demo-notice");
    if (notice) {
      notice.textContent = state.connected ? "Live Hermes connection" : "Hermes connection unavailable";
      notice.title = detail;
      notice.dataset.live = state.connected ? "true" : "false";
    }
  }

  function renderShell() {
    if (!feed || !sidebar) return false;
    feed.replaceChildren();
    feed.className = "cockpit-terminal-feed";

    const frame = document.createElement("section");
    frame.className = "cockpit-terminal-frame";
    frame.setAttribute("aria-label", "Live Hermes terminal");
    frame.innerHTML = `
      <div class="cockpit-terminal-toolbar">
        <div class="cockpit-connection" id="cockpit-connection" data-state="connecting">
          <span class="cockpit-status-dot"></span>
          <span id="cockpit-connection-label">Connecting…</span>
        </div>
        <div class="cockpit-terminal-actions">
          <button type="button" id="cockpit-copy" title="Copy selected terminal text">Copy</button>
          <button type="button" id="cockpit-reconnect" title="Reconnect to Hermes">Reconnect</button>
          <button type="button" id="cockpit-new-session" title="Start a fresh Hermes session">New session</button>
        </div>
      </div>
      <div id="hermes-terminal" class="cockpit-terminal" tabindex="0"></div>
      <div id="cockpit-auth" class="cockpit-auth hidden">
        <strong>Hermes sign-in required</strong>
        <span>Your credentials stay with Hermes and are never stored by Cockpit.</span>
        <a id="cockpit-sign-in" href="#">Sign in to Hermes</a>
      </div>`;
    feed.append(frame);

    sidebar.replaceChildren();
    sidebar.className = "cockpit-control-panel";
    sidebar.innerHTML = `
      <section class="cockpit-panel-section">
        <div class="cockpit-panel-heading"><span class="material-symbols-outlined">memory</span><h2>Hermes runtime</h2></div>
        <dl class="cockpit-facts">
          <div><dt>Version</dt><dd id="cockpit-version">—</dd></div>
          <div><dt>Profile</dt><dd id="cockpit-profile">default</dd></div>
          <div><dt>Model</dt><dd id="cockpit-model">Loading…</dd></div>
        </dl>
      </section>
      <section class="cockpit-panel-section">
        <div class="cockpit-panel-heading"><span class="material-symbols-outlined">model_training</span><h2>Model for this chat</h2></div>
        <label class="cockpit-field" for="cockpit-model-picker">Available models</label>
        <select id="cockpit-model-picker"><option value="">Loading model catalog…</option></select>
        <button type="button" class="cockpit-primary-action" id="cockpit-apply-model">Switch current chat</button>
        <p class="cockpit-help">This sends Hermes’ native <code>/model</code> command. It changes the active chat without exposing provider credentials.</p>
      </section>
      <section class="cockpit-panel-section cockpit-sessions-section">
        <div class="cockpit-panel-heading cockpit-heading-row"><span class="material-symbols-outlined">history</span><h2>Recent sessions</h2><button type="button" id="cockpit-refresh-sessions" title="Refresh sessions">↻</button></div>
        <div id="cockpit-sessions" class="cockpit-session-list"><p class="cockpit-muted">Loading sessions…</p></div>
      </section>
      <section class="cockpit-panel-section">
        <div class="cockpit-panel-heading"><span class="material-symbols-outlined">groups</span><h2>Bot Mode roster</h2></div>
        <label class="cockpit-field" for="cockpit-profile-picker">Run chat as</label>
        <select id="cockpit-profile-picker"><option value="">Default profile</option></select>
        <div id="cockpit-bots" class="cockpit-bot-list"><p class="cockpit-muted">Loading agents…</p></div>
        <p class="cockpit-help">Each bot is a native Hermes profile. Choose one to start its own session with its configured model and tools.</p>
      </section>`;

    document.getElementById("cockpit-copy")?.addEventListener("click", copySelection);
    document.getElementById("cockpit-reconnect")?.addEventListener("click", () => connect({ resume: state.resume }));
    document.getElementById("cockpit-new-session")?.addEventListener("click", newSession);
    document.getElementById("cockpit-refresh-sessions")?.addEventListener("click", loadSessions);
    document.getElementById("cockpit-apply-model")?.addEventListener("click", applySelectedModel);
    document.getElementById("cockpit-profile-picker")?.addEventListener("change", (event) => {
      state.profile = event.target.value;
      text(document.getElementById("cockpit-profile"), state.profile || "default");
    });
    const signIn = document.getElementById("cockpit-sign-in");
    if (signIn) signIn.href = `${API_BASE}/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    return true;
  }

  function renderLiveHeader() {
    const header = document.querySelector("#shared-header header");
    if (!header || header.children.length < 3) return;
    header.children[1].innerHTML = `
      <div class="cockpit-header-live">
        <span class="cockpit-status-dot"></span>
        <span>Hermes</span>
        <span id="cockpit-header-status" data-state="connecting">Connecting…</span>
      </div>`;
    header.children[2].innerHTML = `
      <a class="cockpit-admin-link" href="${API_BASE}/" target="_blank" rel="noreferrer">Hermes admin ↗</a>`;
    const versionBadge = header.children[0].querySelector("span:last-child");
    if (versionBadge) versionBadge.textContent = "beta";
  }

  function initTerminal() {
    const host = document.getElementById("hermes-terminal");
    if (!host || typeof globalThis.Terminal !== "function") {
      showTerminalMessage("The terminal runtime did not load. Refresh the page or verify the vendored xterm files.", "error");
      return false;
    }
    const terminal = new globalThis.Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
      fontSize: matchMedia("(max-width: 767px)").matches ? 12 : 13,
      lineHeight: 1.22,
      scrollback: 8000,
      theme: {
        background: "#0d0d1c",
        foreground: "#e5e9f0",
        cursor: "#a3dcec",
        cursorAccent: "#0d0d1c",
        selectionBackground: "#4c566a99",
        black: "#181825", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
        blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
        brightBlack: "#616e88", brightRed: "#d57780", brightGreen: "#b4ce9f", brightYellow: "#f3d7a2",
        brightBlue: "#9bb8d3", brightMagenta: "#c9a4c1", brightCyan: "#a3dcec", brightWhite: "#ffffff"
      }
    });
    terminal.open(host);
    terminal.onData((data) => sendRaw(data));
    terminal.attachCustomKeyEventHandler((event) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (event.type === "keydown" && modifier && event.key.toLowerCase() === "c" && terminal.hasSelection()) {
        copySelection();
        return false;
      }
      if (event.type === "keydown" && modifier && event.key.toLowerCase() === "v") {
        navigator.clipboard?.readText().then((value) => value && sendRaw(value)).catch(() => {});
        return false;
      }
      return true;
    });
    state.terminal = terminal;
    const resize = () => fitTerminal(host, terminal);
    state.resizeObserver = new ResizeObserver(resize);
    state.resizeObserver.observe(host);
    requestAnimationFrame(resize);
    return true;
  }

  function fitTerminal(host, terminal) {
    if (!host.clientWidth || !host.clientHeight) return;
    const fontSize = Number(terminal.options.fontSize || 13);
    const canvas = fitTerminal.canvas || (fitTerminal.canvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    context.font = `${fontSize}px "JetBrains Mono", monospace`;
    const cellWidth = Math.max(6, context.measureText("W").width);
    const cols = Math.max(20, Math.floor((host.clientWidth - 18) / cellWidth));
    const rows = Math.max(8, Math.floor((host.clientHeight - 18) / (fontSize * 1.22)));
    if (cols !== terminal.cols || rows !== terminal.rows) {
      terminal.resize(cols, rows);
      if (state.socket?.readyState === WebSocket.OPEN) sendRaw(`\u001b[RESIZE:${cols};${rows}]`);
    }
  }

  function showTerminalMessage(message, kind = "info") {
    if (state.terminal) {
      const color = kind === "error" ? "31" : kind === "success" ? "32" : "36";
      state.terminal.writeln(`\r\n\u001b[${color}m${message}\u001b[0m`);
    }
  }

  async function wsTicket() {
    const payload = await request("/api/auth/ws-ticket", { method: "POST" });
    if (!payload.ticket) throw new Error("Hermes did not return a WebSocket ticket.");
    return payload.ticket;
  }

  async function connect({ resume = null, fresh = false } = {}) {
    clearTimeout(state.reconnectTimer);
    state.intentionalClose = true;
    if (state.socket) state.socket.close(1000, "Cockpit reconnect");
    state.socket = null;
    state.intentionalClose = false;
    state.resume = resume || null;
    setConnection("connecting", resume ? "Resuming session…" : "Starting Hermes…");
    document.getElementById("cockpit-auth")?.classList.add("hidden");

    try {
      const ticket = await wsTicket();
      const params = new URLSearchParams({
        channel: state.sessionKey,
        attach: state.attachKey,
        ticket
      });
      if (state.resume) params.set("resume", state.resume);
      if (state.profile) params.set("profile", state.profile);
      if (fresh) params.set("fresh", "1");
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const path = `${API_BASE}/api/pty?${params}`;
      const socket = new WebSocket(`${protocol}//${location.host}${path}`);
      socket.binaryType = "arraybuffer";
      state.socket = socket;

      socket.onopen = () => {
        if (state.socket !== socket) return;
        state.reconnectAttempt = 0;
        setConnection("connected", state.resume ? "Session resumed" : "Hermes connected");
        sendRaw(`\u001b[RESIZE:${state.terminal?.cols || 80};${state.terminal?.rows || 24}]`);
        state.terminal?.focus();
        loadSessions();
      };
      socket.onmessage = (event) => {
        let output = typeof event.data === "string" ? event.data : decoder.decode(new Uint8Array(event.data), { stream: true });
        if (typeof output === "string" && output.startsWith("{")) {
          try {
            const control = JSON.parse(output);
            if (control.type === "resume" && control.id) {
              state.resume = control.id;
              return;
            }
          } catch (_) {}
        }
        state.terminal?.write(output);
      };
      socket.onerror = () => setConnection("offline", "Hermes WebSocket error");
      socket.onclose = (event) => {
        if (state.socket !== socket) return;
        state.socket = null;
        state.connected = false;
        if (event.code === 4401) return showAuth();
        if (event.code === 4410) {
          setConnection("offline", "Session ended");
          showTerminalMessage("Hermes session ended. Start a new session or resume one from the sidebar.", "info");
          return;
        }
        setConnection("offline", event.reason || `Disconnected (${event.code || "network"})`);
        if (!state.intentionalClose) scheduleReconnect();
      };
    } catch (error) {
      if (error instanceof AuthRequiredError) return showAuth();
      setConnection("offline", error.message);
      showTerminalMessage(`Could not connect to Hermes: ${error.message}`, "error");
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    clearTimeout(state.reconnectTimer);
    const delay = Math.min(15000, 1000 * 2 ** Math.min(4, state.reconnectAttempt++));
    state.reconnectTimer = setTimeout(() => connect({ resume: state.resume }), delay);
  }

  function showAuth() {
    setConnection("offline", "Sign in required");
    document.getElementById("cockpit-auth")?.classList.remove("hidden");
  }

  function sendRaw(value) {
    if (state.socket?.readyState !== WebSocket.OPEN) return false;
    state.socket.send(typeof value === "string" ? value : encoder.encode(value));
    return true;
  }

  function sendCommand(command) {
    const value = String(command || "").trim();
    if (!value) return false;
    if (!sendRaw(`${value}\r`)) {
      setConnection("offline", "Reconnect before sending");
      return false;
    }
    state.terminal?.focus();
    return true;
  }

  function sendComposer() {
    if (!composer) return;
    const value = composer.value.trim();
    if (sendCommand(value)) {
      composer.value = "";
      composer.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function newSession() {
    state.resume = null;
    state.sessionKey = randomId("cockpit");
    state.attachKey = randomId("attach");
    try {
      sessionStorage.setItem("hermes-cockpit-channel", state.sessionKey);
      sessionStorage.setItem("hermes-cockpit-attach", state.attachKey);
    } catch (_) {}
    state.terminal?.clear();
    connect({ fresh: true });
  }

  async function copySelection() {
    const selected = state.terminal?.getSelection() || "";
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected);
      setConnection("connected", "Selection copied");
      setTimeout(() => state.connected && setConnection("connected", "Hermes connected"), 1400);
    } catch (_) {
      showTerminalMessage("Browser clipboard permission was denied.", "error");
    }
  }

  function sessionLabel(session) {
    return session.title || session.name || session.preview || session.first_message || `Session ${String(session.session_id || session.id || "").slice(0, 8)}`;
  }

  async function loadSessions() {
    const target = document.getElementById("cockpit-sessions");
    if (!target) return;
    try {
      const profile = state.profile ? `&profile=${encodeURIComponent(state.profile)}` : "";
      const payload = await request(`/api/sessions?limit=30&order=recent&min_messages=1${profile}`);
      target.replaceChildren();
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      if (!sessions.length) {
        target.innerHTML = '<p class="cockpit-muted">No saved sessions yet.</p>';
        return;
      }
      for (const session of sessions) {
        const id = session.session_id || session.id;
        if (!id) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cockpit-session";
        button.dataset.active = state.resume === id ? "true" : "false";
        const label = document.createElement("span");
        label.className = "cockpit-session-title";
        label.textContent = sessionLabel(session);
        const meta = document.createElement("span");
        meta.className = "cockpit-session-meta";
        meta.textContent = `${session.message_count || 0} messages${session.is_active ? " · active" : ""}`;
        button.append(label, meta);
        button.addEventListener("click", () => {
          state.terminal?.clear();
          connect({ resume: id });
        });
        target.append(button);
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) return showAuth();
      target.innerHTML = '<p class="cockpit-muted">Sessions unavailable.</p>';
    }
  }

  function modelName(entry) {
    if (typeof entry === "string") return entry;
    return entry?.id || entry?.model || entry?.name || "";
  }

  async function loadModels() {
    const picker = document.getElementById("cockpit-model-picker");
    if (!picker) return;
    try {
      const profile = state.profile ? `?profile=${encodeURIComponent(state.profile)}` : "";
      const [info, options] = await Promise.all([
        request(`/api/model/info${profile}`),
        request(`/api/model/options${profile ? `${profile}&` : "?"}include_unconfigured=true`)
      ]);
      state.currentModel = info.model || "";
      text(document.getElementById("cockpit-model"), info.model ? `${info.provider || "provider"} / ${info.model}` : "Not configured");
      picker.replaceChildren();
      const providers = Array.isArray(options.providers) ? options.providers : [];
      for (const provider of providers) {
        const group = document.createElement("optgroup");
        const providerId = provider.slug || provider.id || provider.provider || provider.name || "provider";
        group.label = provider.display_name || provider.name || providerId;
        for (const model of provider.models || []) {
          const name = modelName(model);
          if (!name) continue;
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          option.dataset.provider = providerId;
          if (name === info.model) option.selected = true;
          group.append(option);
        }
        if (group.childElementCount) picker.append(group);
      }
      if (!picker.childElementCount) {
        const option = document.createElement("option");
        option.value = info.model || "";
        option.textContent = info.model || "No model options returned";
        picker.append(option);
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) return showAuth();
      picker.innerHTML = '<option value="">Model catalog unavailable</option>';
    }
  }

  function applySelectedModel() {
    const picker = document.getElementById("cockpit-model-picker");
    if (!picker?.value) return;
    sendCommand(`/model ${picker.value}`);
  }

  async function loadProfiles() {
    const picker = document.getElementById("cockpit-profile-picker");
    const roster = document.getElementById("cockpit-bots");
    if (!picker) return;
    try {
      const payload = await request("/api/profiles");
      const profiles = Array.isArray(payload) ? payload : payload.profiles || [];
      if (roster) roster.replaceChildren();
      for (const profile of profiles) {
        const id = typeof profile === "string" ? profile : profile.id || profile.name || profile.slug;
        if (!id) continue;
        if (id !== "default") {
          const option = document.createElement("option");
          option.value = id;
          option.textContent = profile.display_name || profile.bot_title || id;
          picker.append(option);
        }
        if (roster) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "cockpit-bot";
          button.title = `Start a new chat as ${id}`;
          const identity = document.createElement("span");
          identity.className = "cockpit-bot-identity";
          const dot = document.createElement("i");
          dot.dataset.running = profile.gateway_running ? "true" : "false";
          const name = document.createElement("strong");
          name.textContent = profile.bot_title || profile.display_name || id;
          const profileName = document.createElement("small");
          profileName.textContent = id === "default" ? "default profile" : `@${id}`;
          identity.append(dot, name, profileName);
          const detail = document.createElement("span");
          detail.className = "cockpit-bot-detail";
          detail.textContent = profile.model || profile.description || "Use configured model";
          button.append(identity, detail);
          button.addEventListener("click", () => {
            state.profile = id === "default" ? "" : id;
            picker.value = state.profile;
            text(document.getElementById("cockpit-profile"), state.profile || "default");
            newSession();
          });
          roster.append(button);
        }
      }
      if (roster && !roster.childElementCount) roster.innerHTML = '<p class="cockpit-muted">No Hermes profiles found.</p>';
    } catch (error) {
      if (error instanceof AuthRequiredError) showAuth();
      if (roster) roster.innerHTML = '<p class="cockpit-muted">Bot roster unavailable.</p>';
    }
  }

  async function loadStatus() {
    try {
      const health = await request("/api/health");
      state.health = health;
      text(document.getElementById("cockpit-version"), health.displayVersion || health.version || "unknown");
    } catch (_) {
      text(document.getElementById("cockpit-version"), "unavailable");
    }
  }

  function installComposerBridge() {
    globalThis.simulateSendPrompt = sendComposer;
    globalThis.hermesCockpit = { sendComposer, sendCommand, reconnect: connect, newSession };
    composer?.setAttribute("autocomplete", "off");
    composer?.setAttribute("autocapitalize", "sentences");
    composer?.setAttribute("spellcheck", "true");
  }

  async function start() {
    if (!renderShell()) return;
    renderLiveHeader();
    document.getElementById("slash-menu-overlay")?.classList.add("hidden");
    installComposerBridge();
    if (!initTerminal()) return;
    await Promise.allSettled([loadStatus(), loadSessions(), loadModels(), loadProfiles()]);
    connect();
  }

  start().catch((error) => {
    setConnection("offline", error.message);
    showTerminalMessage(error.message, "error");
  });
})();
