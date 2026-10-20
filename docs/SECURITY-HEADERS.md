# Browser security headers

Hermes Cockpit ships a CSP baseline in `deploy/nginx.conf.template`. It is
designed for the current static app: all assets are same-origin, WebSocket
connections are permitted for the same deployment, and the existing inline
runtime is allowed while it is being migrated to nonce- or hash-based scripts.
`unsafe-eval` is not permitted.

The template also sends a report-only policy with `require-trusted-types-for
'script'`. This is deliberately report-only because the current UI still uses
DOM string templates and `innerHTML` in several workspaces. Use the browser
console and the local `/__csp-report` response path to find violations before
turning Trusted Types enforcement on. The local sink returns `204` and does
not persist report bodies or credentials.

For installations that need retained trend data, an operator can route CSP
reports at the edge to a service such as Cloudflare Page Shield (Client-Side
Security) or Report URI. Configure that outside this repository, after
reviewing the provider's data-retention and access policy. Do not include
credentials, cookies, full page URLs, prompts, or report samples in public
configuration or issue reports.

Run `node scripts/check-csp.mjs` after changing the proxy template. The check
is also part of `node scripts/check.mjs` and fails if either policy loses a
baseline directive or accidentally enables `unsafe-eval`.
