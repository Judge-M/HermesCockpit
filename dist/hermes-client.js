(function () {
  "use strict";

  const root = document.body;
  if (root?.dataset.hermesClient !== "true") return;

  const API_BASE = root.dataset.hermesBase || "/hermes";
  const CONTROL_PLANE = "/api/plugins/judge-m-control-plane";
  const pageMode = root.dataset.clientMode === "bot" ? "bot" : "chat";
  const feed = document.getElementById("execution-feed");
  const composer = document.getElementById("composer-input");
  const sidebar = document.getElementById("live-control-sidebar");
  const sessionSidebar = document.getElementById("live-session-sidebar");
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
    mode: "chat",
    sessions: [],
    sessionSearch: "",
    currentSessionMeta: null,
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
    routingDecisions: [],
    routingTimer: null,
    routingInFlight: false,
    botPollTimer: null,
    browserPreviewTimer: null,
    browserPreviewInFlight: false,
    browserPreviewSession: null,
    browserProfileOriginal: false,
    browserProfileName: "",
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
    if (response.status === 204 || response.headers.get("content-length") === "0") return null;
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
      headerStatus.textContent = status === "connected" ? "Connected" : status === "connecting" ? "Connecting…" : "Offline";
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
    if (!feed || !sidebar || !sessionSidebar) return false;
    feed.replaceChildren();
    feed.className = "cockpit-terminal-feed";

    const frame = document.createElement("section");
    frame.className = "cockpit-terminal-frame";
    frame.setAttribute("aria-label", "Hermes conversation workspace");
    frame.innerHTML = `
      <div class="cockpit-terminal-toolbar">
        <div class="cockpit-toolbar-start">
          <button type="button" class="cockpit-mobile-toggle" id="cockpit-open-sessions" aria-label="Open chats"><span class="material-symbols-outlined">menu</span></button>
          <div class="cockpit-connection" id="cockpit-connection" data-state="connecting">
          <span class="cockpit-status-dot"></span>
          <span id="cockpit-connection-label">Connecting…</span>
          </div>
        </div>
        <div class="cockpit-terminal-actions">
          <button type="button" id="cockpit-copy" title="Copy selected text">Copy</button>
          <button type="button" id="cockpit-reconnect" title="Reconnect to Hermes">Reconnect</button>
          <button type="button" id="cockpit-terminal-mode" title="Open Hermes terminal">Terminal</button>
          <button type="button" class="cockpit-mobile-toggle" id="cockpit-open-inspector" aria-label="Open session details"><span class="material-symbols-outlined">tune</span></button>
          <button type="button" id="cockpit-interrupt-bot" class="hidden" title="Stop the active Bot Mode response">Stop</button>
        </div>
      </div>
      <div id="hermes-terminal" class="cockpit-terminal hidden" tabindex="0"></div>
      <div id="cockpit-bot-chat" class="cockpit-native-chat" aria-label="Hermes conversation">
        <div class="cockpit-native-chat-heading">
          <div><strong id="cockpit-bot-chat-title">Hermes</strong><span id="cockpit-bot-chat-profile">Choose a chat or start a new one</span></div>
          <div class="cockpit-chat-heading-actions"><span id="cockpit-bot-chat-status">Ready</span><button type="button" id="cockpit-session-menu" title="Session actions">•••</button></div>
        </div>
        <div id="cockpit-bot-transcript" class="cockpit-native-transcript" role="log" aria-live="polite"></div>
      </div>
      <div id="cockpit-auth" class="cockpit-auth hidden">
        <strong>Hermes sign-in required</strong>
        <span>Your credentials stay with Hermes and are never stored by Cockpit.</span>
        <a id="cockpit-sign-in" href="#">Sign in to Hermes</a>
      </div>`;
    feed.append(frame);

    sessionSidebar.replaceChildren();
    sessionSidebar.className = "live-session-side cockpit-session-panel";
    sessionSidebar.innerHTML = `
      <div class="cockpit-session-panel-head"><strong>Chats</strong><button type="button" id="cockpit-close-sessions" aria-label="Close chats">×</button></div>
      <button type="button" class="cockpit-new-chat" id="cockpit-new-session"><span class="material-symbols-outlined">add_comment</span><span>New chat</span></button>
      <label class="cockpit-session-search"><span class="material-symbols-outlined">search</span><input id="cockpit-session-search" type="search" placeholder="Search conversations" autocomplete="off"></label>
      <div class="cockpit-session-scroll">
        <section class="cockpit-session-group">
          <div class="cockpit-session-group-title"><span>Recent</span><button type="button" id="cockpit-refresh-sessions" title="Refresh chats">↻</button></div>
          <div id="cockpit-sessions" class="cockpit-session-list"><p class="cockpit-muted">Loading chats…</p></div>
        </section>
        <section class="cockpit-session-group cockpit-bot-group">
          <div class="cockpit-session-group-title"><span>Bot Mode</span><button type="button" id="cockpit-refresh-bots" title="Refresh bots">↻</button></div>
          <label class="cockpit-field" for="cockpit-profile-picker">Bot profile</label>
          <select id="cockpit-profile-picker"><option value="">Default profile</option></select>
          <div id="cockpit-bots" class="cockpit-bot-list"><p class="cockpit-muted">Loading bots…</p></div>
        </section>
      </div>`;
    if (pageMode === "bot") {
      sessionSidebar.querySelector(".cockpit-session-group:not(.cockpit-bot-group)")?.remove();
      const newLabel = sessionSidebar.querySelector("#cockpit-new-session span:last-child");
      if (newLabel) newLabel.textContent = "Open selected Bot Chat";
    } else {
      sessionSidebar.querySelector(".cockpit-bot-group")?.remove();
    }

    sidebar.replaceChildren();
    sidebar.className = "live-side cockpit-control-panel";
    sidebar.innerHTML = `
      <div class="cockpit-inspector-head"><strong>Session details</strong><button type="button" id="cockpit-close-inspector" aria-label="Close session details">×</button></div>
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
        <p class="cockpit-help">Switch this conversation without exposing provider credentials.</p>
      </section>
      <section class="cockpit-panel-section cockpit-live-state">
        <div class="cockpit-inspector-tabs" role="tablist"><button type="button" data-inspector-tab="tasks" data-active="true">Tasks <span id="cockpit-task-count">0</span></button><button type="button" data-inspector-tab="agents">Subagents <span id="cockpit-subagent-count">0</span></button><button type="button" data-inspector-tab="routing">Routing <span id="cockpit-routing-count">0</span></button><button type="button" data-inspector-tab="browser">Browser <span id="cockpit-browser-state">idle</span></button><button type="button" data-inspector-tab="activity">Activity <span id="cockpit-activity-count">0</span></button></div>
        <div class="cockpit-inspector-pane" data-inspector-pane="tasks"><div id="cockpit-task-list" class="cockpit-task-list"><p>No task list in this session.</p></div></div>
        <div class="cockpit-inspector-pane hidden" data-inspector-pane="agents"><div id="cockpit-subagent-list" class="cockpit-subagent-list"><p>No active subagents</p></div><div id="cockpit-subagent-detail" class="cockpit-subagent-detail hidden"><div class="cockpit-subagent-detail-head"><strong id="cockpit-subagent-detail-title">Subagent</strong><button id="cockpit-subagent-close" type="button" aria-label="Close subagent detail">×</button></div><pre id="cockpit-subagent-tail">Waiting for transcript…</pre><textarea id="cockpit-subagent-steer-text" rows="2" placeholder="Send guidance to this subagent"></textarea><div><button id="cockpit-subagent-steer" type="button">Send guidance</button><button id="cockpit-subagent-stop" type="button">Stop subagent</button></div></div></div>
        <div class="cockpit-inspector-pane hidden" data-inspector-pane="routing"><div id="cockpit-routing-metrics" class="cockpit-routing-metrics">No routing metrics yet.</div><div id="cockpit-routing-list" class="cockpit-routing-list"><p>No semantic-routing decisions in this profile yet.</p></div></div>
        <div class="cockpit-inspector-pane hidden" data-inspector-pane="browser">
          <div class="cockpit-browser-preview">
            <div class="cockpit-browser-bar"><div><strong id="cockpit-browser-title">Hermes Browser</strong><span id="cockpit-browser-url">Waiting for browser activity</span></div><button type="button" id="cockpit-browser-refresh" title="Refresh browser preview"><span class="material-symbols-outlined">refresh</span></button></div>
            <div class="cockpit-browser-stage"><img id="cockpit-browser-frame" alt="Live view of the browser Hermes is controlling" hidden><div id="cockpit-browser-empty" class="cockpit-browser-empty"><span class="material-symbols-outlined">language</span><strong>Isolated Chromium is ready</strong><p>When Hermes navigates or interacts with a page, the live browser appears here automatically.</p></div></div>
            <div class="cockpit-browser-privacy"><div><strong id="cockpit-browser-mode">Isolated browser</strong><span id="cockpit-browser-mode-help">Uses Hermes' private Chromium profile, separate from your personal browser.</span></div><label class="cockpit-browser-profile-toggle"><input id="cockpit-real-profile" type="checkbox"><span>Use a copied personal browser profile</span></label><p>Optional and sensitive: a copied profile may contain active logins, cookies, browser storage, history, and extensions. Hermes never points automation at the live profile.</p><button type="button" id="cockpit-save-browser-profile" disabled>Apply browser privacy setting</button></div>
          </div>
        </div>
        <div class="cockpit-inspector-pane hidden" data-inspector-pane="activity"><div id="cockpit-activity-list" class="cockpit-activity-list"><p>No tool activity in this session.</p></div></div>
      </section>
      <section class="cockpit-panel-section"><button type="button" class="cockpit-secondary-action" id="cockpit-export-session">Export conversation</button></section>`;

    document.getElementById("cockpit-copy")?.addEventListener("click", copySelection);
    document.getElementById("cockpit-reconnect")?.addEventListener("click", reopenCurrentSession);
    document.getElementById("cockpit-new-session")?.addEventListener("click", () => {
      if (pageMode === "bot") {
        const name = document.getElementById("cockpit-profile-picker")?.value || "default";
        const profile = state.botProfiles.find((entry) => entry.name === name) || state.botProfiles[0];
        if (profile) openBotChat(profile);
        return;
      }
      newSession();
    });
    document.getElementById("cockpit-terminal-mode")?.addEventListener("click", () => setWorkspaceMode(state.mode === "terminal" ? (state.botProfile ? "bot" : "chat") : "terminal"));
    document.getElementById("cockpit-interrupt-bot")?.addEventListener("click", interruptBot);
    document.getElementById("cockpit-refresh-sessions")?.addEventListener("click", loadSessions);
    document.getElementById("cockpit-refresh-bots")?.addEventListener("click", loadProfiles);
    document.getElementById("cockpit-apply-model")?.addEventListener("click", applySelectedModel);
    document.getElementById("cockpit-export-session")?.addEventListener("click", exportCurrentSession);
    document.getElementById("cockpit-browser-refresh")?.addEventListener("click", () => refreshBrowserPreview(true));
    document.getElementById("cockpit-real-profile")?.addEventListener("change", updateBrowserProfileSaveState);
    document.getElementById("cockpit-save-browser-profile")?.addEventListener("click", saveBrowserProfileSetting);
    document.getElementById("cockpit-session-menu")?.addEventListener("click", showSessionActions);
    document.getElementById("cockpit-session-search")?.addEventListener("input", debounceSessionSearch);
    document.getElementById("cockpit-open-sessions")?.addEventListener("click", () => root.dataset.sessionsOpen = "true");
    document.getElementById("cockpit-close-sessions")?.addEventListener("click", closeMobilePanels);
    document.getElementById("cockpit-open-inspector")?.addEventListener("click", () => root.dataset.inspectorOpen = "true");
    document.getElementById("cockpit-close-inspector")?.addEventListener("click", closeMobilePanels);
    document.getElementById("cockpit-subagent-close")?.addEventListener("click", closeSubagentDetail);
    document.getElementById("cockpit-subagent-steer")?.addEventListener("click", steerSelectedSubagent);
    document.getElementById("cockpit-subagent-stop")?.addEventListener("click", interruptSelectedSubagent);
    document.getElementById("cockpit-profile-picker")?.addEventListener("change", (event) => {
      const name = event.target.value || "default";
      const profile = state.botProfiles.find((entry) => entry.name === name);
      if (profile) openBotChat(profile);
    });
    if (pageMode === "bot") document.getElementById("cockpit-terminal-mode")?.remove();
    document.querySelectorAll("[data-inspector-tab]").forEach((button) => button.addEventListener("click", () => selectInspectorTab(button.dataset.inspectorTab)));
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
      <a class="cockpit-admin-link" href="runtime-config-settings.html" aria-label="Open Manage workspace">Manage</a>`;
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

  function closeMobilePanels() {
    delete root.dataset.sessionsOpen;
    delete root.dataset.inspectorOpen;
  }

  function selectInspectorTab(name) {
    document.querySelectorAll("[data-inspector-tab]").forEach((button) => {
      button.dataset.active = button.dataset.inspectorTab === name ? "true" : "false";
    });
    document.querySelectorAll("[data-inspector-pane]").forEach((pane) => {
      pane.classList.toggle("hidden", pane.dataset.inspectorPane !== name);
    });
    if (name === "browser") startBrowserPreview();
    else stopBrowserPreview();
    if (name === "routing") startRoutingPolling();
    else stopRoutingPolling();
  }

  function stopRoutingPolling() {
    if (state.routingTimer) window.clearInterval(state.routingTimer);
    state.routingTimer = null;
  }

  function renderRoutingDecisions() {
    const host = document.getElementById("cockpit-routing-list");
    const metricsHost = document.getElementById("cockpit-routing-metrics");
    text(document.getElementById("cockpit-routing-count"), state.routingDecisions.length);
    if (metricsHost && state.routingMetrics) {
      const metrics = state.routingMetrics;
      metricsHost.textContent = `${metrics.decisions || 0} decisions · ${metrics.fallbacks || 0} fallbacks · ${metrics.cache_hits || 0} cache hits · p95 ${metrics.latency_ms?.p95 ?? "—"} ms`;
    }
    if (!host) return;
    host.replaceChildren();
    if (!state.routingDecisions.length) {
      const empty = document.createElement("p");
      empty.textContent = "No semantic-routing decisions in this profile yet.";
      host.append(empty);
      return;
    }
    for (const decision of state.routingDecisions.slice(0, 50)) {
      const row = document.createElement("article");
      row.className = "cockpit-routing-row";
      row.dataset.fallback = decision.fallback ? "true" : "false";
      const heading = document.createElement("div");
      const title = document.createElement("strong");
      const categoryLabels = { tools: "Authorized tools", memory: "Memory retrieval", escalation: "Safe escalation", verification: "Answer verification" };
      title.textContent = categoryLabels[decision.category] || `${decision.slot || "model"}${decision.task ? ` · ${decision.task}` : ""}`;
      const badge = document.createElement("span");
      badge.textContent = decision.fallback ? "fallback" : decision.routed ? "routed" : "native";
      heading.append(title, badge);
      const selected = decision.selected ? `${decision.selected.provider} / ${decision.selected.model}` : Array.isArray(decision.selected_tools) ? decision.selected_tools.join(", ") : Array.isArray(decision.selected_memory) ? (decision.selected_memory.join(", ") || "Memory skipped") : Array.isArray(decision.verdicts) ? `${decision.verdicts.length} verifier result${decision.verdicts.length === 1 ? "" : "s"}` : "Native route retained";
      const detail = document.createElement("p");
      detail.textContent = selected;
      const meta = document.createElement("small");
      const score = typeof decision.reported_score === "number" ? ` · router score ${Math.round(decision.reported_score * 100)}%` : "";
      const candidateInfo = Array.isArray(decision.eligible) ? ` · ${decision.eligible.length} eligible${Array.isArray(decision.excluded) && decision.excluded.length ? ` / ${decision.excluded.length} excluded` : ""}` : "";
      const correlation = decision.correlation_id ? ` · id ${String(decision.correlation_id).slice(0, 8)}` : "";
      const shadow = decision.shadow ? ` · shadow ${decision.shadow.disagreed ? "disagreed" : decision.shadow.error ? "failed" : "agreed"}` : "";
      meta.textContent = `${decision.policy || "balanced"}${decision.adapter ? ` · ${decision.adapter}` : ""}${decision.latency_ms != null ? ` · ${decision.latency_ms} ms` : ""}${decision.cache_hit ? " · cache hit" : ""}${score}${candidateInfo}${shadow}${correlation}${decision.reason ? ` · ${decision.reason}` : ""}`;
      row.append(heading, detail, meta);
      host.append(row);
    }
  }

  async function refreshRoutingDecisions() {
    if (state.routingInFlight) return;
    state.routingInFlight = true;
    try {
      const profile = state.botSession?.profile || state.profile || "default";
      const session = state.runtimeId || state.botSession?.runtime_id || state.botSession?.session_id || "";
      const query = `profile=${encodeURIComponent(profile)}${session ? `&session_id=${encodeURIComponent(session)}` : ""}&limit=50`;
      const [payload, metrics] = await Promise.all([
        request(`${CONTROL_PLANE}/semantic-routing/decisions?${query}`),
        request(`${CONTROL_PLANE}/semantic-routing/metrics?profile=${encodeURIComponent(profile)}`),
      ]);
      state.routingDecisions = Array.isArray(payload?.decisions) ? payload.decisions : [];
      state.routingMetrics = metrics?.metrics || null;
      renderRoutingDecisions();
    } catch (error) {
      const host = document.getElementById("cockpit-routing-list");
      if (host) host.textContent = `Routing inspector unavailable: ${error.message}`;
    } finally {
      state.routingInFlight = false;
    }
  }

  function startRoutingPolling() {
    stopRoutingPolling();
    refreshRoutingDecisions();
    state.routingTimer = window.setInterval(refreshRoutingDecisions, 2500);
  }

  function stopBrowserPreview() {
    if (state.browserPreviewTimer) window.clearInterval(state.browserPreviewTimer);
    state.browserPreviewTimer = null;
  }

  function currentBrowserProfileName() {
    return state.botProfile?.name || state.profile || "default";
  }

  function updateBrowserProfileSaveState() {
    const input = document.getElementById("cockpit-real-profile");
    const button = document.getElementById("cockpit-save-browser-profile");
    if (button && input) button.disabled = input.checked === state.browserProfileOriginal;
  }

  async function loadBrowserProfileSetting() {
    const profile = currentBrowserProfileName();
    const input = document.getElementById("cockpit-real-profile");
    if (!input) return;
    try {
      const config = await request(`/api/config?profile=${encodeURIComponent(profile)}&include_defaults=true`);
      const enabled = config?.browser?.use_real_profile === true;
      state.browserProfileName = profile;
      state.browserProfileOriginal = enabled;
      input.disabled = false;
      input.checked = enabled;
      text(document.getElementById("cockpit-browser-mode"), enabled ? "Copied personal profile" : "Isolated browser");
      text(document.getElementById("cockpit-browser-mode-help"), enabled ? "Hermes uses an isolated copy of your browser data for signed-in sites." : "Uses Hermes' private Chromium profile, separate from your personal browser.");
      updateBrowserProfileSaveState();
    } catch (_) {
      input.disabled = true;
      text(document.getElementById("cockpit-browser-mode-help"), "Browser privacy settings are unavailable for this profile.");
    }
  }

  async function saveBrowserProfileSetting() {
    const input = document.getElementById("cockpit-real-profile");
    const button = document.getElementById("cockpit-save-browser-profile");
    if (!input || !button) return;
    const next = input.checked;
    if (next && !state.browserProfileOriginal) {
      const accepted = globalThis.confirm("Use a copied personal browser profile for this Hermes profile? The copy can include active logins, cookies, history, storage, and extensions. Hermes will not automate the live profile.");
      if (!accepted) { input.checked = state.browserProfileOriginal; updateBrowserProfileSaveState(); return; }
    }
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const profile = currentBrowserProfileName();
      await request(`/api/config?profile=${encodeURIComponent(profile)}`, {method: "PUT", body: JSON.stringify({profile, config: {browser: {use_real_profile: next}}})});
      state.browserProfileOriginal = next;
      state.browserProfileName = profile;
      text(document.getElementById("cockpit-browser-mode"), next ? "Copied personal profile" : "Isolated browser");
      text(document.getElementById("cockpit-browser-mode-help"), next ? "Hermes uses an isolated copy of your browser data for signed-in sites." : "Uses Hermes' private Chromium profile, separate from your personal browser.");
      setBotStatus("Browser privacy setting saved");
    } catch (error) {
      input.checked = state.browserProfileOriginal;
      setBotStatus(error.message || "Could not save browser privacy setting");
    } finally {
      button.textContent = "Apply browser privacy setting";
      updateBrowserProfileSaveState();
    }
  }

  function renderBrowserPreview(payload) {
    const session = payload?.session || null;
    state.browserPreviewSession = session;
    const frame = document.getElementById("cockpit-browser-frame");
    const empty = document.getElementById("cockpit-browser-empty");
    const badge = document.getElementById("cockpit-browser-state");
    if (!session) {
      if (frame) { frame.hidden = true; frame.removeAttribute("src"); }
      if (empty) { empty.hidden = false; empty.querySelector("strong").textContent = "Isolated Chromium is ready"; empty.querySelector("p").textContent = "When Hermes navigates or interacts with a page, the live browser appears here automatically."; }
      text(badge, "idle");
      text(document.getElementById("cockpit-browser-title"), "Hermes Browser");
      text(document.getElementById("cockpit-browser-url"), "Waiting for browser activity");
      return;
    }
    text(badge, session.preview_ready ? "live" : "start");
    text(document.getElementById("cockpit-browser-title"), session.real_profile ? "Hermes Browser · copied profile" : "Hermes Browser · isolated");
    text(document.getElementById("cockpit-browser-url"), session.url || "Browser session active");
    if (!session.preview_ready || !frame) {
      frame?.setAttribute("hidden", "");
      if (empty) { empty.hidden = false; empty.querySelector("strong").textContent = "Browser is starting"; empty.querySelector("p").textContent = "Hermes has an active browser session; the first live frame will appear shortly."; }
      return;
    }
    const next = `${apiUrl(`${CONTROL_PLANE}/browser-preview/${encodeURIComponent(session.id)}/frame`)}?t=${Date.now()}`;
    frame.onload = () => { frame.hidden = false; if (empty) empty.hidden = true; };
    frame.onerror = () => { frame.hidden = true; if (empty) empty.hidden = false; };
    frame.src = next;
  }

  async function refreshBrowserPreview(force = false) {
    if (state.browserPreviewInFlight && !force) return;
    state.browserPreviewInFlight = true;
    try {
      const runtime = state.botSession?.runtimeId || "";
      const query = runtime ? `?session_id=${encodeURIComponent(runtime)}` : "";
      const payload = await request(`${CONTROL_PLANE}/browser-preview${query}`);
      renderBrowserPreview(payload);
    } catch (error) {
      text(document.getElementById("cockpit-browser-state"), "offline");
      text(document.getElementById("cockpit-browser-url"), error.message || "Browser preview unavailable");
    } finally {
      state.browserPreviewInFlight = false;
    }
  }

  function startBrowserPreview() {
    stopBrowserPreview();
    loadBrowserProfileSetting();
    refreshBrowserPreview(true);
    state.browserPreviewTimer = window.setInterval(refreshBrowserPreview, 1200);
  }

  function setWorkspaceMode(mode) {
    state.mode = ["chat", "bot", "terminal"].includes(mode) ? mode : "chat";
    const terminal = document.getElementById("hermes-terminal");
    const botChat = document.getElementById("cockpit-bot-chat");
    const terminalButton = document.getElementById("cockpit-terminal-mode");
    const interruptButton = document.getElementById("cockpit-interrupt-bot");
    terminal?.classList.toggle("hidden", state.mode !== "terminal");
    botChat?.classList.toggle("hidden", state.mode === "terminal");
    if (terminalButton) terminalButton.textContent = state.mode === "terminal" ? "Chat" : "Terminal";
    interruptButton?.classList.toggle("hidden", state.mode === "terminal" || !state.botStreaming);
    if (state.mode === "terminal") {
      if (state.botPollTimer) window.clearInterval(state.botPollTimer);
      state.botPollTimer = null;
      setConnection(state.socket?.readyState === WebSocket.OPEN ? "connected" : "connecting", state.socket?.readyState === WebSocket.OPEN ? "Hermes connected" : "Reconnecting terminal…");
      if (state.socket?.readyState !== WebSocket.OPEN) connect({ resume: state.resume });
      window.setTimeout(() => resizeTerminal(), 0);
    } else {
      clearTimeout(state.reconnectTimer);
      setConnection(state.botSession?.runtimeId ? "connected" : "connecting", state.botSession?.runtimeId ? "Hermes connected" : "Choose or create a chat");
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

  function toolNames(message) {
    const names = [];
    if (message?.tool_name) names.push(message.tool_name);
    for (const call of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
      const name = call?.function?.name || call?.name || call?.tool_name;
      if (name) names.push(name);
    }
    return [...new Set(names.map(String))];
  }

  function conversationMessageCount(messages) {
    return messages.filter((message) => {
      const role = String(message?.role || "assistant").toLowerCase();
      const content = messageText(message).trim();
      if (!content || role === "tool" || message?.tool_name || message?.display_kind === "tool") return false;
      return !(role === "user" && /^\[(?:IMPORTANT:|ASYNC DELEGATION|Your active task list|OUT-OF-BAND)/i.test(content));
    }).length;
  }

  function appendToolCard(fragment, message) {
    const bodyText = messageText(message).trim();
    const names = toolNames(message);
    if (!bodyText && !names.length) return;
    const details = document.createElement("details");
    details.className = "cockpit-tool-card";
    const summary = document.createElement("summary");
    const status = message.effect_disposition === "error" || message.finish_reason === "error" ? "Failed" : "Tool";
    summary.textContent = `${status} · ${names.join(", ") || message.display_kind || "Hermes action"}`;
    details.append(summary);
    if (bodyText) {
      const content = document.createElement("pre");
      content.textContent = bodyText;
      details.append(content);
    }
    fragment.append(details);
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
      empty.innerHTML = '<span class="material-symbols-outlined">forum</span><strong>Start a conversation</strong><p>Choose a model, attach context, or type a message below. Hermes tasks, tools, and subagents will appear in the inspector.</p>';
      transcript.append(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    let backgroundActionCount = 0;
    const backgroundActionNames = new Map();
    const countBackgroundAction = (name) => {
      backgroundActionCount += 1;
      const label = name || "Hermes runtime event";
      backgroundActionNames.set(label, (backgroundActionNames.get(label) || 0) + 1);
    };
    for (const message of state.botMessages) {
      const role = String(message.role || "assistant").toLowerCase();
      const contentText = messageText(message).trim();
      const reasoningText = message.reasoning || message.reasoning_content;
      const isTool = role === "tool" || Boolean(message.tool_name) || message.display_kind === "tool";
      if (isTool || (!contentText && toolNames(message).length)) {
        const names = toolNames(message);
        countBackgroundAction(names.join(", ") || message.display_kind || "Hermes tool");
        continue;
      }
      const isRuntimeEnvelope = role === "user" && /^\[(?:IMPORTANT:|ASYNC DELEGATION|Your active task list|OUT-OF-BAND)/i.test(contentText);
      if (isRuntimeEnvelope) {
        countBackgroundAction("Hermes runtime event");
        continue;
      }
      if (!contentText && reasoningText && !message._streaming) continue;
      if (!contentText && !reasoningText && !message._streaming) continue;
      const article = document.createElement("article");
      article.className = "cockpit-native-message";
      article.dataset.role = role;
      const label = document.createElement("div");
      label.className = "cockpit-native-message-role";
      label.textContent = role === "user" ? "You" : role === "assistant" ? (state.botProfile ? botTitle(state.botProfile) : "Hermes") : role;
      const content = document.createElement("div");
      content.className = "cockpit-native-message-content";
      content.textContent = contentText || (message._streaming ? "Thinking…" : "");
      article.append(label, content);
      if (reasoningText) {
        const reasoning = document.createElement("details");
        reasoning.className = "cockpit-native-reasoning";
        const summary = document.createElement("summary");
        summary.textContent = message._streaming ? "Thinking…" : "Reasoning details";
        const body = document.createElement("div");
        body.textContent = String(reasoningText);
        reasoning.append(summary, body);
        article.append(reasoning);
      }
      fragment.append(article);
    }
    if (backgroundActionCount) {
      const summary = document.createElement("details");
      summary.className = "cockpit-transcript-activity-summary";
      const heading = document.createElement("summary");
      heading.textContent = `${backgroundActionCount} background action${backgroundActionCount === 1 ? "" : "s"} kept out of the reading flow`;
      const list = document.createElement("div");
      list.textContent = [...backgroundActionNames.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 12)
        .map(([name, count]) => `${name} · ${count}`)
        .join("\n");
      const hint = document.createElement("button");
      hint.type = "button";
      hint.textContent = "Open recent activity";
      hint.addEventListener("click", () => {
        selectInspectorTab("activity");
        root.dataset.inspectorOpen = "true";
      });
      summary.append(heading, list, hint);
      fragment.append(summary);
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
      if (task.historical) row.title = "Recovered from the latest persisted Hermes task-list event";
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
    const browserTool = String(payload.name || payload.labels?.title || "").toLowerCase();
    if (browserTool.startsWith("browser_") || browserTool.includes("browser navigate") || browserTool.includes("browser click") || browserTool.includes("browser type") || browserTool.includes("browser scroll")) {
      selectInspectorTab("browser");
      root.dataset.inspectorOpen = "true";
      refreshBrowserPreview(true);
    }
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
    if (state.mode !== "terminal") {
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
      setConnection(state.connected ? "connected" : "offline", "Open or create a chat before attaching files");
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

  async function semanticSessionParams(profile, prompt, task = "") {
    try {
      const response = await request(`${CONTROL_PLANE}/semantic-routing/decide`, {
        method: "POST",
        body: JSON.stringify({
          profile: profile || "default",
          slot: "primary",
          task,
          prompt: String(prompt || "New Hermes conversation").slice(0, 12000),
          session_id: state.sessionKey
        })
      });
      const decision = response?.decision;
      if (decision) {
        state.routingDecisions = [decision, ...state.routingDecisions].slice(0, 50);
        renderRoutingDecisions();
      }
      const selected = decision?.routed ? decision.selected : null;
      if (selected?.provider && selected?.model) {
        return { provider: selected.provider, model: selected.model };
      }
    } catch (_) {
      // A router outage must never prevent Hermes from creating a session.
    }
    return {};
  }

  async function newSession() {
    const profile = state.profile || document.getElementById("cockpit-profile-picker")?.value || "default";
    setConnection("connecting", "Creating chat…");
    try {
      ensureBotEventHandler();
      const routed = await semanticSessionParams(profile, composer?.value || "New interactive chat");
      const created = await gateway().call("session.create", {
        profile,
        title: "New chat",
        hidden: false,
        follow_profile_config: true,
        ...routed
      }, 30000);
      const storedId = created?.stored_session_id || created?.session_id;
      if (!storedId) throw new Error("Hermes did not return a new session.");
      await openChatSession({ id: storedId, title: "New chat", profile_name: profile, message_count: 0 });
    } catch (error) {
      if (error instanceof AuthRequiredError) showAuth();
      else setConnection("offline", error.message || "Could not create chat");
    }
  }

  async function copySelection() {
    const selected = state.mode !== "terminal" ? String(globalThis.getSelection?.() || "") : state.terminal?.getSelection() || "";
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

  function sessionProfileName(session) {
    if (typeof session?.profile_name === "string" && session.profile_name) return session.profile_name;
    if (typeof session?.profile === "string" && session.profile) return session.profile;
    return "default";
  }

  function recoverHistoricalActivity(messages) {
    const recovered = [];
    for (const message of messages) {
      const names = toolNames(message);
      for (const name of names) {
        recovered.push({
          id: `history-${message.id || message.message_uid || recovered.length}-${name}`,
          name,
          context: "Recorded in this conversation",
          summary: messageText(message).slice(0, 220),
          status: message.effect_disposition === "error" ? "error" : "complete",
          historical: true
        });
      }
    }
    state.botActivity = recovered.slice(-60);
    renderBotActivity();
  }

  function recoverHistoricalTodos(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const content = messageText(messages[index]);
      if (!/active task list/i.test(content)) continue;
      const todos = [];
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*-\s*\[([^\]]*)\]\s*(?:(\S+)\.\s*)?(.+?)\s*\((in_progress|pending|completed|cancelled)\)\s*$/i);
        if (!match) continue;
        todos.push({
          id: match[2] || `persisted-${todos.length + 1}`,
          content: match[3],
          status: match[4].toLowerCase(),
          historical: true
        });
      }
      if (todos.length) return todos;
    }
    return [];
  }

  async function loadStructuredHistory(id, fallback) {
    try {
      const payload = await request(`/api/sessions/${encodeURIComponent(id)}/messages?limit=500&order=oldest&include_compacted=true&inline_images=false`);
      if (Array.isArray(payload?.messages) && payload.messages.length) return payload.messages;
    } catch (_) {}
    return fallback;
  }

  async function openChatSession(session) {
    const id = session?.session_id || session?.id;
    if (!id) return;
    const profile = sessionProfileName(session);
    closeMobilePanels();
    state.profile = profile === "default" ? "" : profile;
    state.resume = id;
    state.currentSessionMeta = { ...session, id };
    state.botProfile = null;
    state.botSession = null;
    state.botMessages = [];
    state.botTodos = [];
    state.botSubagents = [];
    state.botActivity = [];
    state.selectedSubagent = null;
    text(document.getElementById("cockpit-profile"), profile);
    text(document.getElementById("cockpit-bot-chat-title"), sessionLabel(session));
    text(document.getElementById("cockpit-bot-chat-profile"), `${profile === "default" ? "default profile" : `@${profile}`} · conversation`);
    setBotStatus("Opening conversation…");
    setWorkspaceMode("chat");
    renderBotMessages();
    renderBotTasks();
    renderBotSubagents();
    renderBotActivity();
    setConnection("connecting", "Resuming chat…");
    try {
      ensureBotEventHandler();
      const resumed = await gateway().call("session.resume", {
        profile,
        session_id: id,
        source: "desktop",
        inline_images: false
      }, 60000);
      const runtimeId = resumed?.session_id;
      if (!runtimeId) throw new Error("Hermes did not resume this conversation.");
      state.botSession = {
        profile,
        runtimeId,
        sessionKey: resumed.session_key || resumed.resumed || id,
        canonicalId: id,
        lastSeen: 0
      };
      state.botStreaming = resumed.status === "streaming" || Boolean(resumed.inflight);
      state.botTodos = Array.isArray(resumed?.todo_state?.todos) ? resumed.todo_state.todos : [];
      let messages = Array.isArray(resumed.messages) ? resumed.messages : [];
      try {
        const history = await gateway().call("session.history", { profile, session_id: runtimeId }, 60000);
        if (Array.isArray(history?.messages)) messages = history.messages;
      } catch (_) {}
      const gatewayTodos = recoverHistoricalTodos(messages);
      messages = await loadStructuredHistory(id, messages);
      state.botMessages = messages.map((message) => ({ ...message, text: messageText(message) }));
      if (!state.botTodos.length) state.botTodos = gatewayTodos.length ? gatewayTodos : recoverHistoricalTodos(state.botMessages);
      recoverHistoricalActivity(state.botMessages);
      renderBotMessages();
      renderBotTasks();
      startBotPolling();
      setBotStatus(state.botStreaming ? "Responding…" : `${conversationMessageCount(state.botMessages)} conversation messages`);
      setConnection("connected", sessionLabel(session));
      await Promise.allSettled([loadModels(), loadSessions()]);
    } catch (error) {
      if (error instanceof AuthRequiredError) showAuth();
      else {
        setBotStatus(error.message || "Conversation unavailable");
        setConnection("offline", "Could not open conversation");
      }
    }
  }

  function renderSessionList(sessions) {
    const target = document.getElementById("cockpit-sessions");
    if (!target) return;
    target.replaceChildren();
    if (!sessions.length) {
      target.innerHTML = `<p class="cockpit-muted">${state.sessionSearch ? "No matching conversations." : "No saved conversations yet."}</p>`;
      return;
    }
    for (const session of sessions) {
      const id = session.session_id || session.id;
      if (!id) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cockpit-session";
      button.dataset.active = state.currentSessionMeta?.id === id ? "true" : "false";
      const label = document.createElement("span");
      label.className = "cockpit-session-title";
      label.textContent = sessionLabel(session);
      const meta = document.createElement("span");
      meta.className = "cockpit-session-meta";
      const profile = sessionProfileName(session);
      meta.textContent = `${session.message_count || 0} messages · ${profile}${session.is_active ? " · active" : ""}`;
      button.append(label, meta);
      button.addEventListener("click", () => openChatSession(session));
      target.append(button);
    }
  }

  async function loadSessions() {
    const target = document.getElementById("cockpit-sessions");
    if (!target) return;
    try {
      const query = state.sessionSearch.trim();
      const profile = state.profile ? `&profile=${encodeURIComponent(state.profile)}` : "";
      const path = query
        ? `/api/sessions/search?q=${encodeURIComponent(query)}&limit=60${profile}`
        : `/api/sessions?limit=60&order=recent&min_messages=1${profile}`;
      const payload = await request(path);
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : Array.isArray(payload.results) ? payload.results : [];
      state.sessions = sessions;
      renderSessionList(sessions);
    } catch (error) {
      if (error instanceof AuthRequiredError) return showAuth();
      target.innerHTML = '<p class="cockpit-muted">Sessions unavailable.</p>';
    }
  }

  function debounceSessionSearch(event) {
    state.sessionSearch = event?.target?.value || "";
    window.clearTimeout(state.sessionSearchTimer);
    state.sessionSearchTimer = window.setTimeout(loadSessions, 220);
  }

  function reopenCurrentSession() {
    if (state.mode === "terminal") return connect({ resume: state.resume });
    if (state.mode === "bot" && state.botProfile) return openBotChat(state.botProfile);
    if (state.currentSessionMeta) return openChatSession(state.currentSessionMeta);
    return newSession();
  }

  async function patchCurrentSession(changes) {
    const id = state.currentSessionMeta?.id;
    if (!id) return;
    const updated = await request(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(changes)
    });
    state.currentSessionMeta = { ...state.currentSessionMeta, ...changes, ...(updated || {}) };
    if (changes.title) text(document.getElementById("cockpit-bot-chat-title"), changes.title);
    await loadSessions();
  }

  function showSessionActions() {
    const host = document.querySelector(".cockpit-native-chat-heading");
    if (!host || !state.currentSessionMeta?.id) return;
    const existing = host.querySelector(".cockpit-session-actions");
    if (existing) return existing.remove();
    const menu = document.createElement("div");
    menu.className = "cockpit-session-actions";
    menu.innerHTML = `
      <button type="button" data-session-action="rename"><span class="material-symbols-outlined">edit</span>Rename</button>
      <button type="button" data-session-action="archive"><span class="material-symbols-outlined">archive</span>${state.currentSessionMeta.archived ? "Unarchive" : "Archive"}</button>
      <button type="button" data-session-action="export"><span class="material-symbols-outlined">download</span>Export</button>
      <button type="button" class="danger" data-session-action="delete"><span class="material-symbols-outlined">delete</span>Delete</button>`;
    host.append(menu);
    menu.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-session-action]");
      if (!button) return;
      const action = button.dataset.sessionAction;
      if (action === "rename") {
        menu.replaceChildren();
        const input = document.createElement("input");
        input.value = sessionLabel(state.currentSessionMeta);
        input.setAttribute("aria-label", "Conversation title");
        const save = document.createElement("button");
        save.type = "button";
        save.textContent = "Save";
        menu.append(input, save);
        save.addEventListener("click", async () => {
          const title = input.value.trim();
          if (title) await patchCurrentSession({ title });
          menu.remove();
        });
        input.addEventListener("keydown", (keyEvent) => { if (keyEvent.key === "Enter") save.click(); });
        input.focus();
        input.select();
        return;
      }
      if (action === "archive") await patchCurrentSession({ archived: !state.currentSessionMeta.archived });
      if (action === "export") await exportCurrentSession();
      if (action === "delete") {
        const accepted = globalThis.confirm(`Delete “${sessionLabel(state.currentSessionMeta)}”? This cannot be undone.`);
        if (accepted) {
          await request(`/api/sessions/${encodeURIComponent(state.currentSessionMeta.id)}`, { method: "DELETE" });
          state.currentSessionMeta = null;
          state.botSession = null;
          state.botMessages = [];
          renderBotMessages();
          await loadSessions();
          if (state.sessions[0]) await openChatSession(state.sessions[0]);
        }
      }
      menu.remove();
    });
  }

  async function exportCurrentSession() {
    const id = state.currentSessionMeta?.id;
    if (!id) return;
    try {
      const response = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(id)}/export`), { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${sessionLabel(state.currentSessionMeta).replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "") || "hermes-session"}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBotStatus("Conversation exported");
    } catch (error) {
      setBotStatus(error.message || "Export failed");
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
      const [info, options, menu] = await Promise.all([
        request(`/api/model/info${profile}`),
        request(`/api/model/options${profile ? `${profile}&` : "?"}include_unconfigured=true`),
        request(`${CONTROL_PLANE}/model-menu`).catch(() => null)
      ]);
      state.currentModel = info.model || "";
      text(document.getElementById("cockpit-model"), info.model ? `${info.provider || "provider"} / ${info.model}` : "Not configured");
      picker.replaceChildren();
      const providers = Array.isArray(options.providers) ? options.providers : [];
      for (const provider of providers) {
        const group = document.createElement("optgroup");
        const providerId = provider.slug || provider.id || provider.provider || provider.name || "provider";
        const preference = menu?.preferences?.providers?.[providerId] || {};
        if (preference.enabled === false && info.provider !== providerId) continue;
        const visible = new Set(Array.isArray(preference.visible_models) ? preference.visible_models : []);
        const curated = preference.mode === "curated";
        group.label = provider.display_name || provider.name || providerId;
        for (const model of provider.models || []) {
          const name = modelName(model);
          if (!name) continue;
          if (curated && !visible.has(name) && name !== info.model) continue;
          const option = document.createElement("option");
          option.value = name;
          option.textContent = preference.labels?.[name] || name;
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
    if (state.mode !== "terminal" && state.botSession?.runtimeId) {
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
    const routed = await semanticSessionParams(name, `${botTitle(profile)} persistent Bot Chat`, "bot_chat");
    const created = await rpc.call("session.create", {
      profile: name,
      title: "Bot Chat",
      hidden: true,
      follow_profile_config: true,
      ...routed
    });
    const runtimeId = created?.session_id;
    const storedId = created?.stored_session_id;
    if (!runtimeId || !storedId) throw new Error(`Hermes did not create ${botTitle(profile)}'s Bot Chat.`);
    await rpc.call("session.title", { profile: name, session_id: runtimeId, title: "Bot Chat" });
    return { id: storedId, resolved_id: storedId, resumeId: storedId, title: "Bot Chat", message_count: 0 };
  }

  async function submitBotPrompt(value) {
    if (!state.botSession?.runtimeId) {
      setBotStatus("Open or create a chat before sending a message.");
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
    state.currentSessionMeta = null;
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
      state.currentSessionMeta = { ...chat, id: chat.id, title: "Bot Chat", profile_name: name, bot: true };
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
      const gatewayTodos = recoverHistoricalTodos(messages);
      messages = await loadStructuredHistory(chat.id, messages);
      state.botMessages = messages.map((message) => ({ ...message, text: messageText(message) }));
      if (!state.botTodos.length) state.botTodos = gatewayTodos.length ? gatewayTodos : recoverHistoricalTodos(state.botMessages);
      recoverHistoricalActivity(state.botMessages);
      setBotStatus(state.botStreaming ? "Responding…" : `${conversationMessageCount(state.botMessages)} conversation messages`);
      renderBotMessages();
      renderBotTasks();
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
    if (pageMode === "bot") {
      setWorkspaceMode("bot");
      const preferred = state.botProfiles.find((profile) => profile.name === (state.profile || "default")) || state.botProfiles[0];
      if (preferred) await openBotChat(preferred);
      else setConnection("connected", "No Bot Mode profiles are available");
    } else {
      setWorkspaceMode("chat");
      if (state.sessions[0]) await openChatSession(state.sessions[0]);
      else setConnection("connected", "Ready for a new chat");
    }
  }

  start().catch((error) => {
    setConnection("offline", error.message);
    showTerminalMessage(error.message, "error");
  });
})();
