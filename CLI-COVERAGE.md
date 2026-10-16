# Hermes CLI coverage

This inventory is generated from the installed Hermes `0.21.7` command surface on the deployment host. Every command and every user-facing global launch option must be reachable from Cockpit. A REST or gateway implementation is preferred when it has the same behavior; otherwise the command must be exposed through the typed command bridge described below.

Status meanings:

- **Integrated** — a real Cockpit workflow exists and has been exercised against the deployed service.
- **Partial** — some operations are usable through a native workflow or Backend Control, but the full command family is not represented yet.
- **Required** — the command family still needs a real Cockpit workflow and, where necessary, a bridge operation.
- **Host-only** — intentionally restricted to an authenticated host-administration workflow, but still must be represented in Cockpit.

## Installed command inventory

| CLI command | Cockpit destination | Status |
| --- | --- | --- |
| `chat` and default interactive launch | Live Control | Integrated |
| `model` | Live Control / Models | Partial |
| `moa` | Models | Required |
| `fallback` | Providers & Models | Required |
| `worktree` | Development | Required |
| `browser` | Browser & Computer Use | Required |
| `secrets` | Security & Credentials | Required |
| `egress` | Security & Credentials | Required |
| `migrate` | Operations | Required |
| `codex-runtime` | Runtimes | Required |
| `gateway` | Operations / Channels | Partial |
| `proxy` | Providers | Required |
| `lsp` | Development | Required |
| `setup` | Setup | Required |
| `whatsapp` | Channels | Required |
| `whatsapp-cloud` | Channels | Required |
| `slack` | Channels | Required |
| `send` | Channels | Required |
| `logout` | Providers | Required |
| `auth` | Providers & Credentials | Required |
| `status` | Runtime / Mesh | Integrated |
| `pause` | Operations | Required |
| `resume` | Operations | Required |
| `cron` | Automations | Required |
| `webhook` | Automations / Channels | Required |
| `peer` | Mesh | Required |
| `portal` | Providers | Required |
| `kanban` | Tasks | Required |
| `project` | Projects | Required |
| `hooks` | Operations / Development | Required |
| `doctor` | Diagnostics | Partial |
| `verify` | Diagnostics / Development | Required |
| `security` | Security | Required |
| `approvals` | Security & Approvals | Required |
| `dump` | Diagnostics | Partial |
| `debug` | Diagnostics | Required |
| `backup` | Backup & Restore | Required |
| `checkpoints` | Backup & Restore | Required |
| `import` | Backup & Restore | Required |
| `import-agent` | Migration | Required |
| `config` | Runtime & Settings | Integrated for the published schema; CLI-only editing modes remain Required |
| `skin` | Appearance | Required |
| `console` | Operations | Required through the safe Hermes console contract |
| `pairing` | Channels & Access | Required |
| `skills` | Tool Registry | Partial |
| `bundles` | Tool Registry | Required |
| `plugins` | Tool Registry | Required |
| `curator` | Memory & Learning | Required |
| `pets` | Appearance | Required |
| `journey` / `learning` / `memory-graph` | Memory & Learning | Required |
| `memory` | Memory & Learning | Required |
| `tools` | Tool Registry | Partial |
| `computer-use` | Browser & Computer Use | Required |
| `mcp` | Tool Registry | Partial |
| `connectors` | Channels & Connectors | Required |
| `sessions` | Sessions | Partial |
| `insights` | Telemetry | Partial |
| `usage` | Telemetry | Partial |
| `monitoring` | Telemetry / Diagnostics | Required |
| `claw` | Migration | Required |
| `vault` | Security & Credentials | Required |
| `update` | Host Administration | Host-only |
| `uninstall` | Host Administration | Host-only |
| `acp` | Runtimes | Required |
| `profile` | Runtime & Settings | Partial |
| `completion` | Host Administration | Required |
| `dashboard` | Runtimes | Required |
| `serve` | Runtimes | Required |
| `desktop` / `gui` | Runtimes | Required |
| `logs` | Telemetry / Diagnostics | Partial |
| `prompt-size` | Telemetry | Partial |

Aliases are one capability, not an excuse to omit it. Subcommands and flags inherit the status of their command family until each is mapped to a typed control.

## Global launch controls

Cockpit must also expose the meaningful global launch options used to create or resume work: one-shot prompt and usage report, model, provider, reasoning level, toolsets, session resume/continue, working directory, isolated worktree, hook acceptance, preloaded skills, session-ID injection, rules/config/customization bypass, safe mode, and interface choice. Dangerous bypasses such as `--yolo` require an explicit high-risk confirmation and visible active-state warning. Terminal-only rendering choices may be hidden only when they have no behavioral effect on a browser session, and that determination must be documented.

## Typed command bridge contract

The bridge is an operation registry, not a remote shell. Each operation defines:

1. A stable operation ID and fixed `hermes` executable/subcommand argv prefix.
2. Typed arguments with enumerations, length limits, and path restrictions.
3. The selected Hermes profile and service-user execution context.
4. A risk tier, required confirmation text, timeout, and maximum output size.
5. Redaction rules for credentials, tokens, cookies, and private paths.
6. A job ID with bounded stdout/stderr streaming and an audit record.
7. A declared read/write/destructive classification used by the UI.

The server must invoke the executable directly with an argument array. It must never pass user input through `sh`, `bash -c`, `eval`, command substitution, or unrestricted environment variables. Service lifecycle operations use the deployment supervisor rather than spawning orphan processes.

## Completion rule

The CLI audit is complete only when every installed command and relevant subcommand is either:

- backed by a purpose-built Cockpit workflow; or
- registered in the typed bridge and presented through a usable Cockpit workflow.

The generic REST catalog cannot satisfy CLI-only coverage. Fake data, disabled placeholder buttons, instructions to open the official Hermes UI, and arbitrary-shell escape hatches all fail this rule.
