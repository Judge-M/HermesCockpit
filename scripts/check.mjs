import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
await import('./check-csp.mjs');
const provenance = JSON.parse(read('source-provenance.json'));
const sourceChanges = JSON.parse(read('source-changes.json'));
const intentional = new Map((sourceChanges.changes || []).map(change => [change.path, change]));
for (const entry of provenance.files) {
  const hash = createHash('sha256').update(readFileSync(path.join(root, entry.path))).digest('hex');
  const change = intentional.get(entry.path);
  if (change) {
    assert.equal(change.baseline_sha256, entry.imported_sha256, `Intentional change baseline mismatch: ${entry.path}`);
    assert.notEqual(hash, entry.imported_sha256, `Intentional change is not present: ${entry.path}`);
    continue;
  }
  assert.equal(hash, entry.imported_sha256, `Imported baseline differs: ${entry.path}`);
}
const screens = ['live-control', 'bot-mode', 'kanban', 'models-providers', 'mesh-topology', 'tool-registry', 'acp-telemetry', 'runtime-config-settings', 'backend-control', 'cli-control'];
const navigationScreens = ['live-control', 'bot-mode', 'kanban', 'models-providers', 'mesh-topology', 'tool-registry', 'acp-telemetry', 'runtime-config-settings'];
let inlineScripts = 0;
for (const screen of screens) {
  const html = read(`dist/${screen}.html`);
  assert.ok(html.includes('id="shared-header"') && html.includes('id="shared-sidebar"'), screen);
  assert.ok(html.includes(`window.currentPage="${screen}"`), screen);
  assert.ok(!/<link\b[^>]+href="https?:\/\//i.test(html), `${screen}: external stylesheet dependency`);
  assert.ok(!/<script\b[^>]+src="https?:\/\//i.test(html), `${screen}: external script dependency`);
  assert.ok(html.includes('vendor/fonts.css'), `${screen}: missing local font stylesheet`);
  assert.ok(html.includes('vendor/material-symbols.css'), `${screen}: missing local icon stylesheet`);
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const ref = match[1];
    if (/^(?:https?:|data:|javascript:|\/)/.test(ref)) continue;
    assert.ok(existsSync(path.join(root, 'dist', ref.split(/[?#]/)[0])), `Missing local reference: ${screen}: ${ref}`);
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(match[1])) continue;
    new vm.Script(match[2], {filename: `${screen}.html:inline`});
    inlineScripts++;
  }
  for (const match of html.matchAll(/<input\b[^>]*>/g)) {
    if (/type="password"/.test(match[0])) assert.ok(!/value="[^"]+"/.test(match[0]), 'Nonempty password default');
  }
}
new vm.Script(read('dist/shell.js'), {filename:'shell.js'});
new vm.Script(read('dist/shell-data.js'), {filename:'shell-data.js'});
new vm.Script(read('dist/hermes-client.js'), {filename:'hermes-client.js'});
new vm.Script(read('dist/backend-control-workspace.js'), {filename:'backend-control-workspace.js'});
assert.ok(existsSync(path.join(root, 'dist/backend-control-workspace.css')), 'Missing Control Center workspace stylesheet');
const backendControl = read('dist/backend-control-workspace.js');
for (const inventory of ['/hermes/openapi.json', '/cli-operations', '/cli-jobs']) {
  assert.ok(backendControl.includes(inventory), `Control Center is missing ${inventory}`);
}
assert.ok(backendControl.includes("String(path).startsWith('/api')") && backendControl.includes("source: 'workflow'"), 'Control Center does not represent native, access, and host workflow operations');
new vm.Script(read('dist/settings-workspace.js'), {filename:'settings-workspace.js'});
assert.ok(existsSync(path.join(root, 'dist/settings-workspace.css')), 'Missing Profiles & Settings workspace stylesheet');
new vm.Script(read('dist/system-workspace.js'), {filename:'system-workspace.js'});
new vm.Script(read('dist/observability-workspace.js'), {filename:'observability-workspace.js'});
assert.ok(existsSync(path.join(root, 'dist/system-workspace.css')), 'Missing System workspace stylesheet');
assert.ok(existsSync(path.join(root, 'dist/observability-workspace.css')), 'Missing Observability workspace stylesheet');
const kanbanScreen = read('dist/kanban.html');
const kanbanRuntime = read('dist/kanban-workspace.js');
assert.ok(existsSync(path.join(root, 'dist/kanban-workspace.css')), 'Missing Kanban workspace stylesheet');
assert.ok(kanbanScreen.includes('id="shared-header"') && kanbanScreen.includes('id="shared-sidebar"'), 'Kanban is missing the shared shell hosts');
assert.ok(kanbanScreen.includes('window.currentPage="kanban"') && kanbanScreen.includes('kanban-workspace.js'), 'Kanban screen registration is incomplete');
new vm.Script(kanbanRuntime, {filename:'kanban-workspace.js'});
for (const operation of ['/boards', '/board', '/stats', '/workflow', '/orchestration', '/profiles', '/model-options', '/tasks', '/comments', '/links', '/attachments', '/estimate', '/decompose', '/specify', '/reassign', '/reclaim', '/runs', '/workers/active', '/dispatch']) {
  assert.ok(kanbanRuntime.includes(operation), `Kanban workspace is missing ${operation}`);
}
assert.ok(kanbanRuntime.includes('state.workflow.columns') && kanbanRuntime.includes('state.workflow.manual'), 'Kanban columns and moves must come from the server workflow');
assert.ok(!/placeholder card|sample card|mock task|demo task/i.test(kanbanRuntime), 'Kanban must not contain placeholder task data');
const settingsWorkspace = read('dist/runtime-config-settings.html');
const settingsRuntime = read('dist/settings-workspace.js');
assert.ok(settingsRuntime.includes('function settingDescription') && settingsRuntime.includes('setting-technical'), 'Settings do not provide plain-language descriptions with optional technical details');
assert.ok(settingsRuntime.includes('dataset.format="lines"') && settingsRuntime.includes('dataset.format==="lines"'), 'Primitive list settings are not presented as line-based editors');
assert.ok(!settingsRuntime.includes('key.className="setting-path"'), 'Raw config keys are still exposed as primary setting labels');
const liveRuntime = read('dist/hermes-client.js');
const controlPlaneRuntime = read('server/judge-m-control-plane/dashboard/plugin_api.py');
assert.ok(controlPlaneRuntime.includes('HERMES_COCKPIT_PORTAL_URL') && controlPlaneRuntime.includes('HERMES_COCKPIT_LINKS_JSON'), 'Control plane is missing portable portal and service-link configuration');
assert.ok(!/192\.168\.\d+\.\d+/.test(controlPlaneRuntime), 'Control plane contains a private installation address');
assert.ok(liveRuntime.includes('data-inspector-tab="browser"') && liveRuntime.includes('gateway().call("browser.preview"') && liveRuntime.includes('use_real_profile'), 'Live chat is missing the native browser preview or privacy control');
assert.ok(controlPlaneRuntime.includes('@router.get("/browser-preview")') && controlPlaneRuntime.includes('Page.captureScreenshot') && controlPlaneRuntime.includes('_BROWSER_PREVIEW_SALT'), 'Control plane is missing the authenticated CDP frame adapter');
assert.ok(liveRuntime.includes('data-inspector-tab="routing"') && liveRuntime.includes('/semantic-routing/decisions') && liveRuntime.includes('semanticSessionParams'), 'Live chat is missing primary semantic routing or its decision inspector');
assert.ok(controlPlaneRuntime.includes('@router.put("/semantic-routing")') && controlPlaneRuntime.includes('@router.post("/semantic-routing/decide")'), 'Control plane is missing native semantic-routing APIs');
for (const route of ['/semantic-routing/metrics', '/semantic-routing/escalate', '/semantic-routing/verify', '/semantic-routing/outcome']) {
  assert.ok(controlPlaneRuntime.includes(route), `Control plane is missing ${route}`);
}
const modelWorkspace = read('dist/models-providers.html');
assert.ok(modelWorkspace.includes('id="semantic-enabled"') && modelWorkspace.includes('Semantic Auto') && modelWorkspace.includes('data-model-routing'), 'Models workspace is missing routing policy, slot modes, or eligibility controls');
for (const control of ['semantic-default-mode', 'semantic-tool-provider', 'semantic-memory-provider', 'semantic-shadow-provider', 'semantic-escalation', 'semantic-verification', 'semantic-cache']) {
  assert.ok(modelWorkspace.includes(`id="${control}"`), `Models workspace is missing ${control}`);
}
assert.ok(!modelWorkspace.includes(':8700/'), 'Models workspace still delegates semantic routing to an external dashboard');
const routingRuntime = read('server/judge-m-control-plane/semantic_routing.py');
assert.ok(routingRuntime.includes('ROUTER_TASK = "judge_m_semantic_router"') && routingRuntime.includes('def route_tools') && routingRuntime.includes('def route_memory') && routingRuntime.includes('def evaluate_escalation') && routingRuntime.includes('def verify_output') && routingRuntime.includes('prompt_fingerprint'), 'Runtime plugin is missing decision-model recursion protection, resource routing, bounded evaluation, or redacted traces');
assert.ok(read('server/hermes-runtime-patches/semantic-routing-hooks.patch').includes('MODEL_ROUTE_MIDDLEWARE'), 'Hermes subagent/auxiliary model-routing seam is not tracked');
assert.ok(read('server/hermes-runtime-patches/semantic-routing-memory-hooks.patch').includes('MEMORY_ROUTE_MIDDLEWARE'), 'Hermes memory-routing seam is not tracked');
for (const operation of ['/profiles', '/profiles/active', '/setup-command', '/soul', '/description', '/describe-auto', '/export', '/profiles/import', '/config/schema', '/config/defaults', '/config/raw']) {
  assert.ok(settingsRuntime.includes(operation), `Profiles & Settings is missing ${operation}`);
}
assert.ok(settingsWorkspace.includes('id="panel-identity"') && settingsWorkspace.includes('id="panel-settings"') && settingsWorkspace.includes('id="panel-controls"') && settingsWorkspace.includes('id="panel-advanced"'), 'Manage workspace sections are incomplete');
assert.ok(settingsWorkspace.includes('backend-control-workspace.js') && settingsWorkspace.includes('id="operationWorkspace"'), 'Manage is missing the unified action workspace');
assert.ok(!settingsRuntime.includes('localStorage'), 'Profiles & Settings must not persist profile data or secrets in localStorage');
assert.ok(existsSync(path.join(root, 'dist/shell-data.js')), 'Missing embedded shell data');
const shell = JSON.parse(read('dist/shell.json'));
assert.ok(shell.header.includes('Hermes Cockpit'));
assert.ok(shell.header.includes('src="assets/hermes-aviator-girl.jpg"'));
assert.ok(existsSync(path.join(root, 'dist/assets/hermes-aviator-girl.jpg')), 'Missing vendored Hermes Aviator Girl asset');
for (const asset of ['dist/vendor/tailwindcss-cdn.js', 'dist/vendor/tailwindcss-cdn-forms.js', 'dist/vendor/fonts.css', 'dist/vendor/material-symbols.css', 'dist/vendor/xterm/xterm.js', 'dist/vendor/xterm/xterm.css', 'dist/vendor/xterm/LICENSE']) {
  assert.ok(existsSync(path.join(root, asset)), `Missing vendored runtime asset: ${asset}`);
}
for (const releaseFile of ['compose.yaml', '.env.example', 'deploy/nginx.conf.template', 'scripts/install-hermes-extension.sh', 'docs/INSTALL.md', 'docs/CONFIGURATION.md', 'docs/UPGRADING.md', 'docs/COMPATIBILITY.md', 'docs/DEVELOPMENT.md', 'docs/RELEASE-CHECKLIST.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'VERSION']) {
  assert.ok(existsSync(path.join(root, releaseFile)), `Missing public-release file: ${releaseFile}`);
}
for (const licenseFile of ['LICENSES/tailwindcss-MIT.txt', 'LICENSES/inter-OFL-1.1.txt', 'LICENSES/jetbrains-mono-OFL-1.1.txt', 'LICENSES/material-symbols-Apache-2.0.txt', 'dist/vendor/xterm/LICENSE']) {
  assert.ok(existsSync(path.join(root, licenseFile)), `Missing vendored dependency license: ${licenseFile}`);
}
assert.ok(read('scripts/run-cli-bridge-validation.py').includes('HERMES_SOURCE') && !read('scripts/run-cli-bridge-validation.py').includes('/tmp/cli_bridge.py'), 'CLI bridge validator is not portable');
const readme = read('README.md');
assert.ok(readme.includes('dist/assets/hermes-aviator-girl.jpg') && readme.includes('./scripts/bootstrap.sh'), 'README is missing the branded hero or quick start');
const live = read('dist/live-control.html');
assert.ok(live.includes('data-hermes-client="true"') && live.includes('data-hermes-base="/hermes"'), 'Live Control is missing Hermes client configuration');
assert.ok(live.includes('hermes-client.js') && live.includes('vendor/xterm/xterm.js'), 'Live Control is missing its runtime');
const botMode = read('dist/bot-mode.html');
assert.ok(botMode.includes('data-client-mode="bot"') && botMode.includes('hermes-client.js'), 'Bot Mode is missing its dedicated live chat runtime');
assert.ok(read('dist/hermes-client.js').includes('/api/auth/ws-ticket'), 'Live client is missing the secure WebSocket ticket flow');
assert.ok(!read('dist/hermes-client.js').includes('localStorage'), 'Live client must not persist credentials or controls in localStorage');
assert.ok(!/beta/i.test(read('dist/hermes-client.js')) && !/beta/i.test(read('dist/shell.js')), 'Shared live UI still contains beta labeling');
for (const screen of navigationScreens) assert.ok(read('dist/shell.js').includes(`path: "${screen}"`), `Shared shell is missing ${screen} navigation`);
assert.ok(!read('dist/shell.js').includes('path: "backend-control"') && !read('dist/shell.js').includes('path: "cli-control"'), 'Redundant Capabilities or CLI navigation is still exposed');
const systemScreen = read('dist/mesh-topology.html');
assert.ok(!systemScreen.includes('Observed path') && !systemScreen.includes('Recent activity') && !systemScreen.includes('Nothing here is simulated.'), 'System still contains removed low-value panels or preview copy');
assert.ok(read('dist/index.html').includes('url=live-control.html') && read('dist/index.html').includes('<title>Hermes Cockpit</title>'), 'Static entry point is missing the product title or redirect');
const inventory = JSON.parse(read('CAPABILITY-INVENTORY.json'));
assert.equal(inventory.counts.cliTopLevelCommands, 72, 'Unexpected top-level CLI command count');
assert.equal(inventory.counts.cliCanonicalCommandNodes, 422, 'Unexpected canonical CLI node count');
assert.equal(inventory.counts.cliLeafCommands, 370, 'Unexpected CLI leaf count');
assert.equal(inventory.counts.cliAliases, 45, 'Unexpected CLI alias count');
assert.equal(inventory.counts.cliOptions, 1265, 'Unexpected CLI option count');
assert.equal(inventory.counts.apiOperations, 348, 'Unexpected OpenAPI operation count');
assert.equal(inventory.counts.apiControlOperations, 337, 'Unexpected control operation count');
assert.equal(inventory.counts.apiAccessOrShellOperations, 11, 'Unexpected access/web-shell operation count');
assert.equal(inventory.cliFamilies.length, inventory.counts.cliTopLevelCommands, 'Every CLI family must have a reviewed API classification');
assert.equal(new Set(inventory.cliCommands.map(command => command.path)).size, inventory.cliCommands.length, 'Duplicate canonical CLI paths');
assert.equal(new Set(inventory.apiOperations.map(operation => `${operation.method} ${operation.path}`)).size, inventory.apiOperations.length, 'Duplicate API operations');
assert.ok(read('CAPABILITY-INVENTORY.md').includes('| `login` |'), 'Human-readable inventory is missing the login command');
assert.ok(backendControl.includes('collectApiOperations') && backendControl.includes('Object.entries(spec.paths || {})'), 'Control Center does not inventory every published schema operation');
const bridge = read('server/judge-m-control-plane/dashboard/cli_bridge.py');
const countBridgeSet = name => {
  const match = bridge.match(new RegExp(`${name} = \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${name} is missing`);
  return [...match[1].matchAll(/^\s+"[^"]+",$/gm)].length;
};
assert.equal(countBridgeSet('CLI_ONLY_COMMANDS'), 43, 'Unexpected native CLI-only operation count');
assert.equal(countBridgeSet('PARTIAL_API_GAP_COMMANDS'), 127, 'Unexpected partial-family bridge operation count');
assert.ok(bridge.includes('ALLOWED_COMMANDS = CLI_ONLY_COMMANDS | PARTIAL_API_GAP_COMMANDS'), 'CLI bridge registries are not composed into one allowlist');
for (const command of ['auth priority', 'profile install', 'sessions recover', 'skills snapshot import', 'skills update', 'mcp serve']) {
  assert.ok(bridge.includes(`"${command}",`), `CLI bridge is missing ${command}`);
}
assert.ok(bridge.includes('create_subprocess_exec') && !bridge.includes('shell=True'), 'CLI bridge must execute argv directly');
assert.ok(bridge.includes('termios.ECHO') && bridge.includes('_owner_key'), 'CLI bridge is missing PTY or owner isolation');
assert.ok(read('dist/cli-control.html').includes('/cli-operations') && read('dist/cli-control.html').includes('/cli-jobs'), 'Advanced Controls is missing bridge integration');
const releaseVersion = read('VERSION').trim();
assert.match(releaseVersion, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'VERSION is not semantic');
assert.ok(read('server/judge-m-control-plane/plugin.yaml').includes(`version: ${releaseVersion}`), 'plugin.yaml version differs from VERSION');
assert.equal(JSON.parse(read('server/judge-m-control-plane/dashboard/manifest.json')).version, releaseVersion, 'Dashboard manifest version differs from VERSION');
assert.equal(JSON.parse(read('package.json')).version, releaseVersion, 'package.json version differs from VERSION');
console.log(`PASS: ${provenance.files.length} baseline hashes; ${intentional.size} intentional source changes; ${screens.length} screens; local references and runtime assets; ${inlineScripts} inline scripts and shared shell syntax; vendored cockpit girl asset; blank password defaults.`);
