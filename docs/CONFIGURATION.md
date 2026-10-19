# Configuration reference

## Web container

| Variable | Default | Purpose |
| --- | --- | --- |
| `COCKPIT_PORT` | `8088` | Host port that publishes nginx. |
| `HERMES_UPSTREAM` | `http://host.docker.internal:9119` | Hermes dashboard origin reachable from nginx. Do not add a trailing slash. |

These values are read by `compose.yaml`. Copy `.env.example` to `.env`; `.env` is ignored by Git.

## Hermes plugin

The following variables belong to the Hermes service environment, not the nginx container.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HERMES_HOME` | `/root/.hermes` in the service | Hermes data directory used for profile-scoped Cockpit preferences. |
| `HERMES_COCKPIT_PORTAL_URL` | unset | Optional operations portal that exposes `/api/overview`. |
| `JUDGEM_CONSOLE_URL` | unset | Backward-compatible alias for `HERMES_COCKPIT_PORTAL_URL`. |
| `HERMES_COCKPIT_LINKS_JSON` | `[]` | Optional JSON list of operator links shown by the plugin. |

Example service links:

```json
[
  {
    "id": "grafana",
    "name": "Grafana",
    "kind": "Dashboards",
    "url": "https://grafana.example.net"
  }
]
```

Only absolute `http` and `https` URLs are accepted. Invalid entries are ignored. The repository intentionally contains no installation-specific addresses.

## Reverse-proxy path

The browser client defaults to `/hermes`. If your reverse proxy uses another same-origin prefix, change `data-hermes-base` in `dist/live-control.html` and `dist/bot-mode.html` before deployment.

## Security model

- Provider credentials remain in Hermes.
- Cockpit never stores the Hermes password, OAuth token, or provider key in browser storage.
- WebSocket connections use Hermes' short-lived ticket endpoint.
- The CLI bridge accepts only reviewed command/argument shapes and never invokes a shell.
- Browser preview returns screenshots through authenticated plugin routes; CDP addresses remain server-side.
