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
}
assert.match(reportOnly.value, /\brequire-trusted-types-for 'script'/, 'report-only policy must stage Trusted Types');
assert.match(reportOnly.value, /\breport-uri \/__csp-report\b/, 'report-only policy must have a local report sink');
assert.match(template, /location = \/__csp-report\s*\{[\s\S]*?return 204;/, 'local CSP report sink is missing');
console.log('PASS: enforced and report-only CSP policies include baseline directives, no unsafe-eval, and staged Trusted Types.');
