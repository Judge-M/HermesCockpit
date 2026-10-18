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
| API-wide discovery and fallback operation surface | Control Center | Integrated (all 354 live operations, including the 348-operation Hermes schema and 6 authenticated control-plane routes) |
| Session search, timeline, ownership, export and lifecycle | Chat and Control Center → Sessions & Chat | Integrated |
| Cron jobs, runs, delivery targets and blueprints | Control Center → Automations | Integrated |
| Messaging platforms, onboarding, pairing and webhooks | Control Center → Gateway & Connections | Integrated |
| Gateway start/stop/restart/drain/migration | Control Center → Gateway & Connections | Integrated |
| Providers, OAuth, credentials and custom endpoints | Models & Providers; Control Center | Integrated |
| Local-model install/download/server lifecycle | Models & Providers; Control Center | Integrated |
| Memory providers, curator and learning graph | Control Center → Memory & Tasks | Integrated |
| Git, worktrees and review lifecycle | Control Center → Projects & Development | Integrated |
| Files, media and workspace operations | Control Center → Voice & Media / Other | Integrated |
| Audio, voice, TTS and STT | Chat, Settings, and Control Center → Voice & Media | Integrated |
| Backups, imports, diagnostics, hooks and checkpoints | Control Center → Backup & Recovery / Diagnostics | Integrated |
| Dashboard themes, fonts and plugins | Settings, Tools, and Control Center | Integrated |
| Physical Tailscale peer topology | System | Explicitly unavailable: Hermes and the portal expose no peer/ACL/traffic contract, so Cockpit shows the verified request path instead of invented nodes |
| 22 genuinely CLI-only families with no Hermes browser contract | Advanced Controls | Integrated (43 typed, allowlisted executable paths) |
| CLI-only portions of partial/generic API families | Advanced Controls and matching workspaces | Integrated in bridge (127 typed paths across 22 families; purpose-built placement remains part of each workspace's product gate) |

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
