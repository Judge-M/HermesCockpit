# Hermes CLI coverage

This coverage record is generated from the installed Hermes `0.21.7` parser, not copied from help text or documentation. The exhaustive command signatures and API comparison are in [CAPABILITY-INVENTORY.md](CAPABILITY-INVENTORY.md) and [CAPABILITY-INVENTORY.json](CAPABILITY-INVENTORY.json).

## Authoritative counts

| Item | Count |
| --- | ---: |
| Top-level canonical commands | 72 |
| Canonical command/subcommand nodes | 422 |
| Leaf commands | 370 |
| Aliases | 45 |
| Flag/option definitions, including global launch options | 1,265 |
| Positional definitions | 229 |

The previous list missed `login`. It also treated several command families as CLI-only even though Hermes exposes some or all of the same behavior through REST configuration or purpose-built endpoints.

## Corrected CLI/API overlap

| Coverage class | Command families | Meaning |
| --- | ---: | --- |
| Direct API equivalent | 22 | The family’s central behavior has a purpose-built REST operation. |
| Partial API equivalent | 21 | Some subcommands have REST operations and the remaining subcommands still need the typed bridge. |
| Generic config/env API equivalent | 5 | The same persisted state can be read or changed through the config or environment API, without a dedicated route. |
| Gateway/WebSocket | 2 | The capability is available to Cockpit through the real gateway/PTY protocol rather than OpenAPI. |
| CLI-only | 22 | No equivalent browser contract exists in this Hermes build. |

These are family counts, not one-to-one endpoint counts. A command family can map to several API operations, and one API operation can support multiple CLI workflows. The generated inventory records the exact API operations associated with each family and preserves every canonical CLI node, alias, option, and positional.

## What still requires a command bridge

The 22 genuinely CLI-only families are now connected through 43 reviewed executable paths in Advanced Controls: `browser`, `codex-runtime`, `proxy`, `lsp`, `send`, `pause`, `resume`, `verify`, `approvals`, `import-agent`, `console`, `bundles`, `connectors`, `usage`, `claw`, `vault`, `uninstall`, `acp`, `completion`, `dashboard`, `serve`, and `desktop`.

Only the missing portion of a partial family should be added to the bridge next. Examples include project mutation, advanced session database maintenance, specialist skill/plugin maintenance, and several lifecycle or repair commands. The bridge must not duplicate behavior already available through REST or the gateway.

Global launch controls also require browser representation where they affect a session: one-shot mode, model/provider/reasoning overrides, toolsets, resume/continue, working directory, worktree isolation, hook acceptance, preloaded skills, session-ID injection, rules/config/customization bypass, safe mode, and interface selection. Terminal-only rendering flags may be omitted only when they have no behavioral effect on a browser session, and that decision must be recorded.

## Typed command bridge contract

The bridge is an operation registry, not a remote shell. Each operation defines:

1. A stable operation ID and fixed `hermes` executable/subcommand argument prefix.
2. Typed arguments with enumerations, length limits, and path restrictions.
3. The selected Hermes profile and service-user execution context.
4. A risk tier, required confirmation text, timeout, and maximum output size.
5. Redaction rules for credentials, tokens, cookies, and private paths.
6. A job ID with bounded stdout/stderr streaming and an audit record.
7. A declared read/write/destructive classification used by the UI.

The deployed bridge also scopes jobs to the authenticated dashboard user, disables PTY echo before accepting interactive responses, keeps raw output private while producing a bounded redacted view, applies command-and-field-specific path policies, caps concurrent jobs, terminates process groups, and keeps active jobs re-openable after navigation or reload.

The server must invoke the executable directly with an argument array. It must never pass user input through `sh`, `bash -c`, `eval`, command substitution, or unrestricted environment variables. Service lifecycle operations use the deployment supervisor rather than spawning orphan processes.

## Completion rule

The CLI audit is complete only when every installed command and relevant subcommand is either:

- backed by a purpose-built Cockpit workflow through REST or the gateway; or
- registered in the typed bridge and presented through a usable Cockpit workflow.

The generic REST catalog does not satisfy CLI-only coverage. Fake data, disabled placeholder buttons, instructions to open the official Hermes UI, and arbitrary-shell escape hatches all fail this rule.
