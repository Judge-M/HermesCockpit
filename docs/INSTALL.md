# Install Hermes Cockpit

Hermes Cockpit has two parts:

1. a static browser application served by nginx;
2. a Hermes plugin that adds the browser preview, semantic routing, model-menu preferences, and the allowlisted CLI bridge.

The supported release target is Hermes Agent `0.21.7` on Linux with Docker Compose available for the web tier.

For the least surprising installation, use a tagged Hermes Cockpit release and
confirm the matching Hermes version in the [compatibility matrix](COMPATIBILITY.md).

## 1. Clone and configure

```sh
git clone https://github.com/Judge-M/HermesCockpit.git
cd HermesCockpit
cp .env.example .env
```

Edit `.env` and set `HERMES_UPSTREAM` to the dashboard origin nginx can reach. Do not include a trailing slash.

```dotenv
HERMES_UPSTREAM=http://host.docker.internal:9119
COCKPIT_PORT=8088
```

`host.docker.internal` is mapped to the Docker host by the included Compose file. Use a container DNS name or another private address when Hermes runs elsewhere.

## 2. Bootstrap Cockpit

The normal path installs the extension, starts the web container, and runs
diagnostics:

```sh
./scripts/bootstrap.sh
```

Use `./scripts/bootstrap.sh --dry-run` to perform compatibility preflight
without changing Hermes. Use `--no-start` when an existing proxy will serve the
web application.

## 3. Install only the Hermes extension

For a split deployment or manual web tier, run the extension installer on the
host that contains the Hermes installation:

```sh
./scripts/install-hermes-extension.sh
```

The installer uses these defaults:

- `HERMES_HOME=~/.hermes`
- `HERMES_SOURCE=~/.hermes/hermes-agent`
- plugin destination: `~/.hermes/plugins/judge-m-control-plane`

Override the paths when necessary:

```sh
HERMES_HOME=/srv/hermes \
HERMES_SOURCE=/srv/hermes/hermes-agent \
./scripts/install-hermes-extension.sh
```

The installer backs up an existing plugin and applies four runtime patches: model routing, memory routing, verified plugin owner context, and authenticated browser preview. If your Hermes source differs from `0.21.7`, it stops instead of forcing an incompatible patch. Use `--skip-patches` only for a deliberately reduced setup; runtime routing and live browser preview require the patches.

Restart the Hermes dashboard or `hermes serve` after installation.

## 4. Start the web application manually

```sh
docker compose up -d
```

Confirm the web tier:

```sh
curl --fail http://127.0.0.1:8088/healthz
```

Then open:

1. `http://HOST:8088/hermes/login` to authenticate;
2. `http://HOST:8088/cockpit/` to use Hermes Cockpit.

Cockpit and Hermes deliberately share one browser origin. Hermes' secure session cookie therefore protects the REST and WebSocket traffic without exposing credentials to Cockpit.

## HTTPS and Tailscale

For anything beyond a trusted local machine, put the Compose service behind HTTPS. A Tailscale Serve/Funnel configuration or an existing reverse proxy can terminate TLS and forward to port `8088`. Do not publish Chromium's CDP endpoint, the Hermes dashboard port, or model-provider credentials directly.

## Existing nginx deployment

If you do not want Docker, copy `dist/` to a static directory and use [`deploy/nginx.conf.template`](../deploy/nginx.conf.template) as the routing reference. Replace `${HERMES_UPSTREAM}` with the Hermes dashboard origin and reload nginx.

## Verify the integration

- The header should show `Hermes connected`.
- Chat should create or resume a real Hermes session.
- Manage → Actions should report the operations published by your server.
- Models should list the providers and model catalog from Hermes.
- Browser preview should remain empty until a Hermes browser tool is active.

If the UI loads but APIs fail, verify that `/hermes/openapi.json` is reachable through the same public origin and that the Hermes login cookie is present.

Run the bundled doctor after installation or whenever an upgrade behaves
unexpectedly:

```sh
./scripts/hermes-cockpit-doctor.sh
```

Doctor reports prerequisites, upstream compatibility, patch state, plugin
installation, and—when a public URL is supplied—HTTP routing health without
printing credentials.
