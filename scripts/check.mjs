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
const screens = ['live-control', 'mesh-topology', 'tool-registry', 'acp-telemetry', 'runtime-config-settings'];
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
    if (/^(?:https?:|data:|javascript:)/.test(ref)) continue;
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
assert.ok(read('dist/shell.js').includes('window.__HERMES_SHELL__'), 'Missing file-mode shell fallback');
assert.ok(existsSync(path.join(root, 'dist/shell-data.js')), 'Missing embedded shell data');
const shell = JSON.parse(read('dist/shell.json'));
assert.ok(shell.header.includes('Hermes Cockpit'));
assert.ok(shell.header.includes('src="assets/hermes-aviator-girl.jpg"'));
assert.ok(existsSync(path.join(root, 'dist/assets/hermes-aviator-girl.jpg')), 'Missing vendored Hermes Aviator Girl asset');
for (const asset of ['dist/vendor/tailwindcss-cdn.js', 'dist/vendor/tailwindcss-cdn-forms.js', 'dist/vendor/fonts.css', 'dist/vendor/material-symbols.css']) {
  assert.ok(existsSync(path.join(root, asset)), `Missing vendored runtime asset: ${asset}`);
}
for (const screen of screens) assert.ok(shell.aside.includes(`data-path="${screen}"`));
assert.ok(read('dist/index.html').includes('url=live-control.html'));
console.log(`PASS: ${provenance.files.length} baseline hashes; ${intentional.size} intentional source changes; ${screens.length} screens; local references and runtime assets; ${inlineScripts} inline scripts and shared shell syntax; vendored cockpit girl asset; blank password defaults.`);
