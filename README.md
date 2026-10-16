# Hermes Cockpit

Hermes Cockpit is a mobile-friendly browser interface for [Hermes Agent](https://github.com/NousResearch/hermes-agent). It connects directly to a running Hermes dashboard, so you can use a real Hermes terminal, switch models, and resume sessions without streaming an entire desktop through VNC.

![Status: early integration](https://img.shields.io/badge/status-early%20integration-EBCB8B)

## What works

- Live Hermes chat over the native `/api/pty` WebSocket
- Automatic reconnect with a keep-alive terminal session
- Resume recent Hermes sessions
- Use any model returned by Hermes' model catalog
- Bot Mode roster backed by Hermes agent profiles, including each profile's title, model, and gateway state
- Start a dedicated chat as any Hermes bot/profile
- Keyboard input, mobile composer input, terminal selection, copy, and paste
- Hermes' existing sign-in flow; Cockpit does not store provider credentials
- Responsive desktop and mobile layouts

The Live Control screen is connected to Hermes. Bot Mode group rooms, routines, avatar editing, and cross-machine roster merging are not ported yet. Mesh Topology, Tool Registry, ACP Telemetry, and Runtime Settings are still visual prototypes and are clearly sample data until their integrations are completed.

## Requirements

- A current Hermes Agent installation with `hermes dashboard` running
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

Open `/hermes/login`, sign in, and then open `/cockpit/live-control.html`. Cockpit requests a short-lived, single-use WebSocket ticket from Hermes for every connection. It never asks for or saves your Hermes password, OAuth token, model API key, or provider credentials.

### Use a different Hermes path

Live Control defaults to `/hermes`. Change the `data-hermes-base` value on the `<body>` element in `dist/live-control.html` if your reverse proxy uses another same-origin path:

```html
<body data-hermes-client="true" data-hermes-base="/my-hermes-path">
```

## How sessions behave

Cockpit keeps a random terminal attachment ID in browser session storage. This lets a chat survive a page refresh in the same browser tab without storing credentials. Saved conversations remain in Hermes and are available from the Recent Sessions panel.

Selecting a different model sends Hermes' native `/model` command to the current chat. Selecting an agent profile affects the next new session. It does not rewrite provider configuration or expose provider secrets to the page.

## Security notes

- Put Hermes behind HTTPS and authentication before exposing it beyond localhost.
- Keep Cockpit and Hermes on the same trusted origin so Hermes' secure session cookie can protect the API.
- Do not replace the WebSocket ticket flow with a long-lived token in JavaScript.
- The repository contains no credentials. The vendored xterm runtime is included under its MIT license.

## Repository layout

- `dist/live-control.html` — live Hermes terminal and controls
- `dist/hermes-client.js` — Hermes REST/WebSocket client
- `dist/hermes-client.css` — responsive live-client styles
- `dist/mesh-topology.html` — topology prototype
- `dist/tool-registry.html` — tool registry prototype
- `dist/acp-telemetry.html` — telemetry prototype
- `dist/runtime-config-settings.html` — settings prototype
- `scripts/serve.mjs` — loopback-only preview server
- `scripts/check.mjs` — source, syntax, and asset checks

## Project status

This is an independent community frontend and is not affiliated with or endorsed by Nous Research or the Hermes team. The current milestone is a dependable single-install Hermes client. Multi-host orchestration and Docker-agent lifecycle management are planned separately and should not be inferred from the remaining prototype screens.
