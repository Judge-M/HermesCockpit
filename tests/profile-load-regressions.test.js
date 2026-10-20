const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.open = false;
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.classList = {toggle() {}, add() {}, remove() {}};
    this.listeners = new Map();
    this.attributes = new Map();
    this.lastChild = id.endsWith(":last-child") ? null : new FakeElement(`${id}:last-child`);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  append(...children) {
    this.children = [...(this.children || []), ...children];
  }

  appendChild(child) {
    this.append(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  querySelector() {
    return new FakeElement(`${this.id}:query`);
  }

  querySelectorAll() {
    return [];
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  matches() { return false; }
  closest() { return null; }
  focus() {}
  select() {}
  showModal() {}
  close() {}
}

class FakeOption extends FakeElement {
  constructor(label, value) {
    super("option");
    this.textContent = String(label ?? "");
    this.value = String(value ?? "");
  }
}

function response(body, ok = true) {
  return {
    ok,
    headers: {get: () => "application/json"},
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function browserContext(fetchImpl) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };
  for (const id of ["panel-settings", "semantic-escalation", "semantic-verification"]) getElement(id);
  getElement("panel-settings").hidden = true;
  getElement("semantic-escalation").disabled = true;
  getElement("semantic-escalation").dataset.safetyState = "unavailable";
  getElement("semantic-escalation").setAttribute("aria-describedby", "semantic-escalation-help");
  getElement("semantic-verification").disabled = true;
  getElement("semantic-verification").dataset.safetyState = "unavailable";
  getElement("semantic-verification").setAttribute("aria-describedby", "semantic-verification-help");
  const help = (id) => { const node = getElement(id); node.textContent = "Automatic evaluation is not available in this release. Saved evaluation settings are kept."; };
  help("semantic-escalation-help");
  help("semantic-verification-help");

  const document = {
    body: {style: {}},
    getElementById: getElement,
    createElement: (tag) => new FakeElement(tag),
    querySelectorAll: selector => String(selector).split(",").map(part => part.trim()).filter(part => /^#[A-Za-z0-9_-]+$/.test(part)).map(part => getElement(part.slice(1))),
    querySelector: () => null,
    addEventListener() {},
  };
  const window = {
    document,
    confirm: () => true,
    addEventListener() {},
    navigator: {clipboard: {writeText: async () => {}}},
  };
  const context = {
    window,
    document,
    fetch: fetchImpl,
    Option: FakeOption,
    URL,
    URLSearchParams,
    location: {href: "http://localhost/test", hash: "", pathname: "/test", search: ""},
    history: {replaceState() {}},
    setTimeout,
    clearTimeout,
    structuredClone,
    CSS: {escape: value => String(value)},
    console,
  };
  window.location = context.location;
  window.history = context.history;
  return {context, elements};
}

function loadSettingsHooks(fetchImpl) {
  const source = fs.readFileSync("dist/settings-workspace.js", "utf8").replace(
    "  refreshWorkspace();",
    "  window.__testHooks={state,loadProfileDetails,loadSettings,saveSoul,httpErrorMessage,safeErrorDetail};",
  );
  const {context, elements} = browserContext(fetchImpl);
  vm.runInNewContext(source, context, {filename: "dist/settings-workspace.js"});
  return {hooks: context.window.__testHooks, elements};
}

function loadModelHooks(fetchImpl) {
  const script = fs.readFileSync("dist/models-providers-workspace.js", "utf8").replace(
    "openFromHash();load().then(openFromHash);",
    "window.__testHooks={state,loadAssignments,load,httpErrorMessage,safeErrorDetail};",
  );
  const {context, elements} = browserContext(fetchImpl);
  vm.runInNewContext(script, context, {filename: "dist/models-providers.html"});
  return {hooks: context.window.__testHooks, elements};
}

test("failed profile data load keeps profile-bound saves disabled and dirty settings intact", async () => {
  const requests = [];
  const {hooks, elements} = loadSettingsHooks(async (url, options) => {
    requests.push({url, options});
    if (url.includes("/profiles/A/soul")) throw new Error("SOUL unavailable");
    if (url.includes("/profiles/A/setup-command")) return response({command: "hermes --profile A"});
    throw new Error("config unavailable");
  });
  hooks.state.profiles = [{name: "A", description: "Profile A"}];
  hooks.state.active = "A";
  hooks.state.selected = "A";
  hooks.state.liveAvailable = true;

  await hooks.loadProfileDetails("A");

  elements.get("profile-soul").value = "new unsaved SOUL";
  await hooks.saveSoul();
  assert.equal(hooks.state.soulLoaded, false);
  assert.equal(elements.get("save-soul").disabled, true);
  assert.equal(requests.filter(request => request.url.includes("/soul") && request.options?.method === "PUT").length, 0);

  hooks.state.dirty.set("agent.max_turns", 7);
  await hooks.loadSettings();
  assert.equal(hooks.state.dirty.get("agent.max_turns"), 7);
  assert.equal(elements.get("save-settings").disabled, true);
});

test("profile editors stay read-only until the selected profile has loaded", async () => {
  const {hooks, elements} = loadSettingsHooks(async (url) => {
    if (url.includes("/profiles/A/soul")) return response({content: "Profile A soul"});
    if (url.includes("/profiles/A/setup-command")) return response({command: "hermes --profile A"});
    throw new Error("not requested in this regression");
  });
  hooks.state.profiles = [{name: "A", description: "Profile A"}];
  hooks.state.selected = "A";
  hooks.state.liveAvailable = true;

  const load = hooks.loadProfileDetails("A");
  assert.equal(elements.get("profile-description").disabled, true);
  assert.equal(elements.get("profile-soul").disabled, true);
  await load;
  assert.equal(elements.get("profile-description").disabled, false);
  assert.equal(elements.get("profile-soul").disabled, false);
});

test("out-of-order A/B assignment loads leave the newest profile selected", async () => {
  const pending = new Map();
  const fetchImpl = url => new Promise(resolve => {
    const match = url.match(/[?&]profile=([^&]+)/);
    const profile = decodeURIComponent(match?.[1] || "");
    const list = pending.get(profile) || [];
    list.push({url, resolve});
    pending.set(profile, list);
  });
  const {hooks} = loadModelHooks(fetchImpl);
  hooks.state.liveAvailable = true;
  hooks.state.profiles = [{name: "A"}, {name: "B"}];
  hooks.state.menu = {providers: [{slug: "provider", models: ["model"]}]};

  const resolveProfile = profile => {
    const calls = pending.get(profile) || [];
    for (const call of calls) {
      const body = call.url.includes("/model/auxiliary")
        ? {main: {provider: "provider", model: `${profile}-main`}, tasks: []}
        : call.url.includes("/model/options")
          ? {providers: [{slug: "provider", models: ["model"]}]}
          : call.url.includes("semantic-routing")
            ? {config: {}}
            : {providers: []};
      call.resolve(response(body));
    }
    pending.delete(profile);
  };

  const loadA = hooks.loadAssignments("A");
  const loadB = hooks.loadAssignments("B");
  resolveProfile("B");
  await loadB;
  resolveProfile("A");
  await loadA;

  assert.equal(hooks.state.assignmentProfile, "B");
  assert.equal(hooks.state.assignmentLoadedProfile, "B");
  assert.equal(hooks.state.assignment.main.model, "B-main");
});

test("a failed B profile load cannot save A's previously loaded SOUL into B", async () => {
  const writes = [];
  const {hooks, elements} = loadSettingsHooks(async (url, options) => {
    if (options?.method === "PUT") { writes.push({url, options}); return response({ok:true}); }
    if (url.includes("/profiles/A/soul")) return response({content: "Profile A soul"});
    if (url.includes("/setup-command")) return response({command: "hermes"});
    throw new Error("B profile data unavailable");
  });
  hooks.state.profiles = [{name: "A"}, {name: "B"}];
  hooks.state.selected = "A";
  hooks.state.liveAvailable = true;
  await hooks.loadProfileDetails();
  assert.equal(elements.get("profile-soul").value, "Profile A soul");

  hooks.state.selected = "B";
  await hooks.loadProfileDetails();
  await hooks.saveSoul();

  assert.equal(elements.get("profile-soul").value, "");
  assert.equal(elements.get("save-soul").disabled, true);
  assert.equal(writes.length, 0);
});

test("model panels retain successful data when optional profile discovery fails", async () => {
  const {hooks} = loadModelHooks(async (url) => {
    if (url.endsWith("/profiles")) throw new Error("profiles endpoint unavailable");
    if (url.includes("model-menu")) return response({providers: [{slug: "provider", models: ["model"]}], preferences: {}});
    if (url.includes("/providers/oauth")) return response({providers: []});
    if (url.includes("/providers/custom-endpoints")) return response({endpoints: []});
    if (url.includes("/credentials/pool")) return response({credentials: []});
    if (url.includes("/model/auxiliary")) return response({main: {}, tasks: []});
    if (url.includes("/model/options")) return response({providers: []});
    if (url.includes("semantic-routing")) return response({config: {}});
    return response({});
  });

  await hooks.load();
  assert.equal(hooks.state.menu.providers[0].slug, "provider");
  assert.match(hooks.state.panelErrors.profiles, /profiles endpoint unavailable/);
});

test("failed model catalog cannot enable or post the destructive picker save", async () => {
  const requests = [];
  const {hooks, elements} = loadModelHooks(async (url, options = {}) => {
    requests.push({url, options});
    if (url.includes("model-menu")) return response({ok: false, error: "catalog token=do-not-show"});
    if (url.includes("/providers/oauth")) return response({providers: []});
    if (url.includes("/providers/custom-endpoints")) return response({endpoints: []});
    if (url.includes("/credentials/pool")) return response({credentials: []});
    if (url.endsWith("/profiles")) return response({profiles: []});
    return response({});
  });

  await hooks.load();

  assert.equal(hooks.state.readiness.menu, false);
  assert.equal(hooks.state.menu, null);
  assert.equal(elements.get("save-model-menu").disabled, true);
  assert.equal(elements.get("summary-providers").textContent, "—");
  assert.equal(elements.get("summary-models").textContent, "—");
  assert.equal(elements.get("summary-provider-state").textContent, "Unknown");
  assert.equal(elements.get("summary-model-state").textContent, "Unknown");
  assert.equal(requests.filter(request => request.options?.method === "POST" && request.url.includes("model-menu")).length, 0);
});

test("browser-facing HTTP errors redact credentials", () => {
  const settings = loadSettingsHooks(async () => response({})).hooks;
  const models = loadModelHooks(async () => response({})).hooks;
  const responseMeta = {status: 503, headers: {get: () => "application/json"}};
  for (const hooks of [settings, models]) {
    const message = hooks.httpErrorMessage(responseMeta, {detail: "token=abc123 Authorization: Bearer secret-value password=hunter2"});
    assert.doesNotMatch(message, /abc123|secret-value|hunter2/);
    assert.match(message, /\[redacted\]/);
  }
});
