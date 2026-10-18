import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
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
const screens = ['live-control', 'models-providers', 'mesh-topology', 'tool-registry', 'acp-telemetry', 'runtime-config-settings', 'backend-control', 'cli-control'];
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
assert.ok(existsSync(path.join(root, 'dist/shell-data.js')), 'Missing embedded shell data');
const shell = JSON.parse(read('dist/shell.json'));
assert.ok(shell.header.includes('Hermes Cockpit'));
assert.ok(shell.header.includes('src="assets/hermes-aviator-girl.jpg"'));
assert.ok(existsSync(path.join(root, 'dist/assets/hermes-aviator-girl.jpg')), 'Missing vendored Hermes Aviator Girl asset');
for (const asset of ['dist/vendor/tailwindcss-cdn.js', 'dist/vendor/tailwindcss-cdn-forms.js', 'dist/vendor/fonts.css', 'dist/vendor/material-symbols.css', 'dist/vendor/xterm/xterm.js', 'dist/vendor/xterm/xterm.css', 'dist/vendor/xterm/LICENSE']) {
  assert.ok(existsSync(path.join(root, asset)), `Missing vendored runtime asset: ${asset}`);
}
const live = read('dist/live-control.html');
assert.ok(live.includes('data-hermes-client="true"') && live.includes('data-hermes-base="/hermes"'), 'Live Control is missing Hermes client configuration');
assert.ok(live.includes('hermes-client.js') && live.includes('vendor/xterm/xterm.js'), 'Live Control is missing its runtime');
assert.ok(read('dist/hermes-client.js').includes('/api/auth/ws-ticket'), 'Live client is missing the secure WebSocket ticket flow');
assert.ok(!read('dist/hermes-client.js').includes('localStorage'), 'Live client must not persist credentials or controls in localStorage');
for (const screen of screens) assert.ok(read('dist/shell.js').includes(`path: "${screen}"`), `Shared shell is missing ${screen} navigation`);
assert.ok(read('dist/index.html').includes('url=live-control.html'));
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
assert.ok(read('dist/backend-control.html').includes('countSchemaOperations'), 'Control Center does not disclose full schema operation count');
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
assert.ok(read('server/judge-m-control-plane/dashboard/manifest.json').includes('"version": "0.3.0"'), 'Unexpected control-plane plugin version');
console.log(`PASS: ${provenance.files.length} baseline hashes; ${intentional.size} intentional source changes; ${screens.length} screens; local references and runtime assets; ${inlineScripts} inline scripts and shared shell syntax; vendored cockpit girl asset; blank password defaults.`);
