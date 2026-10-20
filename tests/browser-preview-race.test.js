const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function previewHarness() {
  const source = fs.readFileSync("dist/hermes-client.js", "utf8");
  const pending = [];
  const painted = [];
  const state = {runtimeId: "A", profile: "default", browserPreviewToken: 0};
  const sandbox = {
    state,
    currentBrowserProfileName: () => state.profile,
    renderBrowserPreview: value => painted.push(value),
    gateway: () => ({call: (_method, params) => new Promise(resolve => pending.push({params, resolve}))}),
  };
  const start = source.indexOf("  async function refreshBrowserPreview(");
  const end = source.indexOf("  function startBrowserPreview(", start);
  vm.runInNewContext(source.slice(start, end), sandbox);
  return {state, pending, painted, refresh: sandbox.refreshBrowserPreview};
}

test("late browser preview from A cannot replace B's frame", async () => {
  const h = previewHarness();
  const a = h.refresh(true);
  h.state.runtimeId = "B";
  const b = h.refresh(true);
  h.pending[1].resolve({session_id:"B",data_url:"frame-b"});
  await b;
  h.pending[0].resolve({session_id:"A",data_url:"frame-a"});
  await a;
  assert.deepEqual(h.painted.map(value => value.session_id), ["B"]);
});

test("browser preview response is discarded after a profile change", async () => {
  const h = previewHarness();
  const request = h.refresh(true);
  h.state.profile = "different-profile";
  h.pending[0].resolve({session_id:"A",data_url:"frame-a"});
  await request;
  assert.equal(h.painted.length, 0);
  assert.equal(h.state.browserPreviewInFlight, false);
});
