import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const template = readFileSync(path.join(root, 'deploy/nginx.conf.template'), 'utf8');
const headers = [...template.matchAll(/add_header\s+(Content-Security-Policy(?:-Report-Only)?)\s+"([^"]+)"\s+always;/g)]
  .map(([, name, value]) => ({name, value}));
const enforced = headers.find(header => header.name === 'Content-Security-Policy');
const reportOnly = headers.find(header => header.name === 'Content-Security-Policy-Report-Only');
assert.ok(enforced, 'missing enforced Content-Security-Policy header');
assert.ok(reportOnly, 'missing staged Content-Security-Policy-Report-Only header');

const required = ['default-src', 'base-uri', 'object-src', 'frame-ancestors', 'form-action', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src'];
for (const header of [enforced, reportOnly]) {
  for (const directive of required) assert.match(header.value, new RegExp(`(?:^|;)\\s*${directive}\\s`), `${header.name} is missing ${directive}`);
  assert.doesNotMatch(header.value, /\bunsafe-eval\b/, `${header.name} enables unsafe-eval`);
  assert.doesNotMatch(header.value, /script-src[^;]*\bunsafe-inline\b/, `${header.name} allows inline scripts`);
  assert.doesNotMatch(header.value, /connect-src[^;]*(?:\sws:|\swss:)/, `${header.name} allows cross-origin WebSocket schemes`);
}
for (const file of ['dist/acp-telemetry.html', 'dist/backend-control.html', 'dist/bot-mode.html', 'dist/cli-control.html', 'dist/kanban.html', 'dist/live-control.html', 'dist/mesh-topology.html', 'dist/models-providers.html', 'dist/runtime-config-settings.html', 'dist/tool-registry.html']) {
  const html = readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${file} contains an inline script`);
}
assert.match(reportOnly.value, /\brequire-trusted-types-for 'script'/, 'report-only policy must stage Trusted Types');
assert.match(reportOnly.value, /\breport-uri \/__csp-report\b/, 'report-only policy must have a local report sink');
assert.match(template, /location = \/__csp-report\s*\{[\s\S]*?return 204;/, 'local CSP report sink is missing');
console.log('PASS: CSP blocks inline scripts and cross-origin WebSocket schemes, includes baseline directives, and stages Trusted Types.');
