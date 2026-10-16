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
  const RESUME_SANITIZE_WINDOW_MS = 30000;
  const BLANK_LINE_BURST = /(?:\r?\n){50,}/g;
  const ERASE_LINE = /\x1b\[\d*K/g;
  const ERASE_CHAR = /\x1b\[\d*X/g;
  const PARTIAL_ESCAPE = /^\x1b(?:\[\d*)?$/;
  const TRAILING_NEWLINES = /(?:\r?\n)*\r?$/;

  function applyResumeFilters(input, stripErase = true) {
    const collapsed = input.replace(BLANK_LINE_BURST, "\r\n\r\n");
    return stripErase ? collapsed.replace(ERASE_LINE, "").replace(ERASE_CHAR, "") : collapsed;
  }

  class ResumeSanitizer {
    constructor() {
      this.pending = "";
      this.stripErase = true;
    }

    endEraseSuppression() {
      this.stripErase = false;
    }

    next(chunk) {
      const combined = this.pending + chunk;
      if (!combined) {
        this.pending = "";
        return "";
      }
      const lastEscape = combined.lastIndexOf("\x1b");
      if (lastEscape !== -1 && PARTIAL_ESCAPE.test(combined.slice(lastEscape))) {
        this.pending = combined.slice(lastEscape);
        return applyResumeFilters(combined.slice(0, lastEscape), this.stripErase);
      }
      const trailing = TRAILING_NEWLINES.exec(combined);
      if (trailing.index === 0) {
        this.pending = combined;
        return "";
      }
      this.pending = trailing[0];
      return applyResumeFilters(combined.slice(0, trailing.index), this.stripErase);
    }

    flush() {
      const pending = this.pending;
      this.pending = "";
      if (!pending || pending.includes("\x1b")) return "";
      return applyResumeFilters(pending, this.stripErase);
    }
  }
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
    gateway: null,
    botProfiles: [],
    botRefreshTimer: null,
    mode: "terminal",
    botProfile: null,
    botSession: null,
    botMessages: [],
    botStreaming: false,
    botEventUnsubscribe: null,
    botTodos: [],
    botSubagents: [],
    selectedSubagent: null,
    subagentTail: "",
    botActivity: [],
    botPollTimer: null,
    voiceRecorder: null,
    voiceStream: null,
    voiceChunks: [],
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
          <button type="button" id="cockpit-terminal-mode" class="hidden" title="Return to the regular Hermes terminal">Terminal</button>
          <button type="button" id="cockpit-interrupt-bot" class="hidden" title="Stop the active Bot Mode response">Stop</button>
        </div>
      </div>
      <div id="hermes-terminal" class="cockpit-terminal" tabindex="0"></div>
      <div id="cockpit-bot-chat" class="cockpit-native-chat hidden" aria-label="Hermes Bot Mode conversation">
        <div class="cockpit-native-chat-heading">
          <div><strong id="cockpit-bot-chat-title">Bot Chat</strong><span id="cockpit-bot-chat-profile">Hermes profile</span></div>
          <span id="cockpit-bot-chat-status">Loading conversation…</span>
        </div>
        <div class="cockpit-bot-workspace">
          <div id="cockpit-bot-transcript" class="cockpit-native-transcript" role="log" aria-live="polite"></div>
          <aside class="cockpit-bot-activity" aria-label="Live Bot Mode activity">
            <section><div class="cockpit-activity-heading"><strong>Task list</strong><span id="cockpit-task-count">0</span></div><div id="cockpit-task-list" class="cockpit-task-list"><p>Waiting for task state…</p></div></section>
            <section><div class="cockpit-activity-heading"><strong>Subagents</strong><span id="cockpit-subagent-count">0</span></div><div id="cockpit-subagent-list" class="cockpit-subagent-list"><p>No active subagents</p></div><div id="cockpit-subagent-detail" class="cockpit-subagent-detail hidden"><div class="cockpit-subagent-detail-head"><strong id="cockpit-subagent-detail-title">Subagent</strong><button id="cockpit-subagent-close" type="button" aria-label="Close subagent detail">×</button></div><pre id="cockpit-subagent-tail">Waiting for transcript…</pre><textarea id="cockpit-subagent-steer-text" rows="2" placeholder="Send guidance to this subagent"></textarea><div><button id="cockpit-subagent-steer" type="button">Send guidance</button><button id="cockpit-subagent-stop" type="button">Stop subagent</button></div></div></section>
            <section><div class="cockpit-activity-heading"><strong>Live activity</strong><span id="cockpit-activity-count">0</span></div><div id="cockpit-activity-list" class="cockpit-activity-list"><p>Waiting for activity…</p></div></section>
          </aside>
        </div>
      </div>
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
        <div class="cockpit-panel-heading cockpit-heading-row"><span class="material-symbols-outlined">groups</span><h2>Bot Mode</h2><button type="button" id="cockpit-refresh-bots" title="Refresh Bot Mode">↻</button></div>
        <label class="cockpit-field" for="cockpit-profile-picker">Open bot chat</label>
        <select id="cockpit-profile-picker"><option value="">Default profile</option></select>
        <div id="cockpit-bots" class="cockpit-bot-list"><p class="cockpit-muted">Loading agents…</p></div>
        <p class="cockpit-help">The same profile roster and canonical hidden <code>Bot Chat</code> sessions used by Hermes Desktop. Opening a bot resumes its one persistent chat.</p>
      </section>`;

    document.getElementById("cockpit-copy")?.addEventListener("click", copySelection);
    document.getElementById("cockpit-reconnect")?.addEventListener("click", () => state.mode === "bot" && state.botProfile ? openBotChat(state.botProfile) : connect({ resume: state.resume }));
    document.getElementById("cockpit-new-session")?.addEventListener("click", newSession);
    document.getElementById("cockpit-terminal-mode")?.addEventListener("click", () => setWorkspaceMode("terminal"));
    document.getElementById("cockpit-interrupt-bot")?.addEventListener("click", interruptBot);
    document.getElementById("cockpit-refresh-sessions")?.addEventListener("click", loadSessions);
    document.getElementById("cockpit-refresh-bots")?.addEventListener("click", loadProfiles);
    document.getElementById("cockpit-apply-model")?.addEventListener("click", applySelectedModel);
    document.getElementById("cockpit-subagent-close")?.addEventListener("click", closeSubagentDetail);
    document.getElementById("cockpit-subagent-steer")?.addEventListener("click", steerSelectedSubagent);
    document.getElementById("cockpit-subagent-stop")?.addEventListener("click", interruptSelectedSubagent);
    document.getElementById("cockpit-profile-picker")?.addEventListener("change", (event) => {
      const name = event.target.value || "default";
      const profile = state.botProfiles.find((entry) => entry.name === name);
      if (profile) openBotChat(profile);
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
      <a class="cockpit-admin-link" href="runtime-config-settings.html" aria-label="Open Cockpit settings">Settings</a>`;
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

  class GatewayRpc {
    constructor() {
      this.socket = null;
      this.pending = new Map();
      this.counter = 0;
      this.connecting = null;
      this.ready = false;
      this.heartbeat = null;
      this.listeners = new Set();
    }

    async ensure() {
      if (this.socket?.readyState === WebSocket.OPEN && this.ready) return this;
      if (this.connecting) return this.connecting;
      this.connecting = this.open().finally(() => { this.connecting = null; });
      return this.connecting;
    }

    async open() {
      this.close();
      const ticket = await wsTicket();
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${location.host}${API_BASE}/api/ws?ticket=${encodeURIComponent(ticket)}`;
      await new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        let settled = false;
        const timeout = window.setTimeout(() => {
          if (!settled) reject(new Error("Hermes Bot Mode gateway timed out."));
          socket.close();
        }, 12000);
        socket.onmessage = (event) => {
          const frames = String(event.data || "").split(/\r?\n/).filter(Boolean);
          for (const raw of frames) {
            let frame;
            try { frame = JSON.parse(raw); } catch (_) { continue; }
            if (frame.id && this.pending.has(String(frame.id))) {
              const pending = this.pending.get(String(frame.id));
              this.pending.delete(String(frame.id));
              window.clearTimeout(pending.timer);
              if (frame.error) pending.reject(new Error(frame.error.message || "Hermes gateway request failed."));
              else pending.resolve(frame.result);
              continue;
            }
            if (frame.method === "event" && frame.params?.type === "gateway.ready") {
              this.ready = true;
              if (!settled) {
                settled = true;
                window.clearTimeout(timeout);
                resolve(this);
              }
              const heartbeat = frame.params?.payload?.heartbeat;
              if (heartbeat && !this.heartbeat) {
                this.heartbeat = window.setInterval(() => {
                  this.call("gateway.ping", {}, 8000).catch(() => {});
                }, 15000);
              }
            }
            if (frame.method === "event") {
              for (const listener of this.listeners) {
                try { listener(frame.params || {}); } catch (_) {}
              }
            }
          }
        };
        socket.onopen = () => { this.socket = socket; };
        socket.onerror = () => {
          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            reject(new Error("Could not connect to the Hermes Bot Mode gateway."));
          }
        };
        socket.onclose = (event) => {
          this.ready = false;
          if (this.socket === socket) this.socket = null;
          if (this.heartbeat) window.clearInterval(this.heartbeat);
          this.heartbeat = null;
          for (const pending of this.pending.values()) {
            window.clearTimeout(pending.timer);
            pending.reject(new Error(event.reason || "Hermes Bot Mode gateway disconnected."));
          }
          this.pending.clear();
          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            reject(new Error(event.code === 4401 ? "Sign in to Hermes to use Bot Mode." : "Hermes Bot Mode gateway disconnected."));
          }
        };
      });
      return this;
    }

    async call(method, params = {}, timeoutMs = 20000) {
      await this.ensure();
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("Hermes Bot Mode gateway is unavailable.");
      const id = `cockpit-${++this.counter}-${Date.now().toString(36)}`;
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`${method} timed out.`));
        }, timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    }

    onEvent(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    close() {
      if (this.socket) this.socket.close(1000, "Cockpit Bot Mode reconnect");
      this.socket = null;
      this.ready = false;
      if (this.heartbeat) window.clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  function gateway() {
    if (!state.gateway) state.gateway = new GatewayRpc();
    return state.gateway;
  }

  function setWorkspaceMode(mode) {
    state.mode = mode === "bot" ? "bot" : "terminal";
    const terminal = document.getElementById("hermes-terminal");
    const botChat = document.getElementById("cockpit-bot-chat");
    const terminalButton = document.getElementById("cockpit-terminal-mode");
    const interruptButton = document.getElementById("cockpit-interrupt-bot");
    terminal?.classList.toggle("hidden", state.mode === "bot");
    botChat?.classList.toggle("hidden", state.mode !== "bot");
    terminalButton?.classList.toggle("hidden", state.mode !== "bot");
    interruptButton?.classList.toggle("hidden", state.mode !== "bot" || !state.botStreaming);
    if (state.mode === "terminal") {
      if (state.botPollTimer) window.clearInterval(state.botPollTimer);
      state.botPollTimer = null;
      setConnection(state.socket?.readyState === WebSocket.OPEN ? "connected" : "connecting", state.socket?.readyState === WebSocket.OPEN ? "Hermes connected" : "Reconnecting terminal…");
      if (state.socket?.readyState !== WebSocket.OPEN) connect({ resume: state.resume });
      window.setTimeout(() => resizeTerminal(), 0);
    }
  }

  function setBotStatus(value) {
    text(document.getElementById("cockpit-bot-chat-status"), value || "Ready");
  }

  function messageText(message) {
    if (!message) return "";
    if (typeof message.text === "string") return message.text;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content.map((item) => typeof item === "string" ? item : item?.text || "").filter(Boolean).join("\n");
    }
    return "";
  }

  function renderBotMessages() {
    const transcript = document.getElementById("cockpit-bot-transcript");
    if (!transcript) return;
    const wasEmpty = transcript.childElementCount === 0;
    const stickToBottom = wasEmpty || transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 120;
    transcript.replaceChildren();
    if (!state.botMessages.length) {
      const empty = document.createElement("div");
      empty.className = "cockpit-native-empty";
      empty.textContent = "This Bot Chat is ready. Send the first message below.";
      transcript.append(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const message of state.botMessages) {
      const role = String(message.role || "assistant").toLowerCase();
      const article = document.createElement("article");
      article.className = "cockpit-native-message";
      article.dataset.role = role;
      const label = document.createElement("div");
      label.className = "cockpit-native-message-role";
      label.textContent = role === "user" ? "You" : role === "assistant" ? botTitle(state.botProfile) : role;
      const content = document.createElement("div");
      content.className = "cockpit-native-message-content";
      content.textContent = messageText(message) || (message._streaming ? "Thinking…" : "");
      article.append(label, content);
      if (message.reasoning) {
        const reasoning = document.createElement("details");
        reasoning.className = "cockpit-native-reasoning";
        const summary = document.createElement("summary");
        summary.textContent = "Reasoning";
        const body = document.createElement("div");
        body.textContent = String(message.reasoning);
        reasoning.append(summary, body);
        article.append(reasoning);
      }
      fragment.append(article);
    }
    transcript.append(fragment);
    if (stickToBottom) transcript.scrollTop = transcript.scrollHeight;
  }

  function renderBotTasks() {
    const host = document.getElementById("cockpit-task-list");
    text(document.getElementById("cockpit-task-count"), state.botTodos.length);
    if (!host) return;
    host.replaceChildren();
    if (!state.botTodos.length) {
      const empty = document.createElement("p");
      empty.textContent = "No task list in this session.";
      host.append(empty);
      return;
    }
    for (const task of state.botTodos) {
      const row = document.createElement("div");
      row.className = "cockpit-task-row";
      row.dataset.status = task.status || "pending";
      const icon = document.createElement("span");
      icon.className = "material-symbols-outlined";
      icon.textContent = task.status === "completed" ? "check_circle" : task.status === "in_progress" ? "pending" : task.status === "cancelled" ? "cancel" : "radio_button_unchecked";
      const copy = document.createElement("span");
      copy.textContent = task.content || task.title || task.id || "Untitled task";
      row.append(icon, copy);
      host.append(row);
    }
  }

  function renderBotSubagents() {
    const host = document.getElementById("cockpit-subagent-list");
    text(document.getElementById("cockpit-subagent-count"), state.botSubagents.length);
    if (!host) return;
    host.replaceChildren();
    if (!state.botSubagents.length) {
      const empty = document.createElement("p");
      empty.textContent = "No active subagents.";
      host.append(empty);
      return;
    }
    for (const agent of state.botSubagents) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "cockpit-subagent-row";
      row.dataset.status = agent.status || "running";
      row.dataset.active = state.selectedSubagent === agent.subagent_id ? "true" : "false";
      const top = document.createElement("div");
      const goal = document.createElement("strong");
      goal.textContent = agent.goal || agent.subagent_id || "Subagent";
      const badge = document.createElement("span");
      badge.textContent = agent.status || "running";
      top.append(goal, badge);
      const meta = document.createElement("div");
      meta.className = "cockpit-subagent-meta";
      meta.textContent = [agent.model, agent.last_tool ? `tool: ${agent.last_tool}` : "", Number.isFinite(agent.tool_count) ? `${agent.tool_count} tools` : ""].filter(Boolean).join(" · ");
      row.append(top, meta);
      row.addEventListener("click", () => openSubagentDetail(agent));
      host.append(row);
    }
  }

  async function openSubagentDetail(agent) {
    if (!agent?.subagent_id) return;
    state.selectedSubagent = agent.subagent_id;
    state.subagentTail = "";
    text(document.getElementById("cockpit-subagent-detail-title"), agent.goal || agent.subagent_id);
    document.getElementById("cockpit-subagent-detail")?.classList.remove("hidden");
    text(document.getElementById("cockpit-subagent-tail"), "Loading live transcript…");
    renderBotSubagents();
    await refreshSelectedSubagentTail();
  }

  function closeSubagentDetail() {
    state.selectedSubagent = null;
    state.subagentTail = "";
    document.getElementById("cockpit-subagent-detail")?.classList.add("hidden");
    renderBotSubagents();
  }

  async function refreshSelectedSubagentTail() {
    if (!state.selectedSubagent || !state.botSession?.runtimeId) return;
    try {
      const result = await gateway().call("subagent.tail", {
        session_id: state.botSession.runtimeId,
        subagent_id: state.selectedSubagent
      }, 12000);
      state.subagentTail = result?.text || "";
      text(document.getElementById("cockpit-subagent-tail"), result?.available ? (state.subagentTail || "Transcript is empty.") : "Live transcript is not available for this completed or reconnected subagent.");
    } catch (error) {
      text(document.getElementById("cockpit-subagent-tail"), error.message || "Could not load subagent transcript.");
    }
  }

  async function steerSelectedSubagent() {
    const input = document.getElementById("cockpit-subagent-steer-text");
    const value = input?.value.trim();
    if (!value || !state.selectedSubagent || !state.botSession?.runtimeId) return;
    try {
      const result = await gateway().call("subagent.steer", {
        session_id: state.botSession.runtimeId,
        subagent_id: state.selectedSubagent,
        text: value
      }, 12000);
      if (input) input.value = "";
      setBotStatus(result?.status === "queued" ? "Guidance queued for subagent" : "Subagent rejected guidance");
    } catch (error) {
      setBotStatus(error.message || "Could not guide subagent");
    }
  }

  async function interruptSelectedSubagent() {
    if (!state.selectedSubagent || !state.botSession?.runtimeId) return;
    try {
      const result = await gateway().call("subagent.interrupt", {
        session_id: state.botSession.runtimeId,
        subagent_id: state.selectedSubagent
      }, 12000);
      setBotStatus(result?.found ? "Subagent stop requested" : "Subagent is no longer active");
      await refreshBotSubagents();
    } catch (error) {
      setBotStatus(error.message || "Could not stop subagent");
    }
  }

  function renderBotActivity() {
    const host = document.getElementById("cockpit-activity-list");
    text(document.getElementById("cockpit-activity-count"), state.botActivity.length);
    if (!host) return;
    host.replaceChildren();
    if (!state.botActivity.length) {
      const empty = document.createElement("p");
      empty.textContent = "No live tool activity yet.";
      host.append(empty);
      return;
    }
    for (const activity of state.botActivity.slice(-30).reverse()) {
      const row = document.createElement("div");
      row.className = "cockpit-activity-row";
      row.dataset.status = activity.status;
      const icon = document.createElement("span");
      icon.className = "material-symbols-outlined";
      icon.textContent = activity.status === "complete" ? "check_circle" : activity.status === "error" ? "error" : "progress_activity";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = activity.name || "Hermes tool";
      const detail = document.createElement("span");
      detail.textContent = activity.summary || activity.context || (activity.status === "complete" ? "Completed" : "Running");
      copy.append(title, detail);
      row.append(icon, copy);
      host.append(row);
    }
  }

  function updateBotActivity(event) {
    const payload = event.payload || {};
    const id = payload.tool_id || `${payload.name || "tool"}-${event.seq || Date.now()}`;
    const index = state.botActivity.findIndex((item) => item.id === id);
    const next = {
      id,
      name: payload.labels?.title || payload.name || "Hermes tool",
      context: payload.context || payload.labels?.detail || "",
      summary: payload.summary || "",
      status: event.type === "tool.complete" ? (payload.error ? "error" : "complete") : "running"
    };
    if (index >= 0) state.botActivity[index] = { ...state.botActivity[index], ...next };
    else state.botActivity.push(next);
    if (state.botActivity.length > 60) state.botActivity.splice(0, state.botActivity.length - 60);
    renderBotActivity();
  }

  async function refreshBotSubagents() {
    if (!state.botSession?.runtimeId) return;
    try {
      const result = await gateway().call("subagent.list", { session_id: state.botSession.runtimeId }, 12000);
      state.botSubagents = Array.isArray(result?.subagents) ? result.subagents : [];
      renderBotSubagents();
      if (state.selectedSubagent) refreshSelectedSubagentTail();
    } catch (_) {}
  }

  function startBotPolling() {
    if (state.botPollTimer) window.clearInterval(state.botPollTimer);
    refreshBotSubagents();
    state.botPollTimer = window.setInterval(refreshBotSubagents, 2500);
  }

  function currentStreamingMessage() {
    const last = state.botMessages[state.botMessages.length - 1];
    return last?.role === "assistant" && last._streaming ? last : null;
  }

  function handleBotEvent(event) {
    if (!state.botSession || event?.session_id !== state.botSession.runtimeId) return;
    const payload = event.payload || {};
    if (event.seq) state.botSession.lastSeen = event.seq;
    if (event.type === "todo.updated") {
      state.botTodos = Array.isArray(payload.todos) ? payload.todos : [];
      renderBotTasks();
    }
    if (event.type === "tool.start" || event.type === "tool.complete") updateBotActivity(event);
    if (String(event.type || "").startsWith("subagent.")) {
      const id = payload.subagent_id;
      if (id) {
        const index = state.botSubagents.findIndex((agent) => agent.subagent_id === id);
        const next = { ...(index >= 0 ? state.botSubagents[index] : {}), ...payload };
        if (event.type === "subagent.complete") next.status = payload.status || "completed";
        else if (!next.status) next.status = "running";
        if (index >= 0) state.botSubagents[index] = next;
        else state.botSubagents.push(next);
        renderBotSubagents();
      }
      if (event.type === "subagent.start" || event.type === "subagent.complete") refreshBotSubagents();
    }
    if (event.type === "message.start") {
      if (!currentStreamingMessage()) state.botMessages.push({ role: "assistant", text: "", _streaming: true });
      state.botStreaming = true;
      setBotStatus("Responding…");
    } else if (event.type === "message.delta") {
      const message = currentStreamingMessage() || { role: "assistant", text: "", _streaming: true };
      if (!currentStreamingMessage()) state.botMessages.push(message);
      message.text += payload.text || "";
      state.botStreaming = true;
    } else if (event.type === "reasoning.delta") {
      const message = currentStreamingMessage() || { role: "assistant", text: "", _streaming: true };
      if (!currentStreamingMessage()) state.botMessages.push(message);
      message.reasoning = (message.reasoning || "") + (payload.text || "");
      state.botStreaming = true;
    } else if (event.type === "message.complete") {
      const message = currentStreamingMessage();
      if (message) {
        if (payload.text) message.text = payload.text;
        message._streaming = false;
      } else if (payload.text) state.botMessages.push({ role: "assistant", text: payload.text });
      state.botStreaming = false;
      setBotStatus(payload.status === "interrupted" ? "Stopped" : payload.status === "error" ? "Response failed" : "Ready");
      loadProfiles();
    } else if (event.type === "status.update") {
      setBotStatus(payload.text || payload.kind || "Working…");
    } else if (event.type === "session.info") {
      if (payload.model) text(document.getElementById("cockpit-model"), `${payload.provider || "provider"} / ${payload.model}`);
    } else if (event.type === "error") {
      state.botStreaming = false;
      state.botMessages.push({ role: "system", text: payload.message || payload.error || "Hermes reported an error." });
      setBotStatus("Error");
    }
    document.getElementById("cockpit-interrupt-bot")?.classList.toggle("hidden", !state.botStreaming);
    if (/^(message|reasoning|error)/.test(event.type || "")) renderBotMessages();
  }

  function ensureBotEventHandler() {
    if (!state.botEventUnsubscribe) state.botEventUnsubscribe = gateway().onEvent(handleBotEvent);
  }

  async function connect({ resume = null, fresh = false } = {}) {
    clearTimeout(state.reconnectTimer);
    state.intentionalClose = true;
    if (state.socket) state.socket.close(1000, "Cockpit reconnect");
    state.socket = null;
    state.intentionalClose = false;
    state.resume = resume || null;
    let resumeSanitizer = state.resume ? new ResumeSanitizer() : null;
    let resumeSanitizerTimer = null;
    const beginResumeReplay = () => {
      if (!resumeSanitizer) resumeSanitizer = new ResumeSanitizer();
      if (!resumeSanitizerTimer) {
        resumeSanitizerTimer = window.setTimeout(() => {
          resumeSanitizer?.endEraseSuppression();
          resumeSanitizerTimer = null;
        }, RESUME_SANITIZE_WINDOW_MS);
      }
    };
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
        if (state.resume) beginResumeReplay();
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
              beginResumeReplay();
              return;
            }
          } catch (_) {}
        }
        const rendered = resumeSanitizer ? resumeSanitizer.next(output) : output;
        if (rendered) state.terminal?.write(rendered, () => state.terminal?.scrollToBottom());
      };
      socket.onerror = () => setConnection("offline", "Hermes WebSocket error");
      socket.onclose = (event) => {
        if (resumeSanitizerTimer) window.clearTimeout(resumeSanitizerTimer);
        if (state.socket !== socket) return;
        const trailing = resumeSanitizer?.flush() || "";
        if (trailing) state.terminal?.write(trailing);
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
    if (!sendRaw(value)) {
      setConnection("offline", "Reconnect before sending");
      return false;
    }
    // Hermes' TUI needs a render beat between the pasted text and Enter.
    // Sending both in one WebSocket frame can clear the browser composer
    // without ever submitting the command to the Ink input control.
    window.setTimeout(() => sendRaw("\r"), 75);
    state.terminal?.focus();
    return true;
  }

  async function sendComposer() {
    if (!composer) return;
    const value = composer.value.trim();
    if (!value) return;
    if (state.mode === "bot") {
      composer.value = "";
      composer.dispatchEvent(new Event("change", { bubbles: true }));
      await submitBotPrompt(value);
    } else if (sendCommand(value)) {
      composer.value = "";
      composer.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function asDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Could not read the recording."));
      reader.readAsDataURL(blob);
    });
  }

  async function toggleVoiceInput() {
    const button = document.getElementById("voice-input");
    if (state.voiceRecorder?.state === "recording") {
      state.voiceRecorder.stop();
      if (button) button.innerHTML = '<span class="material-symbols-outlined">hourglass_top</span><span>Transcribing</span>';
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setBotStatus("This browser does not provide microphone recording.");
      return;
    }
    try {
      state.voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.voiceChunks = [];
      state.voiceRecorder = new MediaRecorder(state.voiceStream);
      state.voiceRecorder.addEventListener("dataavailable", event => { if (event.data?.size) state.voiceChunks.push(event.data); });
      state.voiceRecorder.addEventListener("stop", async () => {
        try {
          const type = state.voiceRecorder?.mimeType || state.voiceChunks[0]?.type || "audio/webm";
          const blob = new Blob(state.voiceChunks, { type });
          const dataUrl = await asDataUrl(blob);
          const query = state.profile ? `?profile=${encodeURIComponent(state.profile)}` : "";
          const result = await request(`/api/audio/transcribe${query}`, { method: "POST", body: JSON.stringify({ data_url: dataUrl, mime_type: type }) });
          if (result?.transcript && composer) composer.value = [composer.value.trim(), result.transcript].filter(Boolean).join(" ");
          setBotStatus(result?.transcript ? `Voice transcribed by ${result.provider || "Hermes"}` : "No speech detected");
        } catch (error) {
          setBotStatus(error.message || "Voice transcription failed");
        } finally {
          state.voiceStream?.getTracks().forEach(track => track.stop());
          state.voiceStream = null;
          state.voiceRecorder = null;
          state.voiceChunks = [];
          if (button) button.innerHTML = '<span class="material-symbols-outlined">mic</span><span>Voice</span>';
        }
      }, { once: true });
      state.voiceRecorder.start();
      if (button) button.innerHTML = '<span class="material-symbols-outlined">stop_circle</span><span>Stop</span>';
      setBotStatus("Recording voice…");
    } catch (error) {
      state.voiceStream?.getTracks().forEach(track => track.stop());
      state.voiceStream = null;
      state.voiceRecorder = null;
      setBotStatus(error.message || "Microphone access failed");
    }
  }

  async function attachSourceFiles(files) {
    const input = document.getElementById("source-file-input");
    const button = document.getElementById("attach-source");
    if (!state.botSession?.runtimeId) {
      setConnection(state.connected ? "connected" : "offline", "Open a Bot Chat before attaching files");
      if (input) input.value = "";
      return;
    }
    const selected = Array.from(files || []);
    if (!selected.length) return;
    if (button) button.disabled = true;
    const refs = [];
    try {
      for (const file of selected) {
        if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} exceeds the 12 MB browser attachment limit.`);
        const dataUrl = await asDataUrl(file);
        const result = await gateway().call("file.attach", {
          profile: state.botSession.profile,
          session_id: state.botSession.runtimeId,
          data_url: dataUrl,
          name: file.name
        }, 60000);
        if (result?.ref_text) refs.push(result.ref_text);
      }
      if (composer && refs.length) composer.value = [composer.value.trim(), ...refs].filter(Boolean).join(" ");
      setBotStatus(`${refs.length} file${refs.length === 1 ? "" : "s"} attached`);
    } catch (error) {
      setBotStatus(error.message || "File attachment failed");
    } finally {
      if (input) input.value = "";
      if (button) button.disabled = false;
    }
  }

  function newSession() {
    setWorkspaceMode("terminal");
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
    const selected = state.mode === "bot" ? String(globalThis.getSelection?.() || "") : state.terminal?.getSelection() || "";
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
          setWorkspaceMode("terminal");
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

  async function applySelectedModel() {
    const picker = document.getElementById("cockpit-model-picker");
    if (!picker?.value) return;
    if (state.mode === "bot" && state.botSession?.runtimeId) {
      const option = picker.selectedOptions?.[0];
      const provider = option?.dataset?.provider;
      const value = `${picker.value}${provider ? ` --provider ${provider}` : ""} --session`;
      const params = {
        profile: state.botSession.profile,
        session_id: state.botSession.runtimeId,
        key: "model",
        value
      };
      setBotStatus(`Switching to ${picker.value}…`);
      try {
        let result = await gateway().call("config.set", params, 30000);
        if (result?.confirm_required) {
          const accepted = globalThis.confirm(result.confirm_message || `Use ${picker.value} for this Bot Chat?`);
          if (!accepted) {
            setBotStatus("Model switch cancelled");
            return;
          }
          result = await gateway().call("config.set", { ...params, confirm_expensive_model: true }, 30000);
        }
        state.currentModel = result?.value || picker.value;
        text(document.getElementById("cockpit-model"), state.currentModel);
        setBotStatus(result?.deferred ? "Model will switch after the current response" : `Model set to ${state.currentModel}`);
      } catch (error) {
        setBotStatus(error.message || "Model switch failed");
      }
      return;
    }
    sendCommand(`/model ${picker.value}`);
  }

  function botMeta(profile) {
    const value = profile?.ui_meta?.["hermes-bots"];
    return value && typeof value === "object" ? value : {};
  }

  function botTitle(profile) {
    const meta = botMeta(profile);
    return meta.title || profile.bot_title || profile.display_name || profile.name || "Unnamed bot";
  }

  function canonicalSession(profile) {
    const session = profile?.canonical_session;
    if (!session?.id) return null;
    return { ...session, resumeId: session.resolved_id || session.id };
  }

  function botChatMatches(profile) {
    const canonical = canonicalSession(profile);
    if (!canonical) return false;
    if (state.mode === "bot" && state.botSession?.profile === profile.name) {
      return [canonical.id, canonical.resolved_id].filter(Boolean).includes(state.botSession.sessionKey) || state.botSession.canonicalId === canonical.id;
    }
    return Boolean(state.resume && [canonical.id, canonical.resolved_id].filter(Boolean).includes(state.resume));
  }

  async function resolveCanonicalBotChat(profile) {
    const name = profile.name || "default";
    const known = canonicalSession(profile);
    if (known) return known;
    const rpc = gateway();
    const lookup = await rpc.call("session.list", {
      profile: name,
      title: "Bot Chat",
      limit: 500,
      include_hidden: true
    });
    const existing = (lookup?.sessions || []).find((row) => row?.title === "Bot Chat" || row?.root_title === "Bot Chat");
    if (existing?.id) return { ...existing, resumeId: existing.resolved_id || existing.id };
    const created = await rpc.call("session.create", {
      profile: name,
      title: "Bot Chat",
      hidden: true,
      follow_profile_config: true
    });
    const runtimeId = created?.session_id;
    const storedId = created?.stored_session_id;
    if (!runtimeId || !storedId) throw new Error(`Hermes did not create ${botTitle(profile)}'s Bot Chat.`);
    await rpc.call("session.title", { profile: name, session_id: runtimeId, title: "Bot Chat" });
    return { id: storedId, resolved_id: storedId, resumeId: storedId, title: "Bot Chat", message_count: 0 };
  }

  async function submitBotPrompt(value) {
    if (!state.botSession?.runtimeId || !state.botProfile) {
      setBotStatus("Open a bot before sending a message.");
      return false;
    }
    const message = String(value || "").trim();
    if (!message) return false;
    state.botMessages.push({ role: "user", text: message });
    state.botStreaming = true;
    setBotStatus("Sending…");
    document.getElementById("cockpit-interrupt-bot")?.classList.remove("hidden");
    renderBotMessages();
    try {
      const result = await gateway().call("prompt.submit", {
        profile: state.botSession.profile,
        session_id: state.botSession.runtimeId,
        text: message
      }, 30000);
      setBotStatus(result?.status === "queued" ? "Queued" : result?.status === "steered" ? "Steered current response" : "Responding…");
      return true;
    } catch (error) {
      state.botStreaming = false;
      state.botMessages.push({ role: "system", text: error.message || "Hermes did not accept the prompt." });
      setBotStatus("Send failed");
      document.getElementById("cockpit-interrupt-bot")?.classList.add("hidden");
      renderBotMessages();
      return false;
    }
  }

  async function interruptBot() {
    if (!state.botSession?.runtimeId) return;
    setBotStatus("Stopping…");
    try {
      await gateway().call("session.interrupt", {
        profile: state.botSession.profile,
        session_id: state.botSession.runtimeId
      });
    } catch (error) {
      setBotStatus(error.message || "Could not stop the response.");
    }
  }

  async function openBotChat(profile) {
    const roster = document.getElementById("cockpit-bots");
    const name = profile?.name || "default";
    state.profile = name === "default" ? "" : name;
    const picker = document.getElementById("cockpit-profile-picker");
    if (picker) picker.value = name;
    text(document.getElementById("cockpit-profile"), name);
    if (roster) roster.dataset.loading = "true";
    setConnection("connecting", `Opening ${botTitle(profile)}…`);
    state.botProfile = profile;
    state.botSession = null;
    state.botMessages = [];
    state.botTodos = [];
    state.botSubagents = [];
    state.botActivity = [];
    text(document.getElementById("cockpit-bot-chat-title"), botTitle(profile));
    text(document.getElementById("cockpit-bot-chat-profile"), name === "default" ? "default profile · Bot Chat" : `@${name} · Bot Chat`);
    setBotStatus("Opening canonical Bot Chat…");
    setWorkspaceMode("bot");
    renderBotMessages();
    renderBotTasks();
    renderBotSubagents();
    renderBotActivity();
    try {
      const chat = await resolveCanonicalBotChat(profile);
      const rpc = gateway();
      ensureBotEventHandler();
      const resumed = await rpc.call("session.resume", {
        profile: name,
        session_id: chat.resumeId,
        source: "desktop",
        inline_images: false
      }, 60000);
      const runtimeId = resumed?.session_id;
      if (!runtimeId) throw new Error(`Hermes did not resume ${botTitle(profile)}'s Bot Chat.`);
      state.botSession = {
        profile: name,
        runtimeId,
        sessionKey: resumed.session_key || resumed.resumed || chat.resumeId,
        canonicalId: chat.id,
        lastSeen: 0
      };
      state.botStreaming = resumed.status === "streaming" || Boolean(resumed.inflight);
      state.botTodos = Array.isArray(resumed?.todo_state?.todos) ? resumed.todo_state.todos : [];
      state.botSubagents = [];
      state.selectedSubagent = null;
      state.subagentTail = "";
      document.getElementById("cockpit-subagent-detail")?.classList.add("hidden");
      state.botActivity = [];
      setBotStatus("Loading conversation and live activity…");
      setConnection("connected", `${botTitle(profile)} · Bot Chat`);
      renderBotTasks();
      renderBotSubagents();
      renderBotActivity();
      startBotPolling();
      let messages = Array.isArray(resumed.messages) ? resumed.messages : [];
      state.botMessages = messages.map((message) => ({ ...message, text: messageText(message) }));
      renderBotMessages();
      try {
        const history = await rpc.call("session.history", { profile: name, session_id: runtimeId }, 60000);
        if (Array.isArray(history?.messages)) messages = history.messages;
      } catch (_) {}
      state.botMessages = messages.map((message) => ({ ...message, text: messageText(message) }));
      setBotStatus(state.botStreaming ? "Responding…" : `${state.botMessages.length} messages`);
      renderBotMessages();
      Promise.allSettled([loadModels(), loadSessions(), loadProfiles()]);
    } catch (error) {
      if (error instanceof AuthRequiredError) showAuth();
      else {
        setConnection("offline", `Could not open ${botTitle(profile)}`);
        showTerminalMessage(error.message || "Hermes Bot Chat could not be opened.", "error");
      }
    } finally {
      if (roster) delete roster.dataset.loading;
    }
  }

  async function loadProfiles() {
    const picker = document.getElementById("cockpit-profile-picker");
    const roster = document.getElementById("cockpit-bots");
    if (!picker) return;
    try {
      const payload = await gateway().call("profiles.list", { include_sessions: true });
      const profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
      state.botProfiles = profiles;
      picker.replaceChildren();
      if (roster) roster.replaceChildren();
      for (const profile of profiles) {
        const id = profile?.name;
        if (!id) continue;
        const title = botTitle(profile);
        const canonical = canonicalSession(profile);
        const option = document.createElement("option");
        option.value = id;
        option.textContent = title;
        option.selected = (state.profile || "default") === id;
        picker.append(option);
        if (roster) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "cockpit-bot";
          button.dataset.active = botChatMatches(profile) ? "true" : "false";
          button.title = canonical ? `Resume ${title}'s Bot Chat` : `Create ${title}'s Bot Chat`;
          const identity = document.createElement("span");
          identity.className = "cockpit-bot-identity";
          const dot = document.createElement("i");
          dot.dataset.running = profile.worker_session || canonical ? "true" : "false";
          const name = document.createElement("strong");
          name.textContent = title;
          const profileName = document.createElement("small");
          profileName.textContent = id === "default" ? "default profile" : `@${id}`;
          identity.append(dot, name, profileName);
          const detail = document.createElement("span");
          detail.className = "cockpit-bot-detail";
          detail.textContent = canonical
            ? `${canonical.message_count || 0} messages${canonical.preview ? ` · ${canonical.preview}` : ""}`
            : (profile.model || profile.description || "No Bot Chat yet");
          button.append(identity, detail);
          button.addEventListener("click", () => openBotChat(profile));
          roster.append(button);
        }
      }
      if (!picker.childElementCount) picker.innerHTML = '<option value="">No bots returned</option>';
      if (roster && !roster.childElementCount) roster.innerHTML = '<p class="cockpit-muted">Hermes returned no Bot Mode profiles.</p>';
    } catch (error) {
      if (error instanceof AuthRequiredError) showAuth();
      if (roster) roster.innerHTML = `<p class="cockpit-muted">Real Bot Mode roster unavailable: ${String(error.message || error)}</p>`;
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
    document.getElementById("voice-input")?.addEventListener("click", toggleVoiceInput);
    document.getElementById("attach-source")?.addEventListener("click", () => document.getElementById("source-file-input")?.click());
    document.getElementById("source-file-input")?.addEventListener("change", event => attachSourceFiles(event.target.files));
  }

  async function start() {
    if (!renderShell()) return;
    renderLiveHeader();
    document.getElementById("slash-menu-overlay")?.classList.add("hidden");
    installComposerBridge();
    if (!initTerminal()) return;
    await Promise.allSettled([loadStatus(), loadSessions(), loadModels(), loadProfiles()]);
    state.botRefreshTimer = window.setInterval(loadProfiles, 5000);
    window.addEventListener("beforeunload", () => {
      if (state.botRefreshTimer) window.clearInterval(state.botRefreshTimer);
      if (state.botPollTimer) window.clearInterval(state.botPollTimer);
      state.botEventUnsubscribe?.();
      state.gateway?.close();
    }, { once: true });
    connect();
  }

  start().catch((error) => {
    setConnection("offline", error.message);
    showTerminalMessage(error.message, "error");
  });
})();
