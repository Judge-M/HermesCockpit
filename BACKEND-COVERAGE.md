# Hermes backend coverage

Hermes Cockpit has one non-negotiable integration rule:

> Every user-facing capability exposed by the installed Hermes backend or `hermes` command-line interface must have a real Cockpit surface, and every Cockpit control must execute a real backend or CLI operation.

An internal implementation helper does not need a button. A user-facing REST endpoint, WebSocket method, event, control-plane operation, or CLI command does. A feature is complete only when its data, actions, errors, confirmation requirements, and responsive states are represented in Cockpit and exercised against the deployed Hermes service.

When Hermes has no browser API for a CLI capability, Cockpit uses a server-side command bridge. That bridge must use an explicit command-and-argument allowlist, run as the Hermes service user, enforce the selected profile scope, stream bounded output, prevent shell expansion, and require confirmation for destructive or security-sensitive operations. Cockpit never exposes an arbitrary root shell.

## Coverage ledger

| Backend area | Cockpit surface | Status |
| --- | --- | --- |
| Health, runtime status, host identity, system stats | Runtime, Mesh, Telemetry | Integrated |
| PTY chat, recent sessions, model discovery and switching | Live Control | Integrated |
| Gateway JSON-RPC sessions and streaming | Live Control | Integrated |
| Canonical Bot Chat roster/history | Live Control Bot Mode | Integrated |
| Todo updates, subagent list/events, tool activity | Live Control Bot Mode | Integrated |
| Profiles, active profile, model, description, SOUL | Runtime & Settings | Integrated |
| Complete `/api/config/schema` configuration | Runtime & Settings | Integrated |
| MCP servers, MCP tests, enablement | Tool Registry | Integrated |
| Skills and toolset enablement | Tool Registry | Integrated |
| API-wide discovery and fallback operation surface | Control Center | Integrated (337 authenticated control operations; 348 total OpenAPI operations including 11 access/web-shell routes) |
| Session search, timeline, ownership, export and lifecycle | Sessions workspace | Required |
| Cron jobs, runs, delivery targets and blueprints | Automations workspace | Required |
| Messaging platforms, onboarding, pairing and webhooks | Channels workspace | Required |
| Gateway start/stop/restart/drain/migration | Operations workspace | Required |
| Providers, OAuth, credentials and custom endpoints | Providers workspace | Required |
| Local-model install/download/server lifecycle | Models workspace | Required |
| Memory providers, curator and learning graph | Memory workspace | Required |
| Git, worktrees and review lifecycle | Development workspace | Required |
| Files, media and workspace operations | Files workspace | Required |
| Audio, voice, TTS and STT | Voice workspace | Required |
| Backups, imports, diagnostics, hooks and checkpoints | Operations workspace | Required |
| Dashboard themes, fonts and plugins | Appearance & Plugins | Required |
| Cross-machine/Tailscale service topology | Mesh | Required through a deployment bridge |
| 22 genuinely CLI-only families with no Hermes browser contract | Advanced Controls | Integrated (43 typed, allowlisted executable paths) |
| CLI-only portions of partial/generic API families | Advanced Controls and matching workspaces | Integrated in bridge (126 typed paths across 22 families; purpose-built placement remains part of each workspace's product gate) |

## Completion gate

Before a backend area is marked integrated:

1. The contract is verified from the installed Hermes source or live schema.
2. Read and write operations have a native Cockpit interface.
3. Destructive or security-sensitive actions require explicit confirmation.
4. Secret material is masked by default and never persisted in browser storage.
5. Desktop and mobile layouts are usable.
6. The deployed screen is browser-tested against the real service without fabricated fallback data.
7. Any CLI bridge entry is an exact executable/argument template; user input is passed as data, never interpolated into a shell command.

The schema-driven Control Center guarantees that every current and newly exposed REST operation stays available as a normal field, selector, toggle, or action while dedicated workflows are built. It keeps HTTP methods and routes inside optional technical details. It does not replace the requirement for polished purpose-built screens, and no endpoint may be dropped merely because a dedicated screen does not exist yet.

The installed command inventory, API overlap, bridge policy, and per-command signatures are tracked in [CLI-COVERAGE.md](CLI-COVERAGE.md) and the generated [CAPABILITY-INVENTORY.md](CAPABILITY-INVENTORY.md). A release cannot claim complete Hermes coverage while any real user-facing capability remains unavailable through a purpose-built workflow or the typed bridge.
