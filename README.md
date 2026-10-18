# Hermes Cockpit

Hermes Cockpit is a mobile-friendly browser interface for [Hermes Agent](https://github.com/NousResearch/hermes-agent). It connects directly to a running Hermes server, so you can chat, switch models, resume sessions, manage tools, and use Hermes Bot Mode without streaming a desktop through VNC or opening the official Hermes web interface.

![Status: early integration](https://img.shields.io/badge/status-early%20integration-EBCB8B)

## What works

- Live Hermes chat over the native `/api/pty` WebSocket
- Automatic reconnect with a keep-alive terminal session
- Resume recent Hermes sessions
- Use any model returned by Hermes' model catalog
- Add model providers through OAuth, API keys, or custom OpenAI-compatible endpoints without editing configuration files
- Validate provider credentials and endpoints before saving them to Hermes
- Curate the model picker with per-model visibility and friendly labels
- Assign main and auxiliary/subagent models per Hermes profile
- Launch the matching native vLLM Semantic Router control plane from the Models workspace when it is deployed
- Real Bot Mode roster from Hermes' gateway protocol, including the same profile metadata used by Hermes Desktop
- Resume each bot's canonical hidden `Bot Chat`, including its existing conversation history, or create it when one does not exist
- Native Bot Mode transcript with independently scrollable conversation, live task state, subagent status, and tool activity from Hermes gateway events
- Keyboard input, mobile composer input, terminal selection, copy, and paste
- Hermes' existing sign-in flow; Cockpit does not store provider credentials
- Responsive desktop and mobile layouts
- Live views for Hermes health, profiles, sessions, system statistics, tools, toolsets, skills, and model options
- Native Cockpit controls for enabling toolsets and skills, adding/testing/enabling/deleting MCP servers, and creating/editing eligible skills
- Full schema-driven Hermes configuration editor, including every field published by `/api/config/schema`
- Per-profile active selection, model assignment, routing description, and `SOUL.md` editing
- Automatic redaction of credential-like fields in raw API inspectors and copied telemetry snapshots
- Typed Advanced Controls for all 43 executable paths in the 22 genuinely CLI-only Hermes families
- Authenticated, user-scoped command jobs with bounded output, destructive-action confirmations, interactive responses, stop controls, and reload-safe job reattachment

Hermes Cockpit follows a strict coverage rule: every user-facing capability exposed by the installed Hermes backend or `hermes` CLI must have a real Cockpit surface, and every Cockpit control must call a real operation. CLI-only capabilities must be implemented through a narrowly allowlisted server-side bridge—not a browser-accessible shell. Missing coverage is tracked as unfinished work in [BACKEND-COVERAGE.md](BACKEND-COVERAGE.md); it is not represented with invented data or dead controls.

## Requirements

- A current Hermes Agent installation with `hermes serve` or the equivalent dashboard service running
- A reverse proxy that serves Cockpit and Hermes from the same browser origin
- Node.js 18 or newer only if you want to run the local preview/check scripts

The tested configuration uses Hermes `0.21.7`. Older releases may not expose the same browser API.

## Try the interface locally

```sh
node scripts/serve.mjs
```

Open [http://127.0.0.1:4174](http://127.0.0.1:4174). The design and navigation work locally, but live chat requires a same-origin Hermes proxy at `/hermes`.

Run the repository checks with:

```sh
node scripts/check.mjs
```

## Deploy with nginx

Copy the contents of `dist/` to your web server, then serve it under `/cockpit/` and proxy `/hermes/` to the Hermes dashboard. This example assumes Hermes listens on `192.168.1.50:9119`:

```nginx
location /cockpit/ {
    alias /srv/hermes-cockpit/;
    try_files $uri $uri/ /cockpit/live-control.html;
}

location /hermes/ {
    proxy_pass http://192.168.1.50:9119/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /hermes;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}
```

Open `/hermes/login` once to establish the Hermes session, then use `/cockpit/live-control.html`. The `/hermes/` proxy is required for authentication and API traffic, but normal operation stays inside Cockpit. Cockpit requests a short-lived, single-use WebSocket ticket for every connection and never asks for or saves your Hermes password, OAuth token, model API key, or provider credentials.

### Use a different Hermes path

Live Control defaults to `/hermes`. Change the `data-hermes-base` value on the `<body>` element in `dist/live-control.html` if your reverse proxy uses another same-origin path:

```html
<body data-hermes-client="true" data-hermes-base="/my-hermes-path">
```

## How sessions behave

Cockpit keeps a random terminal attachment ID in browser session storage. This lets a chat survive a page refresh in the same browser tab without storing credentials. Saved conversations remain in Hermes and are available from the Recent Sessions panel.

Selecting a different model sends Hermes' native `/model` command to the current chat. Opening a Bot Mode entry resolves the same canonical `Bot Chat` session used by Hermes Desktop and resumes its real transcript. It does not rewrite provider configuration or expose provider secrets to the page.

## Security notes

- Put Hermes behind HTTPS and authentication before exposing it beyond localhost.
- Keep Cockpit and Hermes on the same trusted origin so Hermes' secure session cookie can protect the API.
- Do not replace the WebSocket ticket flow with a long-lived token in JavaScript.
- The repository contains no credentials. The vendored xterm runtime is included under its MIT license.

## Repository layout

- `dist/live-control.html` — live Hermes terminal and controls
- `dist/models-providers.html` — provider onboarding, model catalog curation, profile assignments, and Semantic Router access
- `dist/hermes-client.js` — Hermes REST/WebSocket client
- `dist/hermes-client.css` — responsive live-client styles
- `dist/mesh-topology.html` — live Hermes reachability, gateway/profile, session, and system overview
- `dist/tool-registry.html` — live MCP server, toolset, skill, and profile inventory with native management controls
- `dist/acp-telemetry.html` — live read-only endpoint telemetry and redacted snapshots
- `dist/runtime-config-settings.html` — full schema-driven configuration, model, profile, and identity management
- `dist/backend-control.html` — plain-language Control Center that keeps every installed Hermes REST operation available as normal fields and actions, with API details collapsed by default
- `dist/cli-control.html` — typed Advanced Controls for the reviewed CLI-only operation registry; it never exposes an arbitrary command prompt
- `server/judge-m-control-plane/` — Hermes dashboard plugin extension that mounts the authenticated, allowlisted command bridge
- `BACKEND-COVERAGE.md` — backend-to-interface coverage ledger and acceptance rule
- `CLI-COVERAGE.md` — installed Hermes command coverage summary and secure bridge requirements
- `CAPABILITY-INVENTORY.md` — generated human-readable list of all 422 canonical CLI command nodes and all 348 OpenAPI operations
- `CAPABILITY-INVENTORY.json` — machine-readable command signatures, API signatures, counts, and reviewed family-level overlap
- `scripts/build-capability-inventory.mjs` — reproducible inventory generator; fails when a new CLI family has not been reviewed
- `scripts/serve.mjs` — loopback-only preview server
- `scripts/check.mjs` — source, syntax, and asset checks
- `scripts/validate-cli-bridge.py` — in-container bridge, parser, redaction, path-policy, and route-mount smoke test

## Project status

This is an independent community frontend and is not affiliated with or endorsed by Nous Research or the Hermes team. The tested Hermes `0.21.7` schema contains 348 operations: 337 authenticated `/api` controls plus 11 login, OAuth, asset, and SPA-shell operations. All 337 controls are reachable through Cockpit; the access routes are used by the sign-in and web-shell flows rather than misrepresented as settings. The installed CLI has 72 top-level command families and 422 canonical command/subcommand nodes. The reviewed overlap is 22 direct API families, 21 partial API families, 5 generic config/env equivalents, 2 gateway/WebSocket families, and 22 genuinely CLI-only families. Advanced Controls registers 170 typed, allowlisted operation paths: 43 paths from the 22 genuinely CLI-only families plus 127 missing paths from 22 partial or generic API families. Purpose-built workflow quality remains tracked separately from command-path availability.
