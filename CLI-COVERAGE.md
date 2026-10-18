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

## Typed bridge coverage

Advanced Controls now registers **169 reviewed executable paths across 44 families**:

- 43 paths from the 22 genuinely CLI-only families: `browser`, `codex-runtime`, `proxy`, `lsp`, `send`, `pause`, `resume`, `verify`, `approvals`, `import-agent`, `console`, `bundles`, `connectors`, `usage`, `claw`, `vault`, `uninstall`, `acp`, `completion`, `dashboard`, `serve`, and `desktop`.
- 126 command-level gaps from 22 partial or generic API families. These are the portions that the family-level REST match does not implement; API-backed siblings deliberately remain on REST.

### CLI-only portions of partial or generic API families

| Family | Paths | Registered command paths |
| --- | ---: | --- |
| `auth` | 4 | `auth priority`, `auth refresh`, `auth reset`, `auth upgrade` |
| `checkpoints` | 2 | `checkpoints clear`, `checkpoints clear-legacy` |
| `computer-use` | 6 | `computer-use doctor`, `computer-use install`, `computer-use screen install`, `computer-use screen start`, `computer-use screen status`, `computer-use screen stop` |
| `cron` | 4 | `cron doctor`, `cron incidents`, `cron notepad`, `cron tick` |
| `curator` | 13 | `curator adopt`, `curator archive`, `curator backup`, `curator ledger`, `curator list-archived`, `curator list-unmanaged`, `curator pin`, `curator prune`, `curator purge`, `curator restore`, `curator rollback`, `curator unpin`, `curator usage` |
| `egress` | 7 | `egress disable`, `egress install`, `egress reload`, `egress restart`, `egress setup`, `egress start`, `egress stop` |
| `gateway` | 5 | `gateway enroll`, `gateway install`, `gateway migrate-legacy`, `gateway run`, `gateway uninstall` |
| `hooks` | 3 | `hooks doctor`, `hooks revoke`, `hooks test` |
| `kanban` | 2 | `kanban gc`, `kanban repair` |
| `login` | 1 | `login` |
| `mcp` | 3 | `mcp configure`, `mcp picker`, `mcp serve` |
| `migrate` | 2 | `migrate relay`, `migrate xai` |
| `plugins` | 10 | `plugins adopt`, `plugins capabilities`, `plugins check-updates`, `plugins doctor`, `plugins pack export`, `plugins pack install`, `plugins pack show`, `plugins show`, `plugins trust-update-url`, `plugins validate` |
| `portal` | 2 | `portal open`, `portal tools` |
| `profile` | 6 | `profile alias`, `profile info`, `profile install`, `profile migrate-identity`, `profile purge-identity`, `profile update` |
| `project` | 9 | `project add-folder`, `project archive`, `project bind-board`, `project create`, `project remove-folder`, `project rename`, `project restore`, `project set-primary`, `project use` |
| `secrets` | 13 | `secrets bitwarden disable`, `secrets bitwarden install`, `secrets bitwarden setup`, `secrets bitwarden status`, `secrets bitwarden sync`, `secrets bitwarden token`, `secrets onepassword disable`, `secrets onepassword remove`, `secrets onepassword set`, `secrets onepassword setup`, `secrets onepassword status`, `secrets onepassword sync`, `secrets onepassword token` |
| `sessions` | 13 | `sessions clean-markers`, `sessions optimize`, `sessions optimize-storage`, `sessions pin`, `sessions pinned`, `sessions recover`, `sessions repair`, `sessions repair-profiles`, `sessions repair-prompts`, `sessions repair-routing`, `sessions retitle-skills`, `sessions set-journal-mode`, `sessions unpin` |
| `setup` | 1 | `setup` |
| `skills` | 17 | `skills audit`, `skills check`, `skills config`, `skills diff`, `skills list-modified`, `skills opt-in`, `skills opt-out`, `skills publish`, `skills repair-official`, `skills reset`, `skills snapshot export`, `skills snapshot import`, `skills tap add`, `skills tap list`, `skills tap remove`, `skills trust`, `skills untrust` |
| `slack` | 1 | `slack manifest` |
| `worktree` | 2 | `worktree list`, `worktree prune` |

The exact uncovered command list for the reviewed Hermes 0.21.7 CLI/API comparison is now **empty**. Every leaf command identified by the inventory as lacking an equivalent REST or gateway action is in the typed registry. Parent parser nodes are navigation groups, not executable user actions. API-backed commands are intentionally excluded from the bridge so their normal Cockpit workflows remain the single execution path.

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

The CLI command-path audit is complete only when every installed command and relevant subcommand is either:

- backed by a purpose-built Cockpit workflow through REST or the gateway; or
- registered in the typed bridge and presented through a usable Cockpit workflow.

The generic REST catalog does not satisfy CLI-only coverage. Fake data, disabled placeholder buttons, instructions to open the official Hermes UI, and arbitrary-shell escape hatches all fail this rule.

The command-path audit does not by itself prove that every API-backed workflow has a polished purpose-built interface. That broader product gate remains tracked in [BACKEND-COVERAGE.md](BACKEND-COVERAGE.md).
