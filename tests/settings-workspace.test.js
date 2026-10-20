const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class FakeElement {
  constructor(tag = "div") {
    this.tagName = String(tag).toUpperCase();
    this.id = "";
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.type = "";
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
    this.children = [];
    this.lastChild = new FakeLeaf();
  }

  get options() { return this.children; }
  get lastElementChild() { return this.children.at(-1) || null; }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.children = children; }
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  matches(selector) {
    return (this.tagName === "INPUT" && this.type !== "checkbox" && selector.includes("input"))
      || (this.tagName === "TEXTAREA" && selector.includes("textarea"));
  }
  closest() { return null; }
  focus() {}
  select() {}
  showModal() {}
  close() {}
  remove() {}
}

class FakeLeaf {
  constructor() { this.textContent = ""; }
}

class FakeOption extends FakeElement {
  constructor(label = "", value = "") {
    super("option");
    this.textContent = String(label);
    this.value = String(value);
  }
}

function loadSettingsHooks() {
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) {
      const element = new FakeElement();
      element.id = id;
      elements.set(id, element);
    }
    return elements.get(id);
  };
  const document = {
    body: {style: {}, append() {}},
    getElementById: getElement,
    createElement: tag => new FakeElement(tag),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
  };
  const window = {
    document,
    confirm: () => true,
    addEventListener() {},
    navigator: {clipboard: {writeText: async () => {}}},
  };
  const source = fs.readFileSync("dist/settings-workspace.js", "utf8").replace(
    "  refreshWorkspace();",
    "  window.__testHooks={state,settingType,normalizeSettingValue,sameSettingValue,hasPublishedOverride,isSettingChanged,coerce,markDirty,makeControl};",
  );
  const context = {
    window,
    document,
    fetch: async () => { throw new Error("Unexpected network request"); },
    Option: FakeOption,
    URL,
    URLSearchParams,
    location: {href: "http://localhost/settings", hash: "", pathname: "/settings", search: ""},
    history: {replaceState() {}},
    setTimeout,
    clearTimeout,
    structuredClone,
    CSS: {escape: value => String(value)},
    console,
  };
  window.location = context.location;
  window.history = context.history;
  vm.runInNewContext(source, context, {filename: "dist/settings-workspace.js"});
  return {hooks: window.__testHooks, elements};
}

test("changed state ignores serialized values that equal Hermes defaults", () => {
  const {hooks} = loadSettingsHooks();
  hooks.state.schema = {fields: {
    "agent.fast_auto_seconds": {type: "int"},
    "agent.run_budget_seconds": {type: "Optional[int]"},
    "agent.max_turns": {type: "integer"},
  }};
  hooks.state.defaults = {agent: {fast_auto_seconds: 60, run_budget_seconds: null, max_turns: 500}};
  hooks.state.config = {agent: {fast_auto_seconds: 60, run_budget_seconds: null, max_turns: 700}};
  hooks.state.explicit = {agent: {fast_auto_seconds: "60", run_budget_seconds: "", max_turns: 700}};

  assert.equal(hooks.hasPublishedOverride("agent.fast_auto_seconds"), false);
  assert.equal(hooks.hasPublishedOverride("agent.run_budget_seconds"), false);
  assert.equal(hooks.hasPublishedOverride("agent.max_turns"), true);
  assert.equal(hooks.isSettingChanged("agent.fast_auto_seconds"), false);
  assert.equal(hooks.isSettingChanged("agent.max_turns"), true);
});

test("dirty tracking normalizes empty nullable values and numeric representations", () => {
  const {hooks} = loadSettingsHooks();
  hooks.state.schema = {fields: {
    "agent.fast_auto_seconds": {type: "int"},
    "agent.run_budget_seconds": {type: "Optional[int]"},
  }};
  hooks.state.config = {agent: {fast_auto_seconds: 60, run_budget_seconds: null}};

  hooks.markDirty("agent.fast_auto_seconds", "60", false);
  hooks.markDirty("agent.run_budget_seconds", "", false);
  assert.equal(hooks.state.dirty.size, 0);

  hooks.markDirty("agent.fast_auto_seconds", 61, false);
  assert.equal(hooks.state.dirty.get("agent.fast_auto_seconds"), 61);
});

test("integer and nullable integer schema types render numeric controls", () => {
  const {hooks} = loadSettingsHooks();
  const integer = hooks.makeControl("agent.max_turns", {type: "int", min: 1, max: 1000}, 500);
  const nullable = hooks.makeControl("agent.run_budget_seconds", {type: "Optional[int]"}, null);

  assert.equal(integer.tagName, "INPUT");
  assert.equal(integer.type, "number");
  assert.equal(integer.step, "1");
  assert.equal(integer.inputMode, "numeric");
  assert.equal(integer.min, "1");
  assert.equal(integer.max, "1000");
  assert.equal(nullable.type, "number");
  assert.equal(hooks.coerce(nullable, {type: "Optional[int]"}, "agent.run_budget_seconds"), null);
});

test("finite enum controls preserve boolean and numeric value types", () => {
  const {hooks} = loadSettingsHooks();
  const meta = {type: "select", enum: ["auto", true, false, 2]};
  const select = hooks.makeControl("agent.example_mode", meta, false);

  assert.equal(select.tagName, "SELECT");
  assert.equal(hooks.coerce(select, meta, "agent.example_mode"), false);
  select.value = "3";
  assert.equal(hooks.coerce(select, meta, "agent.example_mode"), 2);
});

test("tool-use requirement has semantic modes without losing model-list support", () => {
  const {hooks} = loadSettingsHooks();
  const always = hooks.makeControl("agent.tool_use_enforcement", {type: "string"}, true);
  const selectedModels = hooks.makeControl("agent.tool_use_enforcement", {type: "string"}, ["qwen", "llama"]);
  const alwaysSelect = always.children[0];
  const modelSelect = selectedModels.children[0];
  const modelList = selectedModels.children[1];

  assert.equal(alwaysSelect.tagName, "SELECT");
  assert.equal(alwaysSelect.value, "1");
  assert.equal(hooks.coerce(alwaysSelect, {type: "select"}, "agent.tool_use_enforcement"), true);
  assert.deepEqual(alwaysSelect.children.map(option => option.textContent), [
    "Automatic — Hermes decides by model",
    "Always require tool use",
    "Do not require tool use",
    "Only for selected model names",
  ]);
  assert.equal(modelSelect.value, "3");
  assert.equal(modelList.hidden, false);
});

test("boolean settings expose a stable accessible switch name", () => {
  const {hooks} = loadSettingsHooks();
  const control = hooks.makeControl("agent.verify_on_stop", {type: "bool"}, false);
  const input = control.children[1];

  assert.equal(input.type, "checkbox");
  assert.equal(input.getAttribute("role"), "switch");
  assert.equal(input.getAttribute("aria-label"), "Verify work before stopping");
});
