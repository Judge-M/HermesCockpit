(async () => {
  "use strict";

  const HERMES_BASE = "/hermes";
  const BUILD_ID = "20261017d";
  const versionedHref = href => {
    const [path, hash = ""] = href.split("#");
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}v=${BUILD_ID}${hash ? `#${hash}` : ""}`;
  };
  const primary = [
    { path: "live-control", href: "live-control.html", icon: "chat", label: "Chat" },
    { path: "bot-mode", href: "bot-mode.html", icon: "smart_toy", label: "Bot Mode" },
    { path: "kanban", href: "kanban.html", icon: "view_kanban", label: "Board" },
    { path: "models-providers", href: "models-providers.html", icon: "model_training", label: "Models" },
    { path: "tool-registry", href: "tool-registry.html", icon: "handyman", label: "Tools" },
    { path: "mesh-topology", href: "mesh-topology.html", icon: "dns", label: "System" }
  ];
  const secondary = [
    { path: "runtime-config-settings", href: "runtime-config-settings.html", icon: "tune", label: "Manage" },
    { path: "acp-telemetry", href: "acp-telemetry.html", icon: "monitoring", label: "Observability" }
  ];
  const navLink = (item, mobile = false) => {
    const active = item.path === window.currentPage;
    return `<a class="hc-nav-link${active ? " is-active" : ""}${mobile ? " hc-mobile-link" : ""}" data-path="${item.path}" href="${versionedHref(item.href)}"${active ? ' aria-current="page"' : ""}>
      <span class="material-symbols-outlined">${item.icon}</span><span>${item.label}</span>
    </a>`;
  };

  const headerHost = document.getElementById("shared-header");
  const sidebarHost = document.getElementById("shared-sidebar");
  if (headerHost) headerHost.innerHTML = `
    <header class="hc-header">
      <a class="hc-brand" href="${versionedHref("live-control.html")}" aria-label="Hermes Cockpit home">
        <img alt="Hermes Aviator Girl Logo" src="assets/hermes-aviator-girl.jpg">
        <span><strong>Hermes</strong><small>Cockpit</small></span>
      </a>
      <div class="hc-header-center">
        <span class="hc-connection-dot" id="shared-hermes-dot"></span>
        <span id="shared-hermes-status" data-state="connecting">Connecting…</span>
        <span id="shared-hermes-version"></span>
      </div>
      <div class="hc-header-actions">
        <a href="${versionedHref("models-providers.html#add-provider")}" class="hc-header-button"><span class="material-symbols-outlined">add</span><span>Add provider</span></a>
        <a href="${versionedHref("runtime-config-settings.html")}" class="hc-icon-button" aria-label="Open Manage workspace" title="Manage Hermes"><span class="material-symbols-outlined">settings</span></a>
      </div>
    </header>`;
  if (sidebarHost) sidebarHost.innerHTML = `
    <aside class="hc-sidebar">
      <div class="hc-nav-group"><div class="hc-nav-label">Workspace</div>${primary.map(item => navLink(item)).join("")}</div>
      <div class="hc-nav-spacer"></div>
      <div class="hc-nav-group hc-nav-secondary"><div class="hc-nav-label">Manage</div>${secondary.map(item => navLink(item)).join("")}</div>
    </aside>
    <nav class="hc-mobile-nav" aria-label="Primary navigation">
      ${primary.slice(0, 3).map(item => navLink(item, true)).join("")}
      <button class="hc-nav-link hc-mobile-link" id="hc-more-button" type="button" aria-expanded="false"><span class="material-symbols-outlined">more_horiz</span><span>More</span></button>
    </nav>
    <div class="hc-more-sheet" id="hc-more-sheet" hidden>
      <button class="hc-sheet-backdrop" data-close-more aria-label="Close menu"></button>
      <section class="hc-sheet-panel" aria-label="More destinations">
        <div class="hc-sheet-handle"></div><div class="hc-sheet-title"><strong>More</strong><button data-close-more aria-label="Close menu"><span class="material-symbols-outlined">close</span></button></div>
        ${[...primary.slice(3), ...secondary].map(item => navLink(item)).join("")}
      </section>
    </div>`;

  const moreButton = document.getElementById("hc-more-button");
  const moreSheet = document.getElementById("hc-more-sheet");
  const setMore = open => {
    if (!moreSheet || !moreButton) return;
    moreSheet.hidden = !open;
    moreButton.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("hc-sheet-open", open);
  };
  moreButton?.addEventListener("click", () => setMore(moreSheet?.hidden !== false));
  moreSheet?.querySelectorAll("[data-close-more]").forEach(button => button.addEventListener("click", () => setMore(false)));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") setMore(false);
    if ((event.ctrlKey || event.metaKey) && event.key === ",") {
      event.preventDefault();
      location.href = versionedHref("runtime-config-settings.html");
    }
  });

  let notice = document.getElementById("demo-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "demo-notice";
    document.body.append(notice);
  }
  notice.textContent = "Connecting to Hermes…";
  notice.title = "Live Hermes API status";

  const setSharedStatus = (state, label, version = "") => {
    const status = document.getElementById("shared-hermes-status");
    if (status) { status.textContent = label; status.dataset.state = state; }
    const dot = document.getElementById("shared-hermes-dot");
    if (dot) dot.dataset.state = state;
    const versionNode = document.getElementById("shared-hermes-version");
    if (versionNode) versionNode.textContent = version ? `v${String(version).replace(/^v/, "")}` : "";
    if (document.body?.dataset.hermesClient !== "true") notice.textContent = state === "connected" ? "Live Hermes data" : label;
  };

  try {
    const response = await fetch(`${HERMES_BASE}/api/health`, { credentials: "include", cache: "no-store" });
    if (response.status === 401) setSharedStatus("offline", "Sign in required");
    else if (!response.ok) throw new Error(`HTTP ${response.status}`);
    else {
      const health = await response.json();
      setSharedStatus("connected", "Hermes connected", health.displayVersion || health.version || "");
    }
  } catch (_) {
    setSharedStatus("offline", "Hermes unavailable");
  }
})();
