(async () => {
  const HERMES_BASE = "/hermes";
  const shell = window.__HERMES_SHELL__ || await fetch("shell.json").then((response) => response.json());
  document.getElementById("shared-header").innerHTML = shell.header;
  document.getElementById("shared-sidebar").innerHTML = shell.aside;

  const nav = document.querySelector("#shared-sidebar nav");
  if (nav && !nav.querySelector('[data-path="backend-control"]')) {
    const link = document.createElement("a");
    link.dataset.path = "backend-control";
    link.href = "backend-control.html";
    link.title = "Control Center (F6)";
    link.setAttribute("aria-label", "Control Center");
    link.innerHTML = '<span class="material-symbols-outlined">schema</span>';
    nav.append(link);
  }

  const pages = ["live-control", "mesh-topology", "tool-registry", "acp-telemetry", "runtime-config-settings", "backend-control"];
  document.querySelectorAll("#shared-sidebar a").forEach((link) => {
    const active = link.dataset.path === window.currentPage;
    link.href = `${link.dataset.path}.html`;
    link.className = `flex items-center justify-center w-10 h-10 rounded-lg transition-all ${active ? "bg-surface-secondary text-primary font-bold shadow-sm" : "text-text-secondary hover:bg-surface-container-high hover:text-text-primary"}`;
    link.firstElementChild.className = `material-symbols-outlined text-[20px] ${active ? "text-primary" : "text-text-quaternary hover:text-text-primary"}`;
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  document.addEventListener("keydown", (event) => {
    const number = Number(event.key.slice(1));
    if (/^F[1-6]$/.test(event.key)) {
      event.preventDefault();
      location.href = `${pages[number - 1]}.html`;
    }
  });

  const header = document.querySelector("#shared-header header");
  if (header?.children.length >= 3) {
    const badge = header.children[0].querySelector("span:last-child");
    if (badge) badge.textContent = "beta";
    header.children[1].innerHTML = `
      <div class="cockpit-header-live">
        <span class="cockpit-status-dot"></span>
        <span>Hermes</span>
        <span id="shared-hermes-status" data-state="connecting">Connecting…</span>
      </div>`;
    header.children[2].innerHTML = `
      <a class="cockpit-admin-link" href="runtime-config-settings.html" aria-label="Open Cockpit settings">Settings</a>`;
  }

  const oldDaemonBadge = document.querySelector("#shared-sidebar aside > div:last-child");
  if (oldDaemonBadge) {
    oldDaemonBadge.innerHTML = `
      <div class="relative flex items-center justify-center w-8 h-8 rounded-lg bg-surface-container-lowest border border-border-muted/50" title="Hermes API status">
        <span class="material-symbols-outlined text-[16px] text-primary">bolt</span>
        <span id="shared-hermes-dot" class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-warning"></span>
      </div>
      <span id="shared-hermes-version" class="font-code-xs text-[10px] text-text-quaternary">…</span>`;
  }

  const notice = document.createElement("div");
  notice.id = "demo-notice";
  notice.textContent = "Connecting to Hermes…";
  notice.title = "Live Hermes API status";
  document.body.append(notice);

  const setSharedStatus = (state, label, version = "") => {
    const status = document.getElementById("shared-hermes-status");
    if (status) {
      status.textContent = label;
      status.dataset.state = state;
    }
    const dot = document.getElementById("shared-hermes-dot");
    if (dot) dot.className = `absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${state === "connected" ? "bg-success" : "bg-error"}`;
    const versionNode = document.getElementById("shared-hermes-version");
    if (versionNode) versionNode.textContent = version || (state === "connected" ? "online" : "offline");
    if (document.body?.dataset.hermesClient !== "true") notice.textContent = state === "connected" ? "Live Hermes data" : label;
  };

  try {
    const response = await fetch(`${HERMES_BASE}/api/health`, { credentials: "include" });
    if (response.status === 401) setSharedStatus("offline", "Sign in required");
    else if (!response.ok) throw new Error(`HTTP ${response.status}`);
    else {
      const health = await response.json();
      setSharedStatus("connected", "Connected", health.displayVersion || health.version || "online");
    }
  } catch (_) {
    setSharedStatus("offline", "Hermes unavailable");
  }
})();
