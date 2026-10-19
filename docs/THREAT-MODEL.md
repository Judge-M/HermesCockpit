# Hermes Cockpit threat model

This document defines the security assumptions and review boundaries for
Hermes Cockpit. It is a living engineering model, not evidence of a penetration
test, independent review, or security certification.

## System and trust boundaries

A typical deployment has four relevant layers:

1. The user's browser loads static Cockpit assets from `/cockpit/`.
2. A reverse proxy serves those assets and proxies `/hermes/` to the Hermes
   dashboard on the same public origin.
3. Hermes authenticates HTTP and WebSocket requests and mounts the Cockpit
   control-plane plugin inside its authenticated dashboard API.
4. The Hermes service account can read Hermes state, run the allowlisted CLI
   bridge, and communicate with the isolated or real-profile Chromium process.

The intended browser boundary is one HTTPS origin. Cockpit does not establish a
second login system and must not bypass Hermes' session validation. The reverse
proxy, Hermes process, plugin files, runtime patches, service account, and host
filesystem are trusted computing-base components. Provider APIs, fetched web
content, MCP servers, skills, plugins, model output, imported archives, Git
repositories, and browser pages are untrusted inputs.

## Assets to protect

- Hermes authentication cookies, WebSocket tickets, OAuth state, and provider
  credentials;
- conversations, prompts, tool arguments/results, memory, artifacts, and logs;
- CLI job input, output, process control, and filesystem effects;
- isolated browser state and copied real-browser profiles;
- live browser frames, which may display authenticated or sensitive pages;
- model-routing configuration and decision metadata;
- Hermes source, Cockpit plugin code, and applied runtime patches; and
- host integrity and availability.

## Security goals

- An unauthenticated browser cannot use Cockpit-backed Hermes APIs or sockets.
- One authenticated user cannot read or control another user's resources merely
  by guessing an identifier.
- Browser input cannot become arbitrary shell syntax, an unreviewed CLI action,
  or an unrestricted filesystem path.
- Sensitive values are not placed in static assets, URLs, durable browser
  storage, public diagnostics, or cross-user caches.
- Browser automation does not expose CDP/DevTools or silently use a personal
  profile.
- A reverse proxy cannot be tricked into trusting client-selected scheme, host,
  identity, or internal routing metadata.
- Runtime patches and dependencies are reviewable, reproducible inputs with a
  rollback path.

## Threats and required controls

### Same-origin authentication

Cockpit relies on Hermes authentication; a network allowlist or private VPN is
not a substitute. Static Cockpit assets and proxied Hermes routes should share
one HTTPS origin so the browser applies one intentional session boundary and
WebSocket policy. Direct backend ports must not be publicly reachable.

Every plugin endpoint inherits Hermes' authenticated dashboard middleware. New
routes must be verified under the deployed prefix for logged-out, expired, and
authenticated requests. Frontend code must not collect or persist raw Hermes
credentials. Authentication failures must fail closed instead of falling back
to anonymous or demo behavior.

### CSRF and origin assumptions

Same-origin hosting prevents ordinary cross-origin reads, but it does not by
itself prevent cross-site request forgery. Every state-changing request depends
on Hermes and the deployment enforcing an appropriate combination of
same-site/secure cookie policy, Origin or Referer validation, and/or an
unpredictable CSRF token. WebSocket handshakes require equivalent Origin and
ticket validation.

Contributors must not add permissive credentialed CORS, state changes through
GET, JSONP-style endpoints, or proxy rules that erase the information Hermes
uses for origin validation. Tests for new mutations should include a missing or
foreign Origin/CSRF context where the upstream framework exposes that control.
If the deployed Hermes version cannot provide this property, limit Cockpit to a
single trusted administrator and document the exception rather than claiming
multi-user safety.

### CLI bridge

The CLI bridge is intentionally not a shell. Its current design derives typed
arguments from the installed Hermes parser, permits only registered command
paths, inserts an option terminator before positionals, applies
command-specific path policies, requires explicit confirmation for high-risk
actions, and invokes an argument vector with `create_subprocess_exec`.

Key threats are parser drift, option injection, path escape, unsafe environment
inheritance, destructive actions without meaningful confirmation, interactive
prompt confusion, secret-bearing output, denial of service, and process escape.
Reviews must preserve direct argv execution, canonical path checks, bounded
output and timeouts, concurrency limits, process-group cancellation, terminal
echo suppression, and secret redaction. Redaction is fallible; raw output must
still be treated as sensitive and should not be retained longer than necessary.

### Multi-user job isolation

CLI jobs are keyed to a stable digest of the authenticated provider and subject
identity. List, detail, input, and cancellation operations must use that owner
key and return a non-enumerating response for another user's job. Email or other
mutable display fields must not define ownership. Job IDs, profile names,
session IDs, and preview IDs are locators, not authorization grants.

This isolation applies only to the CLI bridge. It does not prove that every
upstream Hermes session, profile, browser, plugin, or filesystem resource is
multi-tenant. In particular, any process-wide browser registry must be filtered
by a server-established authenticated owner; a caller-supplied session ID is
not sufficient. Until each enabled resource path has an enforced ownership
check and a negative cross-user test, deploy all users as one administrative
trust domain.

### Browser preview and personal profiles

The preview adapter captures compressed frames through Hermes' in-process
browser supervisor. CDP addresses, sockets, raw task keys, and copied-profile
paths must remain server-side. Opaque preview identifiers reduce accidental
disclosure but are not access control; authorization must be checked on every
metadata and frame request.

Frames can reveal passwords, personal data, session cookies rendered in a page,
or confidential application content. Responses must remain authenticated,
owner-scoped, bounded, and marked private/no-store. Shared caches must not store
them. CDP/DevTools ports must bind only to an isolated local interface or
process channel and must never pass through the public reverse proxy.

Isolated Chromium is the default trust boundary. Enabling a real browser
profile grants the agent access to that profile's active sessions and must
require an explicit, informed choice. Copied profiles and their temporary
directories are credentials: restrict permissions, avoid backups and logs, and
delete them when no longer required.

### Secrets and sensitive data

Provider keys, OAuth tokens, passwords, cookies, WebSocket tickets, vault
material, and browser profiles belong in Hermes' server-side credential
facilities. They must not appear in `dist/`, committed configuration, URL query
strings, issue templates, screenshots, analytics, routing traces, or browser
storage.

Sensitive input and command output should be minimized before logging and
redacted at every display boundary. Bound trace and cache sizes, avoid storing
complete prompts or tool outputs when metadata is enough, and clear process
memory/state on restart where feasible. Exports and diagnostic bundles require
the same review as logs because they may aggregate otherwise hidden data.

### Unprivileged service account and host access

Run Hermes and its plugin under a dedicated, unprivileged account. File and
directory ownership should prevent that account from reading unrelated home
directories, SSH material, container sockets, hypervisor APIs, or system
configuration. Do not grant passwordless sudo merely to make a CLI control
work.

Some allowlisted Hermes actions intentionally affect services, repositories, or
files. Enable only the operations the deployment needs, narrow their approved
roots, and use a separate privileged helper with an explicit policy if a host
operation truly requires elevation. A compromised model, skill, web page, or
MCP server must not inherit broader host permissions through Cockpit.

### Reverse proxy trust

Terminate TLS at a controlled proxy and keep the upstream Hermes listener on
loopback or a protected service network. The proxy must overwrite `Host`,
`X-Forwarded-Host`, `X-Forwarded-Proto`, and related forwarding headers rather
than passing client-selected values. Hermes should trust such headers only from
the known proxy address.

Preserve WebSocket upgrade behavior, authentication cookies, origin evidence,
and the expected `/hermes/` prefix. Do not cache authenticated API responses,
browser frames, event streams, or WebSocket traffic. Apply request-body and
timeout limits appropriate to uploads and long-running streams, and prevent
open-proxy behavior by keeping the upstream destination operator-controlled.

### Patch and dependency supply chain

Cockpit includes patches that modify supported Hermes runtime seams. A patch
has the authority of code in the Hermes process. Apply patches only from a
reviewed Cockpit commit to the documented Hermes version/commit, inspect the
exact diff, require a clean apply check, and keep a source backup or reversible
Git state. A failed or offset patch must stop installation; it must not be
forced onto an unknown tree.

Pin container images and automation dependencies to reviewed versions, and use
digests where operationally practical. Review vendored browser assets and
generated inventories when they change. Do not pipe remote scripts into a
shell or fetch executable plugin code from an unverified moving branch during
installation. Release artifacts should eventually have published checksums and
traceable source commits.

## Deployment review checklist

- [ ] Cockpit and Hermes are available through one HTTPS origin.
- [ ] Direct Hermes, plugin, CDP, and DevTools ports are not publicly exposed.
- [ ] Logged-out and expired sessions cannot reach HTTP or WebSocket controls.
- [ ] State-changing routes reject an invalid cross-origin/CSRF context.
- [ ] The proxy overwrites forwarding headers and Hermes trusts only that proxy.
- [ ] Hermes runs as a dedicated, unprivileged account with narrow file access.
- [ ] Provider secrets live only in server-side credential storage.
- [ ] Browser frames are private/no-store and preview access is owner-scoped.
- [ ] Negative tests prevent one user from viewing or controlling another
      user's jobs, sessions, browser previews, and artifacts.
- [ ] CLI actions remain typed and allowlisted, with direct argv execution.
- [ ] Runtime patches match the reviewed Cockpit and Hermes revisions and have
      a tested rollback path.
- [ ] Logs, exports, backups, and diagnostics have retention and access rules.

## Residual risk

Hermes Cockpit deliberately exposes powerful administration features. An
authenticated administrator, compromised Hermes process, malicious upstream
extension, or service-account takeover may still perform any action available
to the underlying Hermes installation and its operating-system permissions.
Model output and web content can also induce unsafe but authorized actions.
Least privilege, explicit confirmation, isolation, backups, and human review
remain necessary even when all controls above are present.
