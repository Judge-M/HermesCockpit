(() => {
  "use strict";

  const API_ROOT = "/hermes/api/plugins/kanban";
  const queryProfile = new URLSearchParams(location.search).get("profile") || "";
  const state = {
    boards: [], selectedBoard: "", board: null, workflow: {columns: [], manual: {}, archived: "archived"},
    stats: {}, assignees: [], workers: [], models: [], projects: [], profiles: [], orchestration: {},
    detail: null, loading: true, dragTask: null, modalSubmit: null, probes: new Map()
  };
  const $ = id => document.getElementById(id);
  const refs = {
    boardSelect: $("boardSelect"), statusBanner: $("statusBanner"), board: $("board"), boardLoading: $("boardLoading"),
    emptyState: $("emptyState"), unavailableState: $("unavailableState"), unavailableCopy: $("unavailableCopy"),
    search: $("searchInput"), assigneeFilter: $("assigneeFilter"), tenantFilter: $("tenantFilter"), archived: $("archivedToggle"),
    drawer: $("taskDrawer"), drawerBackdrop: $("drawerBackdrop"), drawerBody: $("drawerBody"), drawerTitle: $("drawerTitle"),
    drawerEyebrow: $("drawerEyebrow"), modal: $("modalBackdrop"), modalForm: $("modalForm"), modalBody: $("modalBody"),
    modalTitle: $("modalTitle"), modalSubtitle: $("modalSubtitle"), modalEyebrow: $("modalEyebrow"), modalSubmit: $("modalSubmit"),
    livePill: $("livePill"), toastStack: $("toastStack")
  };

  const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
  const attr = esc;
  const initials = value => String(value || "?").split(/[\s_-]+/).filter(Boolean).slice(0, 2).map(v => v[0]).join("").toUpperCase();
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const unix = value => value ? new Date(Number(value) * 1000).toLocaleString() : "Not yet";
  const age = seconds => {
    seconds = number(seconds);
    if (!seconds) return "just now";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  };
  const bytes = value => {
    let n = number(value); const units = ["B", "KB", "MB", "GB"]; let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
    return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
  };
  const compactId = id => String(id || "").length > 12 ? `${String(id).slice(0, 6)}…${String(id).slice(-4)}` : String(id || "");
  const selected = (a, b) => String(a ?? "") === String(b ?? "") ? " selected" : "";
  const checked = value => value ? " checked" : "";

  function pathFor(path, {board = true, profile = true, params = {}} = {}) {
    const url = new URL(`${API_ROOT}${path}`, location.origin);
    if (board && state.selectedBoard) url.searchParams.set("board", state.selectedBoard);
    if (profile && queryProfile) url.searchParams.set("profile", queryProfile);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
    return `${url.pathname}${url.search}`;
  }

  async function api(path, options = {}, query = {}) {
    const started = performance.now();
    const requestPath = pathFor(path, query);
    try {
      const response = await fetch(requestPath, {credentials: "include", cache: "no-store", ...options});
      const type = response.headers.get("content-type") || "";
      const payload = type.includes("json") ? await response.json() : await response.text();
      state.probes.set(path, {ok: response.ok, status: response.status, ms: Math.round(performance.now() - started)});
      if (!response.ok) {
        const detail = payload?.detail || payload?.message || (typeof payload === "string" && payload) || `Request failed (${response.status})`;
        const error = new Error(detail); error.status = response.status; error.payload = payload; throw error;
      }
      return payload;
    } catch (error) {
      if (!state.probes.has(path) || state.probes.get(path).ok) state.probes.set(path, {ok: false, status: error.status || 0, ms: Math.round(performance.now() - started)});
      throw error;
    }
  }

  const json = body => ({headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  const post = (path, body = {}, query = {}) => api(path, {method: "POST", ...json(body)}, query);
  const patch = (path, body, query = {}) => api(path, {method: "PATCH", ...json(body)}, query);
  const put = (path, body, query = {}) => api(path, {method: "PUT", ...json(body)}, query);
  const remove = (path, query = {}) => api(path, {method: "DELETE"}, query);

  function toast(title, message = "", error = false) {
    const node = document.createElement("div");
    node.className = `kb-toast${error ? " is-error" : ""}`;
    node.innerHTML = `<span class="material-symbols-outlined">${error ? "error" : "check_circle"}</span><div><strong>${esc(title)}</strong>${message ? `<p>${esc(message)}</p>` : ""}</div>`;
    refs.toastStack.append(node);
    setTimeout(() => node.remove(), error ? 7000 : 4200);
  }

  function setConnection(kind, title, copy) {
    refs.statusBanner.className = `kb-status-banner is-${kind}`;
    refs.statusBanner.querySelector(".material-symbols-outlined").textContent = kind === "ready" ? "cloud_done" : kind === "error" ? "cloud_off" : "hourglass_top";
    refs.statusBanner.querySelector("strong").textContent = title;
    refs.statusBanner.querySelector("p").textContent = copy;
    $("retryButton").hidden = kind !== "error";
    refs.livePill.className = `kb-live-pill${kind === "ready" ? " is-live" : kind === "error" ? " is-error" : ""}`;
    refs.livePill.querySelector("span").textContent = kind === "ready" ? "Live" : kind === "error" ? "Unavailable" : "Connecting";
  }

  function allTasks() {
    return (state.board?.columns || []).flatMap(column => Array.isArray(column.tasks) ? column.tasks : []);
  }

  function boardMetadata() {
    return state.boards.find(board => board.slug === state.selectedBoard) || {};
  }

  async function loadWorkspace({preserveDrawer = false} = {}) {
    state.loading = true;
    refs.boardLoading.hidden = false; refs.board.hidden = true; refs.emptyState.hidden = true; refs.unavailableState.hidden = true;
    setConnection("loading", "Loading your workflow", "Reading boards, columns, tasks, and active workers from Hermes.");
    try {
      const [boardsPayload, workflow] = await Promise.all([
        api("/boards", {}, {board: false, params: {include_archived: false}}),
        api("/workflow", {}, {board: false})
      ]);
      state.boards = Array.isArray(boardsPayload?.boards) ? boardsPayload.boards : [];
      state.workflow = workflow && Array.isArray(workflow.columns) ? workflow : {columns: [], manual: {}, archived: "archived"};
      const requested = new URLSearchParams(location.search).get("board") || "";
      const valid = state.boards.some(item => item.slug === state.selectedBoard) ? state.selectedBoard : state.boards.some(item => item.slug === requested) ? requested : "";
      state.selectedBoard = valid || boardsPayload?.current || state.boards[0]?.slug || "";
      renderBoardPicker();
      if (!state.selectedBoard) {
        state.board = {columns: state.workflow.columns.map(column => ({name: column.key, tasks: []})), tenants: [], assignees: [], latest_event_id: 0};
        renderAll();
        setConnection("ready", "Kanban is connected", "Create a board to begin organizing Hermes work.");
        return;
      }
      const includeArchived = refs.archived.checked;
      const results = await Promise.allSettled([
        api("/board", {}, {params: {include_archived: includeArchived, tenant: refs.tenantFilter.value}}),
        api("/stats"), api("/assignees"), api("/workers/active"), api("/model-options", {}, {board: false}),
        api("/projects", {}, {board: false}), api("/profiles", {}, {board: false}), api("/orchestration", {}, {board: false})
      ]);
      const value = index => results[index].status === "fulfilled" ? results[index].value : null;
      if (!value(0)) throw results[0].reason;
      state.board = value(0);
      state.stats = value(1) || {};
      state.assignees = value(2)?.assignees || (state.board.assignees || []).map(name => ({name}));
      state.workers = value(3)?.workers || [];
      state.models = value(4)?.providers || [];
      state.projects = value(5)?.projects || [];
      state.profiles = value(6)?.profiles || [];
      state.orchestration = value(7) || {};
      renderAll();
      setConnection("ready", "Kanban is live", `${allTasks().length} task${allTasks().length === 1 ? "" : "s"} on ${boardMetadata().name || state.selectedBoard}.`);
      if (preserveDrawer && state.detail?.task?.id) await openTask(state.detail.task.id, {silent: true});
    } catch (error) {
      showUnavailable(error);
    } finally {
      state.loading = false;
    }
  }

  function showUnavailable(error) {
    refs.boardLoading.hidden = true; refs.board.hidden = true; refs.emptyState.hidden = true; refs.unavailableState.hidden = false;
    const auth = error?.status === 401 || error?.status === 403;
    refs.unavailableCopy.textContent = auth ? "Sign in to Hermes, then retry this workspace." : (error?.status === 404 ? "The installed Hermes profile did not publish the Kanban plugin." : `Hermes could not load the Kanban workspace. ${error?.message || "Check the service and try again."}`);
    setConnection("error", auth ? "Sign in required" : "Kanban unavailable", refs.unavailableCopy.textContent);
  }

  function renderAll() {
    refs.boardLoading.hidden = true; refs.unavailableState.hidden = true;
    renderBoardPicker(); renderFilters(); renderStats(); renderBoard();
    $("workerCount").textContent = String(state.workers.length);
    $("newTaskButton").disabled = !state.selectedBoard;
    $("dispatchButton").disabled = !state.selectedBoard;
  }

  function renderBoardPicker() {
    if (!state.boards.length) refs.boardSelect.innerHTML = `<option value="">No boards yet</option>`;
    else refs.boardSelect.innerHTML = state.boards.map(board => `<option value="${attr(board.slug)}"${selected(board.slug, state.selectedBoard)}>${esc(board.icon || "")}${board.icon ? " " : ""}${esc(board.name || board.slug)} · ${number(board.total)} tasks</option>`).join("");
  }

  function renderFilters() {
    const names = state.assignees.map(item => typeof item === "string" ? item : item.name).filter(Boolean);
    const oldAssignee = refs.assigneeFilter.value;
    refs.assigneeFilter.innerHTML = `<option value="">Everyone</option><option value="__unassigned">Unassigned</option>${names.map(name => `<option value="${attr(name)}"${selected(name, oldAssignee)}>${esc(name)}</option>`).join("")}`;
    const oldTenant = refs.tenantFilter.value;
    refs.tenantFilter.innerHTML = `<option value="">All projects</option>${(state.board?.tenants || []).map(name => `<option value="${attr(name)}"${selected(name, oldTenant)}>${esc(name)}</option>`).join("")}`;
  }

  function statsCounts() {
    const fromColumns = Object.fromEntries((state.board?.columns || []).map(column => [column.name, column.tasks?.length || 0]));
    const raw = state.stats?.status_counts || state.stats?.by_status || state.stats?.statuses || state.stats || {};
    const counts = {};
    state.workflow.columns.forEach(column => { counts[column.key] = number(raw[column.key] ?? fromColumns[column.key]); });
    return counts;
  }

  function renderStats() {
    const counts = statsCounts();
    const terminal = new Set(["done", "archived"]);
    $("statOpen").textContent = String(Object.entries(counts).filter(([key]) => !terminal.has(key)).reduce((sum, [, n]) => sum + n, 0));
    $("statRunning").textContent = String(counts.running || 0);
    $("statBlocked").textContent = String((counts.blocked || 0) + (counts.review || 0));
    $("statDone").textContent = String(counts.done || 0);
    const oldest = state.stats?.oldest_ready_age_seconds ?? state.stats?.oldest_ready_age ?? null;
    $("statOldest").textContent = oldest === null || oldest === undefined ? "None waiting" : age(oldest);
  }

  function taskMatches(task) {
    const q = refs.search.value.trim().toLowerCase();
    const assignee = refs.assigneeFilter.value;
    if (assignee === "__unassigned" && task.assignee) return false;
    if (assignee && assignee !== "__unassigned" && task.assignee !== assignee) return false;
    if (!q) return true;
    return [task.id, task.title, task.body, task.assignee, task.tenant, task.project_id, task.latest_summary, task.status].some(value => String(value || "").toLowerCase().includes(q));
  }

  function columnInfo(key) {
    return state.workflow.columns.find(column => column.key === key) || {key, label: key.replace(/_/g, " "), icon: "•", drag_target: true};
  }

  function allowedTargets(task) {
    const allowed = state.workflow.manual?.[task.status] || [];
    return allowed.filter(key => state.workflow.columns.some(column => column.key === key && column.drag_target !== false));
  }

  function renderBoard() {
    const source = new Map((state.board?.columns || []).map(column => [column.name, column.tasks || []]));
    const columns = [...state.workflow.columns];
    if (refs.archived.checked && source.has(state.workflow.archived || "archived")) columns.push({key: state.workflow.archived || "archived", label: "Archived", icon: "▣", drag_target: false});
    const total = allTasks().length;
    refs.emptyState.hidden = total !== 0;
    if (!total && refs.emptyState.nextElementSibling !== refs.board) refs.board.parentNode.insertBefore(refs.emptyState, refs.board);
    refs.emptyState.classList.toggle("is-compact", total === 0);
    refs.board.hidden = false;
    refs.board.innerHTML = columns.map(info => {
      const tasks = (source.get(info.key) || []).filter(taskMatches);
      const canCreate = ["triage", "todo", "ready"].includes(info.key);
      return `<section class="kb-column" data-column="${attr(info.key)}">
        <header class="kb-column-header"><span class="kb-column-mark">${esc(info.icon || "•")}</span><div class="kb-column-title"><strong>${esc(info.label || info.key)}</strong><small>${esc(info.key)}</small></div><span class="kb-column-count">${tasks.length}</span>${canCreate ? `<button class="kb-column-add" type="button" data-create-status="${attr(info.key)}" title="Create task here"><span class="material-symbols-outlined">add</span></button>` : ""}</header>
        <div class="kb-column-cards" data-drop-column="${attr(info.key)}">${tasks.length ? tasks.map(renderCard).join("") : `<div class="kb-column-empty"><span class="material-symbols-outlined">${info.key === "running" ? "smart_toy" : info.key === "done" ? "task_alt" : "inbox"}</span><span>${emptyColumnCopy(info.key)}</span></div>`}</div>
      </section>`;
    }).join("");
    wireDragAndDrop();
  }

  function emptyColumnCopy(key) {
    return ({triage:"Unspecified work lands here",todo:"No work waiting for assignment",scheduled:"No scheduled work",ready:"Nothing ready to dispatch",running:"No agents running",blocked:"Nothing needs intervention",review:"Nothing awaiting review",done:"No completed tasks yet",archived:"No archived tasks"})[key] || "No tasks in this stage";
  }

  function renderCard(task) {
    const targets = allowedTargets(task);
    const priority = number(task.priority);
    const progress = task.progress && number(task.progress.total) ? `<span class="kb-badge is-progress"><span class="material-symbols-outlined">account_tree</span>${number(task.progress.done)}/${number(task.progress.total)}</span>` : "";
    const comments = number(task.comment_count) ? `<span class="kb-badge"><span class="material-symbols-outlined">chat_bubble</span>${number(task.comment_count)}</span>` : "";
    const links = number(task.link_counts?.parents) + number(task.link_counts?.children);
    const linked = links ? `<span class="kb-badge"><span class="material-symbols-outlined">link</span>${links}</span>` : "";
    const warning = task.warnings?.count ? `<span class="kb-badge is-warning"><span class="material-symbols-outlined">warning</span>${number(task.warnings.count)}</span>` : "";
    const model = task.model_override ? `<span class="kb-badge"><span class="material-symbols-outlined">neurology</span>${esc(task.model_override)}</span>` : "";
    const summary = task.latest_summary || task.body || "";
    const createdAge = task.age?.created_age_seconds ?? ((state.board?.now || Date.now()/1000) - number(task.created_at));
    return `<article class="kb-card" data-task-id="${attr(task.id)}" draggable="${targets.length ? "true" : "false"}" tabindex="0" aria-label="Open task ${attr(task.title)}">
      ${task.status === "running" ? `<span class="kb-running-pulse"></span>` : ""}
      <div class="kb-card-top"><span class="kb-card-id">${esc(compactId(task.id))}</span><span class="kb-priority${priority >= 8 ? " is-urgent" : priority >= 4 ? " is-high" : ""}"><span class="material-symbols-outlined" style="font-size:12px">flag</span>${priority}</span></div>
      <h3>${esc(task.title || "Untitled task")}</h3>${summary ? `<p class="kb-card-summary">${esc(summary)}</p>` : ""}
      <div class="kb-card-badges">${progress}${comments}${linked}${warning}${model}</div>
      <footer class="kb-card-footer"><div class="kb-assignee"><span class="kb-avatar">${esc(initials(task.assignee || "Unassigned"))}</span><span>${esc(task.assignee || "Unassigned")}</span></div><span class="kb-card-age">${esc(age(createdAge))}</span></footer>
    </article>`;
  }

  function wireDragAndDrop() {
    refs.board.querySelectorAll(".kb-card[draggable=true]").forEach(card => {
      card.addEventListener("dragstart", event => {
        const task = allTasks().find(item => item.id === card.dataset.taskId);
        if (!task) return;
        state.dragTask = task; card.classList.add("is-dragging"); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id);
      });
      card.addEventListener("dragend", () => { state.dragTask = null; card.classList.remove("is-dragging"); refs.board.querySelectorAll(".is-drop-target").forEach(node => node.classList.remove("is-drop-target")); });
    });
    refs.board.querySelectorAll("[data-drop-column]").forEach(zone => {
      zone.addEventListener("dragover", event => {
        if (!state.dragTask || !allowedTargets(state.dragTask).includes(zone.dataset.dropColumn)) return;
        event.preventDefault(); zone.closest(".kb-column").classList.add("is-drop-target");
      });
      zone.addEventListener("dragleave", event => { if (!zone.contains(event.relatedTarget)) zone.closest(".kb-column").classList.remove("is-drop-target"); });
      zone.addEventListener("drop", async event => {
        event.preventDefault(); const task = state.dragTask; const status = zone.dataset.dropColumn;
        zone.closest(".kb-column").classList.remove("is-drop-target");
        if (!task || !allowedTargets(task).includes(status)) return;
        await moveTask(task.id, status);
      });
    });
  }

  async function moveTask(taskId, status, extra = {}) {
    try {
      await patch(`/tasks/${encodeURIComponent(taskId)}`, {status, ...extra});
      toast("Task moved", `Now in ${columnInfo(status).label}.`); await loadWorkspace({preserveDrawer: state.detail?.task?.id === taskId});
    } catch (error) { toast("Move was refused", error.message, true); }
  }

  function openModal({eyebrow = "Kanban", title, subtitle = "", body, submit = "Save", danger = false, onSubmit}) {
    refs.modalEyebrow.textContent = eyebrow; refs.modalTitle.textContent = title; refs.modalSubtitle.textContent = subtitle;
    refs.modalBody.innerHTML = body; refs.modalSubmit.textContent = submit; refs.modalSubmit.className = `kb-button ${danger ? "kb-button-danger" : "kb-button-primary"}`;
    state.modalSubmit = onSubmit; refs.modal.hidden = false; document.body.style.overflow = "hidden";
    setTimeout(() => refs.modalBody.querySelector("input,select,textarea")?.focus(), 20);
  }

  function closeModal() {
    refs.modal.hidden = true; state.modalSubmit = null; refs.modalForm.reset();
    if (!refs.drawer.classList.contains("is-open")) document.body.style.overflow = "";
  }

  function modelFields(task = {}) {
    const provider = task.provider_override || "";
    const models = state.models.find(item => item.slug === provider)?.models || [];
    return `<label class="kb-field"><span>Provider override <em>optional</em></span><select name="provider_override" data-model-provider><option value="">Use assignee default</option>${state.models.map(item => `<option value="${attr(item.slug)}"${selected(item.slug, provider)}>${esc(item.label || item.slug)}</option>`).join("")}</select></label>
      <label class="kb-field"><span>Model override <em>optional</em></span><select name="model_override" data-model-select><option value="">Use assignee default</option>${models.map(model => `<option value="${attr(model)}"${selected(model, task.model_override)}>${esc(model)}</option>`).join("")}</select></label>
      <label class="kb-field"><span>Reasoning effort</span><select name="reasoning_effort"><option value="">Use profile default</option>${["none","minimal","low","medium","high","xhigh","max","ultra"].map(value => `<option value="${value}"${selected(value, task.reasoning_effort)}>${value}</option>`).join("")}</select></label>`;
  }

  function wireModelFields() {
    const provider = refs.modalBody.querySelector("[data-model-provider]"); const model = refs.modalBody.querySelector("[data-model-select]");
    provider?.addEventListener("change", () => {
      const models = state.models.find(item => item.slug === provider.value)?.models || [];
      model.innerHTML = `<option value="">Use assignee default</option>${models.map(value => `<option value="${attr(value)}">${esc(value)}</option>`).join("")}`;
    });
  }

  function openCreateTask(initialStatus = "") {
    if (!state.selectedBoard) return openBoardManager(true);
    const assignees = state.assignees.map(item => typeof item === "string" ? item : item.name).filter(Boolean);
    const meta = boardMetadata();
    openModal({eyebrow: meta.name || state.selectedBoard, title: "Create task", subtitle: "This creates a durable Hermes task on the selected board.", submit: "Create task",
      body: `<div class="kb-form-grid">
        <label class="kb-field is-wide"><span>Task title</span><input name="title" required maxlength="300" placeholder="What should the agent accomplish?"></label>
        <label class="kb-field is-wide"><span>Description <em>optional</em></span><textarea name="body" placeholder="Outcome, constraints, context, and acceptance criteria"></textarea></label>
        <label class="kb-field"><span>Assignee</span><select name="assignee"><option value="">Unassigned</option>${assignees.map(name => `<option value="${attr(name)}">${esc(name)}</option>`).join("")}</select></label>
        <label class="kb-field"><span>Priority</span><input name="priority" type="number" value="0" min="-100" max="100"></label>
        <label class="kb-field"><span>Project</span><select name="project_id"><option value="">Board default</option>${state.projects.map(project => `<option value="${attr(project.id)}">${esc(project.name || project.slug)}</option>`).join("")}</select></label>
        <label class="kb-field"><span>Workspace</span><select name="workspace_kind"><option value="">Board default (${esc(meta.default_workspace_kind || "scratch")})</option><option value="scratch">Scratch workspace</option><option value="worktree">Git worktree</option><option value="dir">Existing directory</option></select></label>
        <label class="kb-field is-wide"><span>Workspace path <em>optional; required for an existing directory</em></span><input name="workspace_path" placeholder="/absolute/project/path"></label>
        <label class="kb-field"><span>Maximum runtime <em>seconds</em></span><input name="max_runtime_seconds" type="number" min="1" placeholder="No task-specific limit"></label>
        <label class="kb-field"><span>Start stage</span><select name="initial_status"><option value="">Hermes default</option>${["triage","todo","ready"].map(key => `<option value="${key}"${selected(key, initialStatus)}>${esc(columnInfo(key).label)}</option>`).join("")}</select></label>
        <div class="kb-form-section"><h3>Agent execution</h3><div class="kb-form-grid">${modelFields()}</div></div>
        <label class="kb-toggle-row is-wide"><input name="goal_mode" type="checkbox"><span><strong>Goal loop</strong><small>Keep the agent in the same session until a judge accepts completion or the turn budget is reached.</small></span></label>
        <label class="kb-field"><span>Goal turn budget</span><input name="goal_max_turns" type="number" min="1" placeholder="Use Hermes default"></label>
      </div>`,
      onSubmit: async form => {
        const data = new FormData(form); const title = String(data.get("title") || "").trim();
        const payload = {title, body: String(data.get("body") || "").trim() || null, priority: number(data.get("priority")), triage: data.get("initial_status") === "triage", goal_mode: data.get("goal_mode") === "on"};
        ["assignee","project_id","workspace_kind","workspace_path","provider_override","model_override","reasoning_effort"].forEach(key => { const value = String(data.get(key) || "").trim(); if (value) payload[key] = value; });
        if (payload.workspace_kind === "dir" && !payload.workspace_path) throw new Error("Enter an absolute workspace path for an existing directory.");
        ["max_runtime_seconds","goal_max_turns"].forEach(key => { const value = String(data.get(key) || "").trim(); if (value) payload[key] = number(value); });
        const result = await post("/tasks", payload); const task = result?.task; const desired = String(data.get("initial_status") || "");
        if (task && desired && task.status !== desired && (state.workflow.manual?.[task.status] || []).includes(desired)) await patch(`/tasks/${encodeURIComponent(task.id)}`, {status: desired});
        closeModal(); toast("Task created", task?.title || title); await loadWorkspace(); if (task?.id) await openTask(task.id);
      }});
    wireModelFields();
  }

  async function openTask(taskId, {silent = false} = {}) {
    refs.drawer.classList.add("is-open"); refs.drawer.setAttribute("aria-hidden", "false"); refs.drawerBackdrop.hidden = false; document.body.style.overflow = "hidden";
    refs.drawerTitle.textContent = "Loading task…"; refs.drawerEyebrow.textContent = compactId(taskId); refs.drawerBody.innerHTML = `<div class="kb-detail-loading">Loading live task details…</div>`;
    try {
      const [detail, homes] = await Promise.all([api(`/tasks/${encodeURIComponent(taskId)}`), api("/home-channels", {}, {params: {task_id: taskId}}).catch(() => ({home_channels: []}))]);
      state.detail = {...detail, home_channels: homes?.home_channels || []}; renderTaskDetail();
    } catch (error) {
      refs.drawerBody.innerHTML = `<div class="kb-unavailable-state"><span class="material-symbols-outlined">error</span><h2>Task unavailable</h2><p>${esc(error.message)}</p><button class="kb-button kb-button-ghost" data-close-drawer type="button">Close</button></div>`;
      if (!silent) toast("Could not open task", error.message, true);
    }
  }

  function closeDrawer() {
    refs.drawer.classList.remove("is-open"); refs.drawer.setAttribute("aria-hidden", "true"); refs.drawerBackdrop.hidden = true; state.detail = null;
    if (refs.modal.hidden) document.body.style.overflow = "";
  }

  function renderTaskDetail() {
    const d = state.detail || {}; const task = d.task || {}; const targets = allowedTargets(task); const links = d.links || {parents: [], children: []};
    refs.drawerEyebrow.textContent = `${columnInfo(task.status).label} · ${compactId(task.id)}`; refs.drawerTitle.textContent = task.title || "Untitled task";
    const canComplete = (state.workflow.manual?.[task.status] || []).includes("done");
    const run = (d.runs || []).find(item => !item.ended_at) || (d.runs || [])[0];
    refs.drawerBody.innerHTML = `<div class="kb-detail-actions">
      <button class="kb-button kb-button-ghost" data-action="edit"><span class="material-symbols-outlined">edit</span>Edit</button>
      <button class="kb-button kb-button-ghost" data-action="move"><span class="material-symbols-outlined">swap_horiz</span>Move</button>
      <button class="kb-button kb-button-ghost" data-action="reassign"><span class="material-symbols-outlined">person</span>Assign</button>
      ${canComplete ? `<button class="kb-button kb-button-primary" data-action="complete"><span class="material-symbols-outlined">task_alt</span>Complete</button>` : ""}
      <button class="kb-icon-button" data-action="more" title="More task actions"><span class="material-symbols-outlined">more_horiz</span></button>
    </div>
    <div class="kb-detail-grid">
      ${detailMetric("Status", columnInfo(task.status).label)}${detailMetric("Assignee", task.assignee || "Unassigned")}${detailMetric("Priority", task.priority ?? 0)}${detailMetric("Created", unix(task.created_at))}
      ${detailMetric("Workspace", task.workspace_kind || "scratch")}${detailMetric("Model", task.model_override || "Profile default")}${task.tenant ? detailMetric("Project", task.tenant) : ""}${task.current_step_key ? detailMetric("Workflow step", task.current_step_key) : ""}
    </div>
    <section class="kb-detail-section"><div class="kb-detail-section-header"><h3>Description</h3></div><p class="kb-prose">${esc(task.body || "No description provided.")}</p></section>
    ${task.latest_summary || task.result ? `<section class="kb-detail-section"><div class="kb-detail-section-header"><h3>Latest outcome</h3></div><p class="kb-prose">${esc(task.latest_summary || task.result)}</p></section>` : ""}
    ${task.diagnostics?.length ? `<section class="kb-detail-section"><div class="kb-detail-section-header"><h3>Needs attention</h3></div><div class="kb-mini-list">${task.diagnostics.map(item => `<div class="kb-mini-row"><span class="material-symbols-outlined">warning</span><div><strong>${esc(item.message || item.kind || "Diagnostic")}</strong><small>${esc(item.severity || "warning")}</small></div></div>`).join("")}</div></section>` : ""}
    <section class="kb-detail-section"><div class="kb-detail-section-header"><h3>Dependencies</h3><button class="kb-mini-action" data-action="add-link" type="button">Add dependency</button></div>${renderLinks(links, d.link_tasks || [])}</section>
    <section class="kb-detail-section"><div class="kb-detail-section-header"><h3>Comments · ${(d.comments || []).length}</h3></div>${renderComments(d.comments || [])}<div class="kb-field-inline" style="margin-top:8px"><input data-comment-input placeholder="Add a progress note"><button class="kb-button kb-button-ghost" data-action="comment" type="button">Post</button></div></section>
    <section class="kb-detail-section"><div class="kb-detail-section-header"><h3>Attachments · ${(d.attachments || []).length}</h3><button class="kb-mini-action" data-action="upload" type="button">Upload file</button></div>${renderAttachments(d.attachments || [])}<input data-upload-input type="file" hidden></section>
    <section class="kb-detail-section"><div class="kb-detail-section-header"><h3>Runs · ${(d.runs || []).length}</h3>${run ? `<button class="kb-mini-action" data-action="load-log" type="button">View worker log</button>` : ""}</div>${renderRuns(d.runs || [])}<div id="taskLogHost"></div></section>
    ${d.home_channels?.length ? `<section class="kb-detail-section"><div class="kb-detail-section-header"><h3>Notifications</h3></div><div class="kb-mini-list">${d.home_channels.map(home => `<label class="kb-mini-row"><span class="material-symbols-outlined">notifications</span><div><strong>${esc(home.name || home.platform)}</strong><small>${esc(home.platform)}</small></div><input type="checkbox" data-home-platform="${attr(home.platform)}"${checked(home.subscribed)}></label>`).join("")}</div></section>` : ""}
    <section class="kb-detail-section"><div class="kb-detail-section-header"><h3>History · ${(d.events || []).length}</h3></div>${renderEvents(d.events || [])}</section>`;
  }

  const detailMetric = (label, value) => `<div class="kb-detail-metric"><small>${esc(label)}</small><strong title="${attr(value)}">${esc(value)}</strong></div>`;
  function renderLinks(links, linkTasks) {
    const byId = new Map(linkTasks.map(task => [task.id, task]));
    const rows = [...(links.parents || []).map(id => ({id, relation: "Depends on", icon: "arrow_upward"})), ...(links.children || []).map(id => ({id, relation: "Blocks", icon: "arrow_downward"}))];
    if (!rows.length) return `<div class="kb-empty-inline">No task dependencies.</div>`;
    return `<div class="kb-mini-list">${rows.map(row => { const task = byId.get(row.id) || {}; return `<div class="kb-mini-row" data-open-task="${attr(row.id)}"><span class="material-symbols-outlined">${row.icon}</span><div><strong>${esc(task.title || row.id)}</strong><small>${row.relation}${task.status ? ` · ${esc(columnInfo(task.status).label)}` : ""}</small></div><button class="kb-mini-action" data-unlink="${attr(row.id)}" data-relation="${row.relation === "Depends on" ? "parent" : "child"}" title="Remove dependency"><span class="material-symbols-outlined">link_off</span></button></div>`; }).join("")}</div>`;
  }
  function renderComments(comments) {
    if (!comments.length) return `<div class="kb-empty-inline">No comments yet.</div>`;
    return comments.map(comment => `<article class="kb-comment"><div class="kb-comment-head"><strong>${esc(comment.author || "Hermes")}</strong><span>${esc(unix(comment.created_at))}</span></div><p>${esc(comment.body)}</p></article>`).join("");
  }
  function renderAttachments(attachments) {
    if (!attachments.length) return `<div class="kb-empty-inline">No files attached.</div>`;
    return `<div class="kb-mini-list">${attachments.map(file => `<div class="kb-mini-row"><span class="material-symbols-outlined">attach_file</span><div><strong>${esc(file.filename)}</strong><small>${bytes(file.size)} · ${esc(file.uploaded_by || "dashboard")}</small></div><a class="kb-mini-action" href="${attr(pathFor(`/attachments/${file.id}`))}" download title="Download"><span class="material-symbols-outlined">download</span></a><button class="kb-mini-action" data-delete-attachment="${file.id}" title="Delete"><span class="material-symbols-outlined">delete</span></button></div>`).join("")}</div>`;
  }
  function renderRuns(runs) {
    if (!runs.length) return `<div class="kb-empty-inline">This task has not started a run.</div>`;
    return `<div class="kb-mini-list">${runs.slice().reverse().map(run => `<div class="kb-mini-row"><span class="material-symbols-outlined">${run.ended_at ? "history" : "motion_photos_on"}</span><div><strong>Run ${run.id} · ${esc(run.status || run.outcome || "active")}</strong><small>${esc(run.profile || "No profile")} · ${esc(unix(run.started_at))}</small></div><button class="kb-mini-action" data-inspect-run="${run.id}" title="Inspect run"><span class="material-symbols-outlined">monitor_heart</span></button></div>`).join("")}</div>`;
  }
  function renderEvents(events) {
    if (!events.length) return `<div class="kb-empty-inline">No history recorded yet.</div>`;
    return `<div class="kb-mini-list">${events.slice(-12).reverse().map(event => `<div class="kb-mini-row"><span class="material-symbols-outlined">history</span><div><strong>${esc(String(event.kind || "event").replace(/_/g, " "))}</strong><small>${esc(unix(event.created_at))}</small></div></div>`).join("")}</div>`;
  }

  function editTaskModal() {
    const task = state.detail.task;
    openModal({eyebrow: compactId(task.id), title: "Edit task", subtitle: "Update task content and execution overrides.", submit: "Save changes",
      body: `<div class="kb-form-grid"><label class="kb-field is-wide"><span>Title</span><input name="title" required value="${attr(task.title)}"></label><label class="kb-field is-wide"><span>Description</span><textarea name="body">${esc(task.body || "")}</textarea></label><label class="kb-field"><span>Priority</span><input name="priority" type="number" min="-100" max="100" value="${number(task.priority)}"></label>${modelFields(task)}</div>`,
      onSubmit: async form => {
        const data = new FormData(form); const payload = {title: String(data.get("title") || "").trim(), body: String(data.get("body") || ""), priority: number(data.get("priority"))};
        const provider = String(data.get("provider_override") || ""); const model = String(data.get("model_override") || ""); const effort = String(data.get("reasoning_effort") || "");
        if (model) { payload.model_override = model; payload.provider_override = provider || null; } else if (task.model_override) payload.clear_model_override = true;
        if (effort) payload.reasoning_effort = effort; else if (task.reasoning_effort) payload.clear_reasoning_effort = true;
        await patch(`/tasks/${encodeURIComponent(task.id)}`, payload); closeModal(); toast("Task updated"); await loadWorkspace({preserveDrawer: true});
      }});
    wireModelFields();
  }

  function moveTaskModal() {
    const task = state.detail.task; const targets = state.workflow.manual?.[task.status] || [];
    openModal({eyebrow: compactId(task.id), title: "Move task", subtitle: `Choose a transition from ${columnInfo(task.status).label}. Hermes will enforce dependency and lifecycle rules.`, submit: "Move task",
      body: `<div class="kb-form-grid"><label class="kb-field is-wide"><span>Destination</span><select name="status" required><option value="">Choose stage</option>${targets.map(key => `<option value="${attr(key)}">${esc(columnInfo(key).label)}</option>`).join("")}<option value="archived">Archived</option></select></label><label class="kb-field is-wide"><span>Completion summary <em>used when moving to Done or Review</em></span><textarea name="summary" placeholder="What changed, evidence, and any follow-up"></textarea></label><label class="kb-field is-wide"><span>Block or schedule reason <em>optional</em></span><input name="block_reason" placeholder="Why this work is waiting"></label></div>`,
      onSubmit: async form => { const data = new FormData(form); const status = String(data.get("status")); const payload = {status}; const summary = String(data.get("summary") || "").trim(); const reason = String(data.get("block_reason") || "").trim(); if (summary) payload.summary = summary; if (reason) payload.block_reason = reason; await patch(`/tasks/${encodeURIComponent(task.id)}`, payload); closeModal(); toast("Task moved", `Now in ${columnInfo(status).label}.`); await loadWorkspace({preserveDrawer: status !== "archived"}); }});
  }

  function reassignModal() {
    const task = state.detail.task; const names = state.assignees.map(item => typeof item === "string" ? item : item.name).filter(Boolean);
    openModal({eyebrow: compactId(task.id), title: "Assign task", subtitle: "Route this work to an installed Hermes profile.", submit: "Update assignment",
      body: `<div class="kb-form-grid"><label class="kb-field is-wide"><span>Profile</span><select name="profile"><option value="">Unassigned</option>${names.map(name => `<option value="${attr(name)}"${selected(name, task.assignee)}>${esc(name)}</option>`).join("")}</select></label>${task.status === "running" ? `<label class="kb-toggle-row is-wide"><input name="reclaim_first" type="checkbox"><span><strong>Release the active worker first</strong><small>Stops the current run before changing profiles.</small></span></label><label class="kb-field is-wide"><span>Reason</span><input name="reason" placeholder="Why the work is being reassigned"></label>` : ""}</div>`,
      onSubmit: async form => { const data = new FormData(form); await post(`/tasks/${encodeURIComponent(task.id)}/reassign`, {profile: String(data.get("profile") || "") || null, reclaim_first: data.get("reclaim_first") === "on", reason: String(data.get("reason") || "") || null}); closeModal(); toast("Assignment updated"); await loadWorkspace({preserveDrawer: true}); }});
  }

  function moreActionsModal() {
    const task = state.detail.task;
    openModal({eyebrow: compactId(task.id), title: "Task actions", subtitle: "Use the same recovery and orchestration actions available to Hermes.", submit: "Close",
      body: `<div class="kb-mini-list">
        <button class="kb-mini-row" type="button" data-modal-action="estimate"><span class="material-symbols-outlined">data_usage</span><div><strong>Estimate effort</strong><small>Ask the configured auxiliary model for a rough token and complexity estimate.</small></div></button>
        ${task.status === "triage" ? `<button class="kb-mini-row" type="button" data-modal-action="specify"><span class="material-symbols-outlined">auto_fix_high</span><div><strong>Specify task</strong><small>Expand an underspecified triage card with the configured specifier.</small></div></button><button class="kb-mini-row" type="button" data-modal-action="decompose"><span class="material-symbols-outlined">account_tree</span><div><strong>Decompose task</strong><small>Fan this task out into linked child work.</small></div></button>` : ""}
        ${task.status === "running" ? `<button class="kb-mini-row" type="button" data-modal-action="reclaim"><span class="material-symbols-outlined">restart_alt</span><div><strong>Reclaim worker</strong><small>Release the active claim and return the task to the queue.</small></div></button>` : ""}
        <button class="kb-mini-row" type="button" data-modal-action="archive"><span class="material-symbols-outlined">archive</span><div><strong>Archive task</strong><small>Remove the card from the active workflow while keeping its history.</small></div></button>
        <button class="kb-mini-row" type="button" data-modal-action="delete"><span class="material-symbols-outlined" style="color:var(--kb-red)">delete_forever</span><div><strong>Delete permanently</strong><small>Remove this task and its board records. This cannot be undone.</small></div></button>
      </div>`, onSubmit: async () => closeModal()});
  }

  async function runTaskAction(action) {
    const task = state.detail.task;
    try {
      if (action === "estimate") {
        const result = await post(`/tasks/${encodeURIComponent(task.id)}/estimate`);
        openModal({eyebrow:"Estimate",title:result.ok ? `${result.complexity || "—"} complexity` : "Estimate unavailable",subtitle:result.ok ? `${number(result.est_tokens).toLocaleString()} estimated tokens` : result.reason || "The auxiliary model could not estimate this task.",body:`<div class="kb-confirm" style="border-color:var(--kb-border);color:var(--kb-text)">${esc(result.rationale || result.reason || "No rationale returned.")}</div>`,submit:"Close",onSubmit:async()=>closeModal()}); return;
      }
      if (action === "specify" || action === "decompose") {
        const actionPath = action === "specify" ? `/tasks/${encodeURIComponent(task.id)}/specify` : `/tasks/${encodeURIComponent(task.id)}/decompose`;
        refs.modalSubmit.disabled = true; const result = await post(actionPath, {author: "dashboard"}); refs.modalSubmit.disabled = false;
        closeModal(); toast(result.ok ? `Task ${action === "specify" ? "specified" : "decomposed"}` : `${action} did not complete`, result.reason || (result.child_ids?.length ? `${result.child_ids.length} child tasks created` : ""), !result.ok); await loadWorkspace({preserveDrawer: true}); return;
      }
      if (action === "reclaim") return confirmAction("Reclaim active worker?", "The running agent will be stopped and the task returned to the queue.", "Reclaim worker", async reason => post(`/tasks/${encodeURIComponent(task.id)}/reclaim`, {reason}));
      if (action === "archive") return confirmAction("Archive this task?", "Its history will remain available when Archived is enabled.", "Archive task", async () => patch(`/tasks/${encodeURIComponent(task.id)}`, {status: "archived"}), false, true);
      if (action === "delete") return confirmAction("Delete this task permanently?", `Type ${task.id} to confirm. This cannot be undone.`, "Delete permanently", async () => remove(`/tasks/${encodeURIComponent(task.id)}`), true, true, task.id);
    } catch (error) { refs.modalSubmit.disabled = false; toast("Action failed", error.message, true); }
  }

  function confirmAction(title, copy, submit, execute, danger = false, closeAfter = false, phrase = "") {
    const taskId = state.detail?.task?.id;
    openModal({eyebrow:"Confirm action",title,subtitle:copy,submit,danger,body:`<div class="kb-form-grid">${phrase ? `<label class="kb-field is-wide"><span>Confirmation</span><input name="confirmation" required autocomplete="off" placeholder="${attr(phrase)}"><small>Enter the exact task ID shown above.</small></label>` : `<label class="kb-field is-wide"><span>Reason <em>optional</em></span><input name="reason" placeholder="Add context to the task history"></label>`}<div class="kb-confirm is-wide">This changes live Hermes state immediately.</div></div>`,
      onSubmit: async form => { const data = new FormData(form); if (phrase && data.get("confirmation") !== phrase) throw new Error("Confirmation does not match the task ID."); await execute(String(data.get("reason") || "") || null); closeModal(); toast(submit); if (closeAfter) closeDrawer(); await loadWorkspace({preserveDrawer: !closeAfter && Boolean(taskId)}); }});
  }

  function addLinkModal() {
    const task = state.detail.task; const candidates = allTasks().filter(item => item.id !== task.id);
    openModal({eyebrow:compactId(task.id),title:"Add dependency",subtitle:"Link cards so Hermes can enforce the order of work.",submit:"Add dependency",body:`<div class="kb-form-grid"><label class="kb-field is-wide"><span>Relationship</span><select name="relation"><option value="parent">This task depends on…</option><option value="child">This task blocks…</option></select></label><label class="kb-field is-wide"><span>Task</span><select name="other" required><option value="">Choose a task</option>${candidates.map(item => `<option value="${attr(item.id)}">${esc(item.title)} · ${esc(columnInfo(item.status).label)}</option>`).join("")}</select>${candidates.length ? "" : `<small>No other tasks are available on this board.</small>`}</label></div>`,
      onSubmit:async form=>{const data=new FormData(form),other=String(data.get("other")),relation=String(data.get("relation"));await post("/links",relation==="parent"?{parent_id:other,child_id:task.id}:{parent_id:task.id,child_id:other});closeModal();toast("Dependency added");await loadWorkspace({preserveDrawer:true});}});
  }

  function openBoardManager(createOnly = false) {
    const meta = boardMetadata(); const profileOptions = state.profiles.map(item => item.name).filter(Boolean);
    openModal({eyebrow:"Boards & orchestration",title:createOnly || !state.selectedBoard ? "Create a board" : "Board settings",subtitle:"Manage this workstream and the profiles that route its tasks.",submit:createOnly || !state.selectedBoard ? "Create board" : "Save board",
      body:`<div class="kb-form-grid">
        <label class="kb-field"><span>Board slug</span><input name="slug" required pattern="[a-z0-9][a-z0-9-]*" value="${attr(createOnly ? "" : meta.slug || "")}" ${createOnly || !state.selectedBoard ? "" : "readonly"} placeholder="product-launch"></label>
        <label class="kb-field"><span>Display name</span><input name="name" value="${attr(createOnly ? "" : meta.name || "")}" placeholder="Product launch"></label>
        <label class="kb-field is-wide"><span>Description</span><textarea name="description" placeholder="What belongs on this board?">${esc(createOnly ? "" : meta.description || "")}</textarea></label>
        <label class="kb-field"><span>Icon</span><input name="icon" value="${attr(createOnly ? "" : meta.icon || "")}" maxlength="8" placeholder="🚀"></label>
        <label class="kb-field"><span>Color</span><input name="color" type="color" value="${/^#[0-9a-f]{6}$/i.test(meta.color || "") && !createOnly ? attr(meta.color) : "#4fc3dc"}"></label>
        <label class="kb-field is-wide"><span>Project scope</span><select name="project_id"><option value="">No project scope</option>${state.projects.map(project => `<option value="${attr(project.id)}"${selected(project.id, createOnly ? "" : meta.project_id)}>${esc(project.name || project.slug)}</option>`).join("")}</select></label>
        ${createOnly || !state.selectedBoard ? `<label class="kb-toggle-row is-wide"><input name="switch" type="checkbox" checked><span><strong>Make this the active board</strong><small>Also updates the active board used by Hermes command-line and slash-command workflows.</small></span></label>` : `<div class="kb-form-section"><h3>Orchestration</h3><div class="kb-form-grid"><label class="kb-field"><span>Orchestrator profile</span><select name="orchestrator_profile"><option value="">Active profile (${esc(state.orchestration.active_profile || "default")})</option>${profileOptions.map(name => `<option value="${attr(name)}"${selected(name,state.orchestration.orchestrator_profile)}>${esc(name)}</option>`).join("")}</select></label><label class="kb-field"><span>Default assignee</span><select name="default_assignee"><option value="">Active profile (${esc(state.orchestration.active_profile || "default")})</option>${profileOptions.map(name => `<option value="${attr(name)}"${selected(name,state.orchestration.default_assignee)}>${esc(name)}</option>`).join("")}</select></label><label class="kb-toggle-row"><input name="auto_decompose" type="checkbox"${checked(state.orchestration.auto_decompose)}><span><strong>Auto-decompose</strong><small>Fan suitable intake into child tasks.</small></span></label><label class="kb-toggle-row"><input name="auto_promote_children" type="checkbox"${checked(state.orchestration.auto_promote_children)}><span><strong>Promote children</strong><small>Advance child work when dependencies clear.</small></span></label></div></div><div class="kb-form-section"><div class="kb-detail-actions"><button class="kb-button kb-button-ghost" data-board-action="new" type="button"><span class="material-symbols-outlined">add</span>New board</button><button class="kb-button kb-button-ghost" data-board-action="activate" type="button"><span class="material-symbols-outlined">check_circle</span>Set active for Hermes</button><button class="kb-button kb-button-danger" data-board-action="archive" type="button"><span class="material-symbols-outlined">archive</span>Archive board</button></div></div>`}
      </div>`,
      onSubmit:async form=>{const data=new FormData(form);const payload={slug:String(data.get("slug")||"").trim(),name:String(data.get("name")||"").trim()||null,description:String(data.get("description")||"").trim()||null,icon:String(data.get("icon")||"").trim()||null,color:String(data.get("color")||"").trim()||null,project_id:String(data.get("project_id")||"")};if(createOnly||!state.selectedBoard){payload.switch=data.get("switch")==="on";const result=await post("/boards",payload,{board:false});state.selectedBoard=result?.board?.slug||payload.slug;}else{delete payload.slug;await patch(`/boards/${encodeURIComponent(state.selectedBoard)}`,payload,{board:false});await put("/orchestration",{orchestrator_profile:String(data.get("orchestrator_profile")||""),default_assignee:String(data.get("default_assignee")||""),auto_decompose:data.get("auto_decompose")==="on",auto_promote_children:data.get("auto_promote_children")==="on"},{board:false});}closeModal();toast(createOnly?"Board created":"Board settings saved");await loadWorkspace();}});
  }

  function openWorkers() {
    openModal({eyebrow:"Live execution",title:"Active workers",subtitle:`${state.workers.length} Hermes worker${state.workers.length===1?" is":"s are"} running on this board.`,submit:"Close",body:state.workers.length?`<div class="kb-mini-list">${state.workers.map(worker=>`<div class="kb-mini-row"><span class="material-symbols-outlined">smart_toy</span><div><strong>${esc(worker.task_title||worker.task_id)}</strong><small>${esc(worker.profile||worker.task_assignee||"No profile")} · PID ${esc(worker.worker_pid||"—")} · ${esc(age((Date.now()/1000)-number(worker.started_at)))}</small></div><button class="kb-mini-action" data-worker-task="${attr(worker.task_id)}" title="Open task"><span class="material-symbols-outlined">open_in_new</span></button><button class="kb-mini-action" data-terminate-run="${worker.run_id}" title="Stop run"><span class="material-symbols-outlined">stop_circle</span></button></div>`).join("")}</div>`:`<div class="kb-empty-inline">No agents are running on this board.</div>`,onSubmit:async()=>closeModal()});
  }

  function openDiagnostics() {
    const rows=[[/boards/,"Board catalog"],[/workflow/,"Workflow definition"],[/board/,"Task board"],[/stats/,"Board statistics"],[/assignees/,"Profile roster"],[/workers\/active/,"Active workers"],[/model-options/,"Model catalog"],[/orchestration/,"Orchestration settings"]];
    openModal({eyebrow:"Diagnostics",title:"Kanban data sources",subtitle:"Technical request details are intentionally kept here, outside the everyday workflow.",submit:"Close",body:`<div class="kb-diag-list">${rows.map(([key,label])=>{const probe=[...state.probes.entries()].find(([path])=>key.test(path))?.[1];return `<div class="kb-diag-row"><strong>${esc(label)}</strong><span>${esc(String(key).slice(1,-1).replace(/\\\//g,"/"))}</span><b class="${probe?.ok?"":"is-error"}">${probe?`${probe.status||"ERR"} · ${probe.ms} ms`:"Not checked"}</b></div>`}).join("")}</div>`,onSubmit:async()=>closeModal()});
  }

  async function dispatchReady() {
    openModal({eyebrow:"Agent dispatch",title:"Dispatch ready work?",subtitle:"Hermes will claim eligible Ready tasks and start up to eight workers using the board's orchestration settings.",submit:"Dispatch",body:`<div class="kb-confirm" style="border-color:rgba(139,213,231,.28);color:var(--kb-text)">Only tasks that pass Hermes dependency, profile, and capacity checks will start.</div>`,onSubmit:async()=>{const result=await api("/dispatch",{method:"POST"},{params:{max:8,dry_run:false}});closeModal();toast("Dispatch completed",`${number(result?.spawned?.length??result?.spawned??0)} worker${number(result?.spawned?.length??result?.spawned??0)===1?"":"s"} started.`);await loadWorkspace();}});
  }

  async function inspectRun(runId) {
    try { const result=await api(`/runs/${runId}/inspect`); openModal({eyebrow:`Run ${runId}`,title:result.alive?"Worker is active":"Worker is not active",subtitle:result.reason||result.status||"Live process inspection",submit:"Close",body:`<div class="kb-detail-grid">${detailMetric("Process",result.pid||"—")}${detailMetric("CPU",result.cpu_percent==null?"—":`${result.cpu_percent}%`)}${detailMetric("Memory",result.memory_rss_bytes==null?"—":bytes(result.memory_rss_bytes))}${detailMetric("Threads",result.num_threads??"—")}</div>`,onSubmit:async()=>closeModal()}); } catch(error){toast("Could not inspect run",error.message,true);}
  }

  async function loadTaskLog() {
    const task=state.detail.task; const host=$("taskLogHost"); host.innerHTML=`<div class="kb-detail-loading" style="min-height:80px">Loading worker log…</div>`;
    try{const result=await api(`/tasks/${encodeURIComponent(task.id)}/log`,{}, {params:{tail:80000}});host.innerHTML=result.exists?`<pre class="kb-log">${esc(result.content||"Log is empty.")}</pre>`:`<div class="kb-empty-inline">No worker log exists for this task.</div>`;}catch(error){host.innerHTML=`<div class="kb-empty-inline">${esc(error.message)}</div>`;}
  }

  refs.modalForm.addEventListener("submit", async event => {
    event.preventDefault(); if (!state.modalSubmit) return; refs.modalSubmit.disabled = true;
    try { await state.modalSubmit(event.currentTarget); } catch (error) { toast("Could not save", error.message, true); } finally { refs.modalSubmit.disabled = false; }
  });
  $("modalClose").addEventListener("click", closeModal); $("modalCancel").addEventListener("click", closeModal);
  refs.modal.addEventListener("click", event => { if (event.target === refs.modal) closeModal(); });
  $("drawerClose").addEventListener("click", closeDrawer); refs.drawerBackdrop.addEventListener("click", closeDrawer);
  $("retryButton").addEventListener("click", () => loadWorkspace()); $("unavailableRetryButton").addEventListener("click", () => loadWorkspace());
  $("refreshButton").addEventListener("click", () => loadWorkspace({preserveDrawer: Boolean(state.detail)}));
  $("newTaskButton").addEventListener("click", () => openCreateTask()); $("emptyCreateButton").addEventListener("click", () => openCreateTask("triage"));
  $("boardMenuButton").addEventListener("click", () => openBoardManager(!state.selectedBoard)); $("workersButton").addEventListener("click", openWorkers); $("diagnosticsButton").addEventListener("click", openDiagnostics); $("dispatchButton").addEventListener("click", dispatchReady);
  refs.boardSelect.addEventListener("change", async () => { state.selectedBoard = refs.boardSelect.value; const url=new URL(location.href);if(state.selectedBoard)url.searchParams.set("board",state.selectedBoard);else url.searchParams.delete("board");history.replaceState(null,"",url);closeDrawer();await loadWorkspace(); });
  refs.search.addEventListener("input", renderBoard); refs.assigneeFilter.addEventListener("change", renderBoard); refs.tenantFilter.addEventListener("change", () => loadWorkspace()); refs.archived.addEventListener("change", () => loadWorkspace());

  refs.board.addEventListener("click", event => { const create=event.target.closest("[data-create-status]");if(create)return openCreateTask(create.dataset.createStatus);const card=event.target.closest("[data-task-id]");if(card)openTask(card.dataset.taskId); });
  refs.board.addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-task-id]")) { event.preventDefault(); openTask(event.target.dataset.taskId); } });
  refs.drawerBody.addEventListener("click", async event => {
    const action=event.target.closest("[data-action]")?.dataset.action; const task=state.detail?.task;if(!task)return;
    if(action==="edit")return editTaskModal();if(action==="move")return moveTaskModal();if(action==="reassign")return reassignModal();if(action==="more")return moreActionsModal();if(action==="complete")return confirmAction("Complete this task?","Hermes will close the task and release dependent work.","Complete task",async reason=>patch(`/tasks/${encodeURIComponent(task.id)}`,{status:"done",summary:reason||null}));if(action==="add-link")return addLinkModal();if(action==="load-log")return loadTaskLog();if(action==="upload")return refs.drawerBody.querySelector("[data-upload-input]").click();
    if(action==="comment"){const input=refs.drawerBody.querySelector("[data-comment-input]"),body=input.value.trim();if(!body)return;try{await post(`/tasks/${encodeURIComponent(task.id)}/comments`,{body,author:"dashboard"});toast("Comment added");await openTask(task.id,{silent:true});}catch(error){toast("Comment failed",error.message,true);}return;}
    const linked=event.target.closest("[data-open-task]");if(linked&&!event.target.closest("[data-unlink]"))return openTask(linked.dataset.openTask);
    const unlink=event.target.closest("[data-unlink]");if(unlink){const parent=unlink.dataset.relation==="parent"?unlink.dataset.unlink:task.id,child=unlink.dataset.relation==="parent"?task.id:unlink.dataset.unlink;try{await remove("/links",{params:{parent_id:parent,child_id:child}});toast("Dependency removed");await openTask(task.id,{silent:true});}catch(error){toast("Could not remove dependency",error.message,true);}return;}
    const attachment=event.target.closest("[data-delete-attachment]");if(attachment){try{await remove(`/attachments/${attachment.dataset.deleteAttachment}`);toast("Attachment removed");await openTask(task.id,{silent:true});}catch(error){toast("Could not delete attachment",error.message,true);}return;}
    const run=event.target.closest("[data-inspect-run]");if(run)return inspectRun(run.dataset.inspectRun);
  });
  refs.drawerBody.addEventListener("change", async event => {
    const task=state.detail?.task;if(!task)return;
    if(event.target.matches("[data-upload-input]")){const file=event.target.files?.[0];if(!file)return;const body=new FormData();body.append("file",file);body.append("uploaded_by","dashboard");try{await api(`/tasks/${encodeURIComponent(task.id)}/attachments`,{method:"POST",body});toast("File attached",file.name);await openTask(task.id,{silent:true});}catch(error){toast("Upload failed",error.message,true);}return;}
    if(event.target.matches("[data-home-platform]")){const platform=event.target.dataset.homePlatform;try{await api(`/tasks/${encodeURIComponent(task.id)}/home-subscribe/${encodeURIComponent(platform)}`,{method:event.target.checked?"POST":"DELETE"});toast(event.target.checked?"Notifications enabled":"Notifications disabled",platform);}catch(error){event.target.checked=!event.target.checked;toast("Notification change failed",error.message,true);}}
  });
  refs.modalBody.addEventListener("click", async event => {
    const action=event.target.closest("[data-modal-action]")?.dataset.modalAction;if(action)return runTaskAction(action);
    const worker=event.target.closest("[data-worker-task]");if(worker){closeModal();return openTask(worker.dataset.workerTask);}
    const terminate=event.target.closest("[data-terminate-run]");if(terminate){const runId=terminate.dataset.terminateRun;return openModal({eyebrow:`Run ${runId}`,title:"Stop this worker?",subtitle:"Hermes will reclaim the task and terminate the active process safely.",submit:"Stop worker",danger:true,body:`<label class="kb-field"><span>Reason <em>optional</em></span><input name="reason" placeholder="Why this run is being stopped"></label>`,onSubmit:async form=>{await post(`/runs/${runId}/terminate`,{reason:String(new FormData(form).get("reason")||"")||null});closeModal();toast("Worker stopped");await loadWorkspace();}});}
    const boardAction=event.target.closest("[data-board-action]")?.dataset.boardAction;if(!boardAction)return;
    if(boardAction==="new")return openBoardManager(true);
    if(boardAction==="activate"){try{await post(`/boards/${encodeURIComponent(state.selectedBoard)}/switch`,{}, {board:false});toast("Active board updated",boardMetadata().name||state.selectedBoard);}catch(error){toast("Could not activate board",error.message,true);}return;}
    if(boardAction==="archive")return openModal({eyebrow:"Confirm board change",title:"Archive this board?",subtitle:"The board is moved to recoverable archive storage. Its active tasks will no longer appear here.",submit:"Archive board",danger:true,body:`<label class="kb-field"><span>Type the board slug to confirm</span><input name="confirmation" required placeholder="${attr(state.selectedBoard)}"></label>`,onSubmit:async form=>{if(new FormData(form).get("confirmation")!==state.selectedBoard)throw new Error("Confirmation does not match the board slug.");await remove(`/boards/${encodeURIComponent(state.selectedBoard)}`,{board:false,params:{delete:false}});state.selectedBoard="";closeModal();toast("Board archived");await loadWorkspace();}});
  });
  document.addEventListener("keydown", event => { if(event.key==="Escape"){if(!refs.modal.hidden)closeModal();else if(refs.drawer.classList.contains("is-open"))closeDrawer();} if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();refs.search.focus();} if(event.key.toLowerCase()==="n"&&!event.target.matches("input,textarea,select")&&refs.modal.hidden){openCreateTask();} });

  loadWorkspace();
})();
