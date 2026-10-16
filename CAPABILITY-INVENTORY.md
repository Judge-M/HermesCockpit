# Hermes capability inventory

Authoritative snapshot of installed Hermes **0.21.7** at commit `71d34bad1045610252eda02ee79549436896e784`.

This file is generated from the installed argparse tree and FastAPI OpenAPI schema. It does not infer commands from documentation, and it keeps aliases separate from canonical command nodes so they are not double-counted.

## Counts

| Surface | Count |
| --- | ---: |
| Top-level canonical CLI commands | 72 |
| Canonical CLI command/subcommand nodes | 422 |
| CLI leaf commands | 370 |
| CLI aliases | 45 |
| CLI option/flag definitions | 1265 |
| CLI positional definitions | 229 |
| OpenAPI paths | 305 |
| All OpenAPI operations | 348 |
| Authenticated Hermes control operations under `/api` | 337 |
| Access, authentication, asset, and SPA-shell operations outside `/api` | 11 |
| Control operations associated with at least one CLI family | 256 |
| Control operations with no CLI-family counterpart | 81 |

The complete schema has 348 operations. Cockpit deliberately presents the 337 `/api` operations as controls; the other 11 implement login/OAuth, static assets, plugin assets, and SPA routing. They are inventoried below but are not user settings or actions.

## CLI/API overlap by command family

| CLI family | CLI nodes | Leaf commands | API operations in family | Coverage | Notes |
| --- | ---: | ---: | ---: | --- | --- |
| `chat` | 1 | 1 | 2 | Gateway/WebSocket, not REST | Conversation execution is the PTY/gateway WebSocket contract; REST only supplies ancillary chat data. |
| `model` | 1 | 1 | 12 | Direct API equivalent | Model discovery, assignment, and custom endpoints have native REST controls. |
| `moa` | 4 | 3 | 2 | Direct API equivalent | GET and PUT cover reading and replacing MoA slots, including clearing a preset. |
| `fallback` | 5 | 4 | 4 | Generic config/env API equivalent | The fallback chain is part of the profile configuration and is readable/writable through the config API. |
| `worktree` | 3 | 2 | 3 | Partial API equivalent | REST can list, add, and remove worktrees; the attended audit/prune policy remains CLI-only. |
| `browser` | 2 | 1 | 0 | CLI-only | Closing a real-profile browser process has no REST operation. |
| `secrets` | 16 | 13 | 8 | Generic config/env API equivalent | Environment and config values are manageable, but Bitwarden/1Password install, validation, and sync flows are CLI-only. |
| `egress` | 10 | 9 | 5 | Partial API equivalent | REST exposes status and configuration; install and service lifecycle actions are not exposed. |
| `migrate` | 3 | 2 | 1 | Partial API equivalent | The general config migration is exposed; named xAI and relay migrations are not separate REST actions. |
| `codex-runtime` | 2 | 1 | 0 | CLI-only | Codex MCP projection/migration is CLI-only. |
| `gateway` | 13 | 12 | 7 | Partial API equivalent | Start, stop, restart, drain, and migration are native REST actions; install, uninstall, enrollment, and foreground execution remain CLI-only. |
| `proxy` | 4 | 3 | 0 | CLI-only | The local OpenAI-compatible proxy lifecycle has no REST operation. |
| `lsp` | 7 | 6 | 0 | CLI-only | LSP inventory, install, restart, and binary lookup are CLI-only. |
| `setup` | 1 | 1 | 36 | Partial API equivalent | The wizard itself is CLI-only, but its main persisted settings have native REST controls. |
| `whatsapp` | 1 | 1 | 4 | Direct API equivalent | The complete browser onboarding lifecycle is exposed. |
| `whatsapp-cloud` | 1 | 1 | 3 | Direct API equivalent | Platform configuration and testing are exposed through messaging platform controls. |
| `slack` | 2 | 1 | 3 | Partial API equivalent | Platform settings and testing are exposed; manifest generation is CLI-only. |
| `send` | 1 | 1 | 0 | CLI-only | The no-agent outbound message command has no REST operation. |
| `login` | 1 | 1 | 7 | Partial API equivalent | Browser provider OAuth is exposed; CLI-specific login modes and flags are not all mirrored. |
| `logout` | 1 | 1 | 1 | Direct API equivalent | Provider disconnect is a native REST action. |
| `auth` | 10 | 9 | 9 | Partial API equivalent | Pool list/add/remove and provider OAuth are exposed; priority, cooldown reset, refresh, and upgrade are not all represented. |
| `status` | 1 | 1 | 6 | Direct API equivalent | Runtime, health, system, and host status have direct read APIs. |
| `pause` | 1 | 1 | 0 | CLI-only | The global emergency stop does not have an equivalent REST action. |
| `resume` | 1 | 1 | 0 | CLI-only | Lifting the global emergency stop does not have an equivalent REST action. |
| `cron` | 14 | 13 | 13 | Partial API equivalent | Job CRUD, pause/resume, trigger, runs, delivery targets, and blueprints are exposed; incidents, notepad, doctor, and tick are CLI-only. |
| `webhook` | 5 | 4 | 6 | Direct API equivalent | Subscription CRUD, enablement, and firing/testing are exposed. |
| `peer` | 8 | 7 | 0 | Gateway/WebSocket, not REST | Peer turns use the gateway protocol and are not in OpenAPI. |
| `portal` | 6 | 5 | 7 | Partial API equivalent | Portal status and OAuth are exposed; opening the subscription page and tool routing inventory remain CLI-only. |
| `kanban` | 55 | 53 | 47 | Partial API equivalent | The API exposes broad board, task, run, orchestration, attachment, link, comment, and worker controls; low-level repair/maintenance commands remain CLI-only. |
| `project` | 12 | 11 | 2 | Partial API equivalent | Projects are readable through REST, but the CLI project mutation surface is not exposed. |
| `hooks` | 5 | 4 | 3 | Partial API equivalent | List, create, and delete are exposed; test, revoke semantics, and doctor are not separate REST actions. |
| `doctor` | 1 | 1 | 1 | Direct API equivalent | The diagnostic run has a direct REST action. |
| `verify` | 1 | 1 | 0 | CLI-only | Project recipe detection and smoke testing are CLI-only. |
| `security` | 2 | 1 | 1 | Direct API equivalent | The supply-chain audit has a direct REST action. |
| `approvals` | 3 | 2 | 0 | CLI-only | Approval history mining and verdict testing are CLI-only. |
| `dump` | 1 | 1 | 1 | Direct API equivalent | The support dump has a direct REST action. |
| `debug` | 3 | 2 | 1 | Direct API equivalent | Debug report upload has a direct REST action. |
| `backup` | 1 | 1 | 2 | Direct API equivalent | Backup creation and download have direct REST operations. |
| `checkpoints` | 6 | 5 | 2 | Partial API equivalent | Listing and pruning are exposed; clearing the entire or legacy stores remains CLI-only. |
| `import` | 1 | 1 | 2 | Direct API equivalent | Server-side and upload restore paths have direct REST actions. |
| `import-agent` | 1 | 1 | 0 | CLI-only | Claude Code/Codex setup import is CLI-only. |
| `config` | 10 | 9 | 6 | Direct API equivalent | Resolved, raw, defaults, schema, and update operations cover config read/write behavior. |
| `skin` | 4 | 3 | 8 | Generic config/env API equivalent | Appearance values are writable through config, while dashboard theme/font have dedicated operations; terminal skin file management is not fully mirrored. |
| `console` | 1 | 1 | 0 | CLI-only | The curated command REPL has no REST operation and must not be replaced with an arbitrary shell. |
| `pairing` | 5 | 4 | 4 | Direct API equivalent | List, approve, revoke, and clear-pending are all exposed. |
| `skills` | 27 | 24 | 13 | Partial API equivalent | REST covers list, create/edit, toggle, registry search/preview/install/update/uninstall; trust, snapshots, taps, publishing, and several maintenance actions remain CLI-only. |
| `bundles` | 6 | 5 | 0 | CLI-only | Skill bundle CRUD and reload are CLI-only. |
| `plugins` | 20 | 18 | 11 | Partial API equivalent | Install/update/remove/enable/disable and catalog discovery are exposed; validation, packs, capabilities, and provenance maintenance are CLI-only. |
| `curator` | 18 | 17 | 3 | Partial API equivalent | Status, run, pause, and resume are exposed; pinning, archive/restore, backup/rollback, ledger, prune, and purge remain CLI-only. |
| `pets` | 9 | 8 | 4 | Generic config/env API equivalent | Active pet display settings are writable through config; gallery, install, animation, removal, and doctor are CLI-only. |
| `journey` | 4 | 3 | 4 | Direct API equivalent | Graph listing plus node read, update, and delete mirror the CLI journey controls. |
| `memory` | 5 | 4 | 8 | Direct API equivalent | Status, provider selection/config/setup/OAuth, disablement, and reset are exposed. |
| `tools` | 5 | 4 | 8 | Direct API equivalent | Toolset list/toggle/config/provider/model/env/post-setup controls are exposed. |
| `computer-use` | 12 | 9 | 2 | Partial API equivalent | Status and permission grant are exposed; install, doctor, and headless-screen lifecycle are CLI-only. |
| `mcp` | 12 | 11 | 12 | Partial API equivalent | Server/catalog CRUD, enablement, testing, and OAuth are exposed; MCP serving and interactive picker/configuration modes are not direct REST actions. |
| `connectors` | 6 | 5 | 0 | CLI-only | Hosted connector account lifecycle has no OpenAPI operation in this build. |
| `sessions` | 23 | 22 | 20 | Partial API equivalent | REST covers browse/search/detail/messages/timeline/export/import/rename/delete/prune/stats and ownership repair; advanced database maintenance, pinning, and several repair tools remain CLI-only. |
| `insights` | 1 | 1 | 2 | Direct API equivalent | Usage and model analytics have direct read APIs. |
| `usage` | 1 | 1 | 0 | CLI-only | Provider account rate-limit windows are not the same as historical analytics and have no REST equivalent. |
| `monitoring` | 2 | 1 | 5 | Generic config/env API equivalent | Monitoring configuration and runtime status are readable through generic config/status APIs; the dedicated redaction-posture report is CLI-only. |
| `claw` | 3 | 2 | 0 | CLI-only | OpenClaw migration and cleanup are CLI-only. |
| `vault` | 5 | 4 | 0 | CLI-only | Encrypted browser-vault item management has no dashboard REST contract. |
| `update` | 1 | 1 | 3 | Direct API equivalent | Check, run, and receipt operations are exposed. |
| `uninstall` | 1 | 1 | 0 | CLI-only | Host uninstall is CLI-only. |
| `acp` | 1 | 1 | 0 | CLI-only | Starting the ACP server is CLI-only. |
| `profile` | 16 | 15 | 20 | Partial API equivalent | REST covers core list/create/delete/rename/select/export/import/model/description/SOUL operations; aliases, identity repair, and distribution install/update/info remain CLI-only. |
| `completion` | 1 | 1 | 0 | CLI-only | Shell completion generation is CLI-only and has no browser behavior. |
| `dashboard` | 2 | 1 | 0 | CLI-only | Starting/registering the dashboard is host lifecycle work; /api/dashboard/* configures dashboard features rather than executing this CLI command. |
| `serve` | 1 | 1 | 0 | CLI-only | Starting the headless backend is host lifecycle work and cannot be performed by that backend itself. |
| `desktop` | 1 | 1 | 0 | CLI-only | Building and launching Electron is CLI-only and not required for Cockpit operation. |
| `logs` | 1 | 1 | 1 | Direct API equivalent | Log selection, filtering, and tail data have a direct REST read operation. |
| `prompt-size` | 1 | 1 | 1 | Direct API equivalent | Prompt budget analysis has a direct REST action. |

Coverage labels are deliberately conservative: **Direct** means the command family’s central behavior has a dedicated API; **Partial** means only some subcommands do; **Generic** means the same persisted state can be changed through config/env APIs without a dedicated endpoint; **Gateway/WebSocket** means it is real browser functionality outside OpenAPI; **CLI-only** means no equivalent native Hermes browser contract was found. Cockpit now supplies its own authenticated, typed bridge for the 43 reviewed executable paths in all 22 CLI-only families; the classification remains CLI-only because it describes Hermes's native API rather than Cockpit's added integration.

## Complete canonical CLI inventory

The root invocation also defines **24 global launch options**. Their complete signatures are retained in the JSON inventory and are included in the option total above.

| Canonical command | Aliases | Flags/options | Positionals | Description |
| --- | --- | ---: | ---: | --- |
| `chat` |  | 33 | 0 | Interactive chat with the agent |
| `model` |  | 10 | 0 | Select default model and provider |
| `moa` |  | 1 | 0 | Configure Mixture of Agents provider/model slots |
| `moa list` | `ls` | 1 | 0 | Show current MoA model slots |
| `moa configure` | `config` | 1 | 1 | Interactively pick MoA models |
| `moa delete` | `rm` | 1 | 1 | Delete a MoA preset |
| `fallback` |  | 1 | 0 | Manage fallback providers (tried when the primary model fails) |
| `fallback list` | `ls` | 1 | 0 | Show the current fallback chain (default when no subcommand) |
| `fallback add` |  | 1 | 0 | Pick a provider + model (same picker as `hermes model`) and append to the chain |
| `fallback remove` | `rm` | 1 | 0 | Pick an entry to delete from the chain |
| `fallback clear` |  | 1 | 0 | Remove all fallback entries |
| `worktree` |  | 1 | 0 | Audit and reclaim accumulated git worktrees and merged branches |
| `worktree list` | `ls`, `audit` | 4 | 0 | Classify every tree: age, size, verdict, reason (default action) |
| `worktree prune` |  | 7 | 0 | Remove safe trees and delete fully-merged local branches |
| `browser` |  | 1 | 0 | Real-profile browsing helpers (close a browser locking its profile) |
| `browser close-profile` |  | 2 | 0 | Close the browser locking your real profile (asks nothing — run only with the user's explicit OK; loses unsaved tabs) |
| `secrets` |  | 1 | 0 | Manage external secret sources (Bitwarden, 1Password) |
| `secrets bitwarden` | `bw` | 1 | 0 | Bitwarden Secrets Manager integration |
| `secrets bitwarden setup` |  | 4 | 0 | Interactive wizard: install bws, store access token, pick project |
| `secrets bitwarden status` |  | 1 | 0 | Show config + binary + token validation status |
| `secrets bitwarden token` |  | 3 | 0 | Rotate the access token: validate a new one and store it in .env |
| `secrets bitwarden sync` |  | 2 | 0 | Fetch secrets now and report what changed |
| `secrets bitwarden disable` |  | 1 | 0 | Turn off the Bitwarden integration |
| `secrets bitwarden install` |  | 2 | 0 | Install the PM-pinned bws binary |
| `secrets onepassword` | `op`, `1password` | 1 | 0 | 1Password (op:// references) integration |
| `secrets onepassword setup` |  | 5 | 0 | Verify the op CLI, set account / token env var, and enable |
| `secrets onepassword status` |  | 1 | 0 | Show config + op binary + references |
| `secrets onepassword token` |  | 3 | 0 | Rotate the service-account token: validate and store it in .env |
| `secrets onepassword set` |  | 1 | 2 | Map an env var to an op:// reference |
| `secrets onepassword remove` |  | 1 | 1 | Remove an env-var → reference mapping |
| `secrets onepassword sync` |  | 2 | 0 | Resolve references now and report what changed |
| `secrets onepassword disable` |  | 1 | 0 | Turn off the 1Password integration |
| `egress` |  | 1 | 0 | Manage the iron-proxy egress credential-injection firewall |
| `egress install` |  | 2 | 0 | Install the PM-pinned iron-proxy binary |
| `egress setup` |  | 7 | 0 | Interactive wizard: install + CA + mint tokens + write config |
| `egress start` |  | 1 | 0 | Start the managed iron-proxy |
| `egress stop` |  | 1 | 0 | Stop the managed iron-proxy |
| `egress restart` |  | 1 | 0 | Restart the managed iron-proxy (stop if running, then start) |
| `egress reload` |  | 1 | 0 | Hot-reload the running daemon's ruleset from proxy.yaml (management API — no restart, no dropped connections) |
| `egress status` |  | 2 | 0 | Show proxy state and mappings |
| `egress disable` |  | 1 | 0 | Turn off the proxy integration |
| `egress config` |  | 1 | 0 | Print the generated proxy.yaml path |
| `migrate` |  | 1 | 0 | Migrate configuration for retired models or deprecated settings |
| `migrate xai` |  | 3 | 0 | Migrate xAI models scheduled for retirement on May 15, 2026 |
| `migrate relay` |  | 3 | 0 | Convert legacy HERMES_NEMO_RELAY_ATIF_*/ATOF_* exporter vars into relay-plugins.toml |
| `codex-runtime` |  | 1 | 0 | Manage the optional codex app-server runtime (migrate MCP config) |
| `codex-runtime migrate` |  | 3 | 0 | Regenerate the hermes-managed block in codex's config.toml |
| `gateway` |  | 2 | 0 | Messaging gateway management |
| `gateway run` |  | 8 | 0 | Run gateway in foreground (recommended for WSL and Docker) |
| `gateway start` |  | 5 | 0 | Start the installed systemd/launchd background service |
| `gateway stop` |  | 3 | 0 | Stop gateway service |
| `gateway restart` |  | 5 | 0 | Restart gateway service |
| `gateway status` |  | 5 | 0 | Show gateway status |
| `gateway install` |  | 11 | 0 | Install gateway as a systemd/launchd background service |
| `gateway uninstall` |  | 2 | 0 | Uninstall gateway service |
| `gateway list` |  | 1 | 0 | List all profiles and their gateway status |
| `gateway setup` |  | 1 | 0 | Configure messaging platforms |
| `gateway migrate-legacy` |  | 3 | 0 | Remove legacy hermes.service units from pre-rename installs |
| `gateway migrate` |  | 4 | 0 | Converge every per-profile gateway onto the ONE host gateway |
| `gateway enroll` |  | 5 | 0 | Enroll this gateway with a relay connector (writes relay auth creds to .env) |
| `proxy` |  | 1 | 0 | Local OpenAI-compatible proxy to OAuth providers |
| `proxy start` |  | 4 | 0 | Run the proxy in the foreground |
| `proxy status` |  | 1 | 0 | Show which proxy upstreams are ready |
| `proxy providers` |  | 1 | 0 | List available proxy upstream providers |
| `lsp` |  | 1 | 0 | Language Server Protocol management |
| `lsp status` |  | 2 | 0 | Show LSP service status |
| `lsp list` |  | 2 | 0 | List supported language servers |
| `lsp install` |  | 1 | 1 | Install a server binary |
| `lsp install-all` |  | 2 | 0 | Install every server with a known auto-install recipe |
| `lsp restart` |  | 1 | 0 | Tear down running LSP clients (next edit re-spawns) |
| `lsp which` |  | 1 | 1 | Print binary path for a server |
| `setup` |  | 6 | 1 | Interactive setup wizard |
| `whatsapp` |  | 1 | 0 | Set up WhatsApp integration |
| `whatsapp-cloud` |  | 1 | 0 | Set up WhatsApp Business Cloud API integration |
| `slack` |  | 1 | 0 | Slack integration helpers (manifest generation, etc.) |
| `slack manifest` |  | 9 | 0 | Print or write a Slack app manifest with every gateway command registered as a native slash (/btw, /stop, /model, ...) |
| `send` |  | 8 | 1 | Send a message to a configured platform (scripts, cron jobs, CI). |
| `login` |  | 10 | 0 | Deprecated. Use `hermes auth` to manage credentials, `hermes model` to select a provider, or `hermes setup` for full setup. |
| `logout` |  | 2 | 0 | Clear authentication for an inference provider |
| `auth` |  | 1 | 0 | Manage pooled provider credentials |
| `auth add` |  | 14 | 1 | Add a pooled credential |
| `auth list` |  | 1 | 1 | List pooled credentials |
| `auth remove` |  | 1 | 2 | Remove a pooled credential by index, id, or label |
| `auth reset` |  | 1 | 2 | Clear exhaustion status for a provider's credentials (all, or one target) |
| `auth priority` |  | 1 | 3 | Move a pooled credential to a priority (0 = tried first under fill_first) |
| `auth refresh` |  | 1 | 2 | Refresh a pooled OAuth credential's tokens and clear its cooldown |
| `auth status` |  | 1 | 1 | Show auth status for a provider |
| `auth logout` |  | 1 | 1 | Log out a provider and clear stored auth state |
| `auth upgrade` |  | 3 | 0 | Sign in with a Nous account, keeping your connectors |
| `status` |  | 3 | 0 | Show status of all components |
| `pause` |  | 2 | 0 | Emergency stop: pause cron/kanban dispatch and new gateway turns |
| `resume` |  | 1 | 0 | Lift the emergency stop set by `hermes pause` |
| `cron` |  | 2 | 0 | Cron job management |
| `cron list` |  | 2 | 0 | List scheduled jobs |
| `cron create` | `add` | 19 | 2 | Create a scheduled job |
| `cron edit` |  | 25 | 1 | Edit an existing scheduled job |
| `cron pause` |  | 1 | 1 | Pause a scheduled job |
| `cron resume` |  | 3 | 1 | Resume a paused job |
| `cron run` |  | 2 | 1 | Run a job on the next scheduler tick |
| `cron remove` | `rm`, `delete` | 1 | 1 | Remove a scheduled job |
| `cron status` |  | 1 | 0 | Check if cron scheduler is running |
| `cron runs` | `history` | 2 | 1 | Show durable execution attempts |
| `cron incidents` |  | 2 | 2 | List or acknowledge durable cron failure incidents |
| `cron notepad` |  | 1 | 4 | Read/write a job's durable notepad (persistent KV across runs) |
| `cron doctor` |  | 1 | 0 | Check scheduled jobs for common health issues |
| `cron tick` |  | 2 | 0 | Run due jobs once and exit |
| `webhook` |  | 1 | 0 | Manage dynamic webhook subscriptions |
| `webhook subscribe` | `add` | 13 | 1 | Create a webhook subscription |
| `webhook list` | `ls` | 1 | 0 | List all dynamic subscriptions |
| `webhook remove` | `rm` | 1 | 1 | Remove a subscription |
| `webhook test` |  | 2 | 1 | Send a test POST to a webhook route |
| `peer` |  | 1 | 0 | Bot-to-bot DMs across machines (peer Hermes gateways) |
| `peer add` | `set` | 4 | 1 | Register (or update) a peer gateway |
| `peer list` | `ls` | 1 | 0 | List registered peers |
| `peer remove` | `rm` | 1 | 1 | Remove a peer |
| `peer dm` |  | 2 | 2 | Message an agent on a peer gateway and print its reply |
| `peer run` |  | 3 | 2 | Start a long peer turn asynchronously and return its run ID |
| `peer status` |  | 2 | 2 | Read the status and final output of an asynchronous peer run |
| `peer stop` |  | 2 | 2 | Stop one asynchronous peer run without affecting another turn |
| `portal` |  | 1 | 0 | Set up Nous Portal (login, model pick, Tool Gateway); see also `portal info` |
| `portal login` |  | 1 | 0 | Log in to Nous Portal + set it up (default; one-shot onboarding) |
| `portal info` |  | 1 | 0 | Show Portal auth + Tool Gateway routing summary |
| `portal status` |  | 1 | 0 |  |
| `portal open` |  | 1 | 0 | Open the Portal subscription page in your default browser |
| `portal tools` |  | 1 | 0 | List Tool Gateway tools and which are routed via Nous |
| `kanban` |  | 2 | 0 | Multi-profile collaboration board (tasks, links, comments) |
| `kanban init` |  | 1 | 0 | Create kanban.db if missing (idempotent) |
| `kanban boards` |  | 1 | 0 | Manage kanban boards (one board per project / workstream) |
| `kanban boards list` | `ls` | 3 | 0 | List all boards with task counts |
| `kanban boards create` | `new` | 7 | 1 | Create a new board |
| `kanban boards rm` | `remove`, `delete` | 2 | 1 | Archive (default) or delete a board |
| `kanban boards switch` | `use` | 1 | 1 | Set the active board for subsequent CLI calls |
| `kanban boards show` | `current` | 1 | 0 | Print the currently-active board slug |
| `kanban boards rename` |  | 1 | 2 | Change a board's human-readable display name (slug is immutable) |
| `kanban boards set-default-workdir` |  | 1 | 2 | Set the default workspace path for tasks on a board |
| `kanban boards export` |  | 5 | 1 | Export a board to a portable .tar.gz archive |
| `kanban boards import` |  | 4 | 1 | Import a board archive as a new board |
| `kanban create` |  | 23 | 1 | Create a new task |
| `kanban swarm` |  | 9 | 1 | Create a Kanban Swarm v1 graph (parallel workers → verifier → synthesizer) |
| `kanban list` | `ls` | 11 | 0 | List tasks |
| `kanban show` |  | 4 | 1 | Show a task with comments + events |
| `kanban assign` |  | 1 | 2 | Assign or reassign a task |
| `kanban set-model` |  | 2 | 2 | Set or clear a task's model/provider override (takes effect on the next dispatch) |
| `kanban reclaim` |  | 2 | 1 | Release an active worker claim on a running task |
| `kanban reassign` |  | 3 | 2 | Reassign a task to a different profile, optionally reclaiming first |
| `kanban diagnostics` | `diag` | 4 | 0 | List active diagnostics on the current board |
| `kanban link` |  | 1 | 2 | Add a parent->child dependency |
| `kanban unlink` |  | 1 | 2 | Remove a parent->child dependency |
| `kanban claim` |  | 2 | 1 | Atomically claim a ready task (prints resolved workspace path) |
| `kanban comment` |  | 3 | 2 | Append a comment |
| `kanban attach` |  | 4 | 2 | Attach a local file to a task |
| `kanban attachments` |  | 2 | 1 | List a task's attachments |
| `kanban attach-rm` |  | 1 | 1 | Delete an attachment by id |
| `kanban complete` |  | 5 | 1 | Mark one or more tasks done |
| `kanban edit` |  | 7 | 1 | Edit task fields or recovery fields on an already-completed task |
| `kanban block` |  | 3 | 2 | Mark one or more tasks blocked |
| `kanban schedule` |  | 2 | 2 | Park one or more tasks in Scheduled (waiting on time, not human input) |
| `kanban unblock` |  | 2 | 1 | Return blocked/scheduled tasks to ready, or todo while parents remain open |
| `kanban request-review` |  | 5 | 1 | Move a task to 'review' (implementation done, awaiting review) — NOT a block |
| `kanban request-changes` |  | 1 | 2 | Reviewer verdict: return the active review run to its implementer |
| `kanban reopen-review` |  | 2 | 1 | Send one or more review tasks back for changes (review -> ready/todo) |
| `kanban promote` |  | 4 | 2 | Manually move one or more todo/blocked tasks to ready (recovery path) |
| `kanban archive` |  | 2 | 1 | Archive one or more tasks |
| `kanban tail` |  | 2 | 1 | Follow a task's event stream |
| `kanban dispatch` |  | 5 | 0 | One dispatcher pass: reclaim stale, promote ready, spawn workers |
| `kanban daemon` |  | 7 | 0 | DEPRECATED — dispatcher now runs in the gateway. Use `hermes gateway start`. |
| `kanban watch` |  | 5 | 0 | Live-stream task_events to the terminal (Ctrl+C to exit) |
| `kanban stats` |  | 2 | 0 | Per-status + per-assignee counts + oldest-ready age |
| `kanban notify-subscribe` |  | 11 | 1 | Subscribe a gateway source to a task's terminal events (used by /kanban subscribe in the gateway adapter) |
| `kanban notify-list` |  | 2 | 1 | List notification subscriptions (optionally for a single task) |
| `kanban notify-unsubscribe` |  | 4 | 1 | Remove a gateway subscription from a task |
| `kanban log` |  | 2 | 1 | Print the worker log for a task (from <kanban-root>/kanban/logs/) |
| `kanban runs` |  | 4 | 1 | Show attempt history for a task (one row per run: profile, outcome, elapsed, summary) |
| `kanban heartbeat` |  | 2 | 1 | Emit a heartbeat event for a running task (worker liveness signal) |
| `kanban assignees` |  | 2 | 0 | List known profiles + per-profile task counts (union of ~/.hermes/profiles/ and current assignees on the board) |
| `kanban context` |  | 1 | 1 | Print the full context a worker sees for a task (title + body + parent results + comments). |
| `kanban specify` |  | 5 | 1 | Flesh out a triage-column task into a concrete spec (title + body) and promote it to todo. Uses the auxiliary LLM configured under auxiliary.triage_specifier. |
| `kanban decompose` |  | 5 | 1 | Decompose a triage-column task into a graph of child tasks routed to specialist profiles by description. Falls back to specify-style single-task promotion when the task doesn't benefit from fan-out. Uses auxiliary.kanban_decomposer. |
| `kanban gc` |  | 3 | 0 | Garbage-collect archived-task workspaces, old events, and old logs |
| `kanban repair` |  | 2 | 0 | Check kanban.db integrity and auto-repair index-only corruption |
| `project` |  | 1 | 0 | Manage projects (named, multi-folder workspaces) |
| `project create` |  | 8 | 2 | Create a new project |
| `project list` | `ls` | 2 | 0 | List projects |
| `project show` |  | 1 | 1 | Show a project's details |
| `project add-folder` |  | 3 | 2 | Add a folder to a project |
| `project remove-folder` |  | 1 | 2 | Remove a folder from a project |
| `project rename` |  | 1 | 2 | Rename a project |
| `project set-primary` |  | 1 | 2 | Set the primary folder |
| `project use` |  | 1 | 1 | Set the active project |
| `project archive` |  | 1 | 1 | Archive a project |
| `project restore` |  | 1 | 1 | Restore an archived project |
| `project bind-board` |  | 1 | 2 | Bind a kanban board to a project |
| `hooks` |  | 1 | 0 | Inspect and manage shell-script hooks |
| `hooks list` | `ls` | 1 | 0 | List configured hooks with matcher, timeout, and consent status |
| `hooks test` |  | 3 | 1 | Fire every hook matching <event> against a synthetic payload |
| `hooks revoke` | `remove`, `rm` | 1 | 1 | Remove a command's allowlist entries (takes effect on next restart) |
| `hooks doctor` |  | 1 | 0 | Check each configured hook: exec bit, allowlist, mtime drift, JSON validity, and synthetic run timing |
| `doctor` |  | 4 | 0 | Check configuration and dependencies |
| `verify` |  | 9 | 1 | Detect a project's run recipe and smoke-test it |
| `security` |  | 1 | 0 | Supply-chain audit (OSV.dev) for venv, plugins, and MCP servers |
| `security audit` |  | 6 | 0 | Run a one-shot supply-chain audit |
| `approvals` |  | 1 | 0 | Approval-prompt tools (mine history into allowlist proposals) |
| `approvals suggest` |  | 7 | 0 | Propose command_allowlist entries from past approvals |
| `approvals test` |  | 3 | 1 | Dry-run the approval verdict for a command (never executes it) |
| `dump` |  | 2 | 0 | Dump setup summary for support/debugging |
| `debug` |  | 1 | 0 | Debug tools — upload logs and system info for support |
| `debug share` |  | 7 | 0 | Upload debug report to a paste service and print a shareable URL |
| `debug delete` |  | 1 | 1 | Delete a paste uploaded by 'hermes debug share' |
| `backup` |  | 5 | 0 | Back up Hermes home directory to a zip file |
| `checkpoints` |  | 1 | 0 | Inspect / prune / clear ~/.hermes/checkpoints/ |
| `checkpoints status` |  | 2 | 0 | Show total size, project count, and per-project breakdown |
| `checkpoints list` |  | 2 | 0 | Alias for 'status' |
| `checkpoints prune` |  | 5 | 0 | Delete orphan/stale checkpoints and GC the store |
| `checkpoints clear` |  | 2 | 0 | Delete the entire checkpoint base (all /rollback history) |
| `checkpoints clear-legacy` |  | 2 | 0 | Delete only the legacy-<ts>/ archives from v1 migration |
| `import` |  | 2 | 1 | Restore a Hermes backup from a zip file |
| `import-agent` |  | 6 | 1 | Import a Claude Code or Codex CLI setup into Hermes |
| `config` |  | 1 | 0 | View and edit configuration |
| `config show` |  | 1 | 0 | Show current configuration |
| `config edit` |  | 1 | 0 | Open config file in editor |
| `config get` |  | 3 | 1 | Print a resolved configuration value |
| `config set` |  | 2 | 2 | Set a configuration value |
| `config unset` |  | 1 | 1 | Remove a configuration value |
| `config path` |  | 1 | 0 | Print config file path |
| `config env-path` |  | 1 | 0 | Print .env file path |
| `config check` |  | 1 | 0 | Check for missing/outdated config |
| `config migrate` |  | 1 | 0 | Update config with new options |
| `skin` |  | 1 | 0 | List, switch, and tweak skins |
| `skin list` |  | 1 | 0 | List available skins |
| `skin use` |  | 1 | 1 | Switch the active skin |
| `skin set` |  | 2 | 2 | Set one color of the active skin (e.g. `skin set ui_tool '#00FFFF'`) |
| `console` |  | 1 | 0 | Open the safe Hermes command console |
| `pairing` |  | 1 | 0 | Manage DM pairing codes for user authorization |
| `pairing list` |  | 1 | 0 | Show pending + approved users |
| `pairing approve` |  | 1 | 2 | Approve a pairing request |
| `pairing revoke` |  | 1 | 2 | Revoke user access |
| `pairing clear-pending` |  | 1 | 0 | Clear all pending codes |
| `skills` |  | 1 | 0 | Search, install, configure, and manage skills |
| `skills trust` |  | 1 | 1 | Trust a project so its repo-local skills (./.hermes/skills, ./.agents/skills) load |
| `skills untrust` |  | 1 | 1 | Revoke project-skill trust for a repo |
| `skills browse` |  | 4 | 0 | Browse all available skills (paginated) |
| `skills search` |  | 4 | 1 | Search skill registries |
| `skills install` |  | 5 | 1 | Install a skill |
| `skills inspect` |  | 1 | 1 | Preview a skill without installing |
| `skills list` |  | 3 | 0 | List installed skills |
| `skills check` |  | 1 | 1 | Check installed hub skills for updates |
| `skills update` |  | 2 | 1 | Update installed hub skills |
| `skills audit` |  | 2 | 1 | Re-scan installed hub skills |
| `skills uninstall` |  | 2 | 1 | Remove a hub-installed skill |
| `skills reset` |  | 3 | 1 | Reset a bundled skill — clears 'user-modified' tracking so updates work again |
| `skills list-modified` |  | 2 | 0 | List bundled skills you've edited (which `hermes update` keeps) |
| `skills diff` |  | 1 | 1 | Show how your copy of a bundled skill differs from the stock version |
| `skills opt-out` |  | 3 | 0 | Stop bundled skills from being seeded into this profile |
| `skills opt-in` |  | 2 | 0 | Re-enable bundled-skill seeding (undo opt-out) |
| `skills repair-official` |  | 3 | 1 | Backfill or restore official optional skills from repo source |
| `skills publish` |  | 3 | 1 | Publish a skill to a registry |
| `skills snapshot` |  | 1 | 0 | Export/import skill configurations |
| `skills snapshot export` |  | 1 | 1 | Export installed skills to a file |
| `skills snapshot import` |  | 2 | 1 | Import and install skills from a file |
| `skills tap` |  | 1 | 0 | Manage skill sources |
| `skills tap list` |  | 1 | 0 | List configured taps |
| `skills tap add` |  | 1 | 1 | Add a GitHub repo as skill source |
| `skills tap remove` |  | 1 | 1 | Remove a tap |
| `skills config` |  | 1 | 0 | Interactive skill configuration — enable/disable individual skills |
| `bundles` |  | 1 | 0 | Create, list, and manage skill bundles (aliases for multiple skills) |
| `bundles list` |  | 1 | 0 | List installed skill bundles |
| `bundles show` |  | 1 | 1 | Show one bundle's contents |
| `bundles create` |  | 5 | 1 | Create a new skill bundle |
| `bundles delete` |  | 1 | 1 | Delete a skill bundle |
| `bundles reload` |  | 1 | 0 | Re-scan the bundles directory and report changes |
| `plugins` |  | 1 | 0 | Manage and validate plugins |
| `plugins install` |  | 8 | 1 | Install a plugin from the curated catalog, a Git URL, or owner/repo |
| `plugins search` |  | 2 | 1 | Search the curated Hermes plugin catalog |
| `plugins browse` |  | 1 | 0 | List every curated plugin catalog entry |
| `plugins validate` |  | 3 | 1 | Validate a plugin directory for catalog admission (CI gate) |
| `plugins update` |  | 1 | 1 | Pull latest changes for an installed plugin |
| `plugins adopt` |  | 1 | 1 | Adopt a self-cloned plugin dir into provenance tracking |
| `plugins trust-update-url` |  | 1 | 1 | Confirm a changed plugin update_url into the saved tag |
| `plugins check-updates` | `check` | 2 | 0 | Check whether installed plugins have updates (read-only) |
| `plugins remove` | `rm`, `uninstall` | 1 | 1 | Remove an installed plugin |
| `plugins list` | `ls` | 6 | 0 | List installed plugins |
| `plugins enable` |  | 3 | 1 | Enable a disabled plugin |
| `plugins disable` |  | 1 | 1 | Disable a plugin without removing it |
| `plugins capabilities` |  | 1 | 1 | Show declared vs granted capabilities per plugin |
| `plugins doctor` |  | 2 | 1 | Validate a plugin with the real runtime contracts |
| `plugins pack` |  | 1 | 0 | Declarative, shareable plugin sets (hermes-pack.yaml) |
| `plugins pack install` |  | 2 | 1 | Review and install a pack from a file path or https URL |
| `plugins pack export` |  | 3 | 0 | Emit a pack YAML for the current install on stdout |
| `plugins pack show` |  | 1 | 1 | Dry-run: parse and display a pack without installing |
| `plugins show` | `info` | 1 | 1 | Show details for a single plugin (including emits/listens) |
| `curator` |  | 1 | 0 | Background skill maintenance (curator) — status, run, pause, pin |
| `curator status` |  | 1 | 0 | Show curator status and skill stats |
| `curator usage` |  | 4 | 0 | Show usage telemetry for ALL skills (built-in, hub, agent) with provenance |
| `curator run` |  | 5 | 0 | Trigger a curator review now |
| `curator pause` |  | 1 | 0 | Pause the curator until resumed |
| `curator resume` |  | 1 | 0 | Resume a paused curator |
| `curator pin` |  | 1 | 1 | Pin a skill so the curator never auto-transitions it |
| `curator unpin` |  | 1 | 1 | Unpin a skill |
| `curator list-unmanaged` |  | 1 | 0 | List curation-eligible skills with no provenance marker |
| `curator adopt` |  | 4 | 1 | Hand unmanaged skills to the curator (provenance is a user declaration) |
| `curator restore` |  | 1 | 1 | Restore an archived skill |
| `curator list-archived` |  | 1 | 0 | List archived skills |
| `curator archive` |  | 1 | 1 | Manually archive a skill (move to .archive/, excluded from prompt) |
| `curator prune` |  | 4 | 0 | Bulk-archive curator-managed skills idle for >= N days (default: curator.archive_after_days) |
| `curator backup` |  | 2 | 0 | Take a manual tar.gz snapshot of ~/.hermes/skills/ (curator also does this automatically before every real run) |
| `curator rollback` |  | 4 | 1 | Restore ~/.hermes/skills/ from a curator snapshot, or a single mutation by ledger entry id (see `hermes curator ledger`) |
| `curator ledger` |  | 4 | 0 | List the per-mutation skill audit ledger (all actors: curator/agent/user) |
| `curator purge` |  | 4 | 0 | Delete archived skills older than curator.archive_ttl_days (explicit only — never automatic; recorded in the ledger) |
| `pets` |  | 1 | 0 | Browse, install, and select petdex animated pets |
| `pets list` |  | 3 | 1 | Browse the petdex gallery |
| `pets install` |  | 3 | 1 | Install a pet from the gallery |
| `pets select` |  | 1 | 1 | Set the active pet (writes display.pet.*) |
| `pets show` |  | 6 | 1 | Animate the active pet in the terminal |
| `pets off` |  | 1 | 0 | Disable the pet display |
| `pets scale` |  | 1 | 1 | Resize the pet everywhere (display.pet.scale) |
| `pets remove` |  | 1 | 1 | Delete an installed pet |
| `pets doctor` |  | 1 | 0 | Check pet setup + terminal graphics support |
| `journey` | `learning`, `memory-graph` | 9 | 0 | Timeline of learned skills + memories over time |
| `journey list` |  | 3 | 0 | List node ids (for delete/edit). |
| `journey delete` |  | 2 | 1 | Delete a learned skill (archived) or memory by node id. |
| `journey edit` |  | 1 | 1 | Edit a learned skill or memory by node id in $EDITOR. |
| `memory` |  | 1 | 0 | Configure external memory provider |
| `memory setup` |  | 1 | 1 | Interactive provider selection and configuration |
| `memory status` |  | 1 | 0 | Show current memory provider config |
| `memory off` |  | 1 | 0 | Disable external provider (built-in only) |
| `memory reset` |  | 3 | 0 | Erase all built-in memory (MEMORY.md and USER.md) |
| `tools` |  | 2 | 0 | Configure which tools are enabled per platform |
| `tools list` |  | 2 | 0 | Show all tools and their enabled/disabled status |
| `tools disable` |  | 2 | 1 | Disable toolsets or MCP tools |
| `tools enable` |  | 2 | 1 | Enable toolsets or MCP tools |
| `tools post-setup` |  | 1 | 1 | Run a provider's post-setup install hook (npm/pip/binary) |
| `computer-use` |  | 1 | 0 | Manage the Computer Use (cua-driver) backend (macOS/Windows/Linux) |
| `computer-use install` |  | 2 | 0 | Install or repair the cua-driver binary (macOS/Windows/Linux) |
| `computer-use status` |  | 1 | 0 | Check the selected cua-driver and its runtime contract |
| `computer-use doctor` |  | 4 | 0 | Run cua-driver `health_report` and surface the check matrix |
| `computer-use permissions` |  | 1 | 0 | Check or grant macOS Accessibility + Screen Recording (macOS) |
| `computer-use permissions status` |  | 2 | 0 | Report Accessibility + Screen Recording grant state (read-only) |
| `computer-use permissions grant` |  | 1 | 0 | Request the grants (opens the dialog attributed to CuaDriver) |
| `computer-use screen` |  | 1 | 0 | Bot Desktop: the headless screen this profile's computer_use drives (Linux) |
| `computer-use screen status` |  | 2 | 0 | Show whether this profile's screen is installed/running and who holds control |
| `computer-use screen start` |  | 1 | 0 | Start this profile's screen |
| `computer-use screen stop` |  | 2 | 0 | Stop this profile's screen (hands control back to the agent first) |
| `computer-use screen install` |  | 2 | 0 | Install TigerVNC + Xfce core via the host package manager |
| `mcp` |  | 2 | 0 | Manage MCP servers and run Hermes as an MCP server |
| `mcp serve` |  | 3 | 0 | Run Hermes as an MCP server (expose conversations to other agents) |
| `mcp add` |  | 8 | 1 | Add an MCP server (discovery-first install) |
| `mcp remove` | `rm` | 1 | 1 | Remove an MCP server |
| `mcp list` | `ls` | 1 | 0 | List configured MCP servers |
| `mcp test` |  | 1 | 1 | Test MCP server connection |
| `mcp configure` | `config` | 1 | 1 | Toggle tool selection |
| `mcp login` |  | 2 | 1 | Force re-authentication for an OAuth-based MCP server |
| `mcp reauth` |  | 2 | 1 | Re-authenticate one OAuth MCP server, or all of them (--all) |
| `mcp picker` |  | 1 | 0 | Interactive catalog picker (also the default for `hermes mcp`) |
| `mcp catalog` |  | 1 | 0 | List Nous-approved MCPs available for one-click install |
| `mcp install` |  | 1 | 1 | Install a catalog MCP by name (e.g. `hermes mcp install deepwiki`) |
| `connectors` |  | 1 | 0 | Manage hosted app connectors and their accounts |
| `connectors list` | `ls` | 1 | 0 | Show every connector and whether it is connected |
| `connectors accounts` |  | 2 | 1 | Show connected accounts |
| `connectors connect` |  | 4 | 1 | Connect an app account in your browser |
| `connectors rename` |  | 2 | 2 | Rename an account |
| `connectors disconnect` |  | 3 | 1 | Remove an account |
| `sessions` |  | 1 | 0 | Manage session history (list, rename, export, prune, delete) |
| `sessions list` |  | 4 | 0 | List recent sessions |
| `sessions export` |  | 35 | 1 | Export sessions to JSONL, Markdown, or QMD |
| `sessions delete` |  | 2 | 1 | Delete a specific session |
| `sessions prune` |  | 29 | 0 | Delete old sessions (filterable by time window, source, title, ...) |
| `sessions archive` |  | 25 | 0 | Bulk-archive (soft-hide) sessions matching filters — no deletion |
| `sessions optimize` |  | 2 | 0 | Reclaim disk space: merge FTS5 segments + VACUUM (no data change) |
| `sessions clean-markers` |  | 3 | 0 | Permanently clear stale tool-call marker content left by sessions from before #78148 |
| `sessions optimize-storage` |  | 4 | 0 | Migrate the search index to the compact v23 layout (reclaims disk on large DBs) |
| `sessions repair` |  | 3 | 0 | Repair a malformed state.db schema so hidden sessions reappear |
| `sessions set-journal-mode` |  | 3 | 1 | Convert state.db between journal_mode=WAL and DELETE offline (every holder stopped) |
| `sessions repair-routing` |  | 3 | 0 | Re-stamp gateway sessions that lost their routing identity |
| `sessions repair-profiles` |  | 5 | 0 | Settle session/routing state that landed under the wrong profile |
| `sessions repair-prompts` |  | 3 | 1 | Report or clear stored system prompts degraded to a reduced-toolset build |
| `sessions recover` |  | 8 | 0 | Rebuild canonical session data into a separate clean database |
| `sessions stats` |  | 1 | 0 | Show session store statistics |
| `sessions rename` |  | 1 | 2 | Set or change a session's title |
| `sessions pin` |  | 1 | 1 | Pin session(s) — durable keep flag, exempt from auto-archive |
| `sessions unpin` |  | 1 | 1 | Remove the pin (durable keep flag) from session(s) |
| `sessions pinned` |  | 2 | 0 | List pinned sessions |
| `sessions retitle-skills` |  | 3 | 0 | Re-title sessions whose auto-title came from a /skill's own text |
| `sessions browse` |  | 3 | 0 | Interactive session picker — browse, search, and resume sessions |
| `sessions import` |  | 2 | 1 | Import a Claude Code or Codex CLI session into Hermes |
| `insights` |  | 3 | 0 | Show usage insights and analytics |
| `usage` |  | 3 | 0 | Show account rate-limit windows (the /usage block) without starting a session |
| `monitoring` |  | 1 | 0 | Inspect gateway monitoring (health & diagnostics export) |
| `monitoring status` |  | 1 | 0 | Show monitoring settings, export state, and redaction posture |
| `claw` |  | 1 | 0 | OpenClaw migration tools |
| `claw migrate` |  | 10 | 0 | Migrate from OpenClaw to Hermes |
| `claw cleanup` | `clean` | 4 | 0 | Archive leftover OpenClaw directories after migration |
| `vault` |  | 1 | 0 | Manage the local encrypted autofill vault (add/list/rm credentials) |
| `vault add` |  | 2 | 0 | Save a login, card or address ahead of time (optional: the agent asks you on the page when it needs one) |
| `vault list` |  | 1 | 0 | List vault items (metadata only, never values) |
| `vault rm` |  | 1 | 1 | Remove a vault item by handle |
| `vault sources` |  | 3 | 0 | Show detected password managers (1Password, Bitwarden); they are on automatically |
| `update` |  | 17 | 0 | Update Hermes Agent to the latest version |
| `uninstall` |  | 8 | 0 | Uninstall Hermes Agent |
| `acp` |  | 7 | 0 | Run Hermes Agent as an ACP (Agent Client Protocol) server |
| `profile` |  | 1 | 0 | Manage profiles — multiple isolated Hermes instances |
| `profile list` |  | 1 | 0 | List all profiles |
| `profile use` |  | 1 | 1 | Set sticky default profile |
| `profile create` |  | 9 | 1 | Create a new profile |
| `profile delete` |  | 2 | 1 | Delete a profile |
| `profile describe` |  | 5 | 1 | Read or set a profile's description (used by the kanban orchestrator) |
| `profile show` |  | 1 | 1 | Show profile details |
| `profile alias` |  | 3 | 1 | Manage wrapper scripts |
| `profile rename` |  | 1 | 2 | Rename a profile ('default': sets a display name; id unchanged) |
| `profile purge-identity` |  | 1 | 1 | Retry a deleted profile's session/routing identity purge |
| `profile migrate-identity` |  | 1 | 2 | Retry a renamed profile's session/routing identity migration |
| `profile export` |  | 2 | 1 | Export a profile to archive |
| `profile import` |  | 2 | 1 | Import a profile from archive |
| `profile install` |  | 5 | 1 | Install a profile distribution from a git URL or local directory |
| `profile update` |  | 3 | 1 | Re-pull a distribution and apply updates (user data preserved) |
| `profile info` |  | 1 | 1 | Show a profile's distribution manifest (version, requirements, source) |
| `completion` |  | 1 | 1 | Print shell completion script (bash, zsh, or fish) |
| `dashboard` |  | 11 | 0 | Start the web UI dashboard |
| `dashboard register` |  | 4 | 0 | Register a self-hosted dashboard with Nous Portal (writes the OAuth client ID to .env) |
| `serve` |  | 12 | 0 | Start the Hermes backend server (headless; powers the desktop app and remote backends) |
| `desktop` | `gui` | 13 | 0 | Build and launch the native desktop app |
| `logs` |  | 7 | 1 | View and filter Hermes log files |
| `prompt-size` |  | 3 | 0 | Show a byte breakdown of the system prompt + tool schemas |

Full flag names, choices, defaults, metavariables, help text, and positional definitions are retained in [`CAPABILITY-INVENTORY.json`](CAPABILITY-INVENTORY.json).

## Complete OpenAPI operation inventory

| Method | Path | Operation ID | Scope | Summary |
| --- | --- | --- | --- | --- |
| GET | `/{full_path}` | `serve_spa__full_path__get` | Access/web shell | Serve Spa |
| GET | `/api/actions/{name}/status` | `get_action_status_api_actions__name__status_get` | Hermes control | Get Action Status |
| GET | `/api/analytics/models` | `get_models_analytics_api_analytics_models_get` | Hermes control | Get Models Analytics |
| GET | `/api/analytics/usage` | `get_usage_analytics_api_analytics_usage_get` | Hermes control | Get Usage Analytics |
| GET | `/api/audio/elevenlabs/voices` | `get_elevenlabs_voices_api_audio_elevenlabs_voices_get` | Hermes control | Get Elevenlabs Voices |
| POST | `/api/audio/speak` | `speak_text_api_audio_speak_post` | Hermes control | Speak Text |
| POST | `/api/audio/stt-lease` | `stt_lease_api_audio_stt_lease_post` | Hermes control | Stt Lease |
| POST | `/api/audio/transcribe` | `transcribe_audio_upload_api_audio_transcribe_post` | Hermes control | Transcribe Audio Upload |
| POST | `/api/audio/tts-lease` | `tts_lease_api_audio_tts_lease_post` | Hermes control | Tts Lease |
| GET | `/api/audio/voice-config` | `get_client_voice_config_api_audio_voice_config_get` | Hermes control | Get Client Voice Config |
| POST | `/api/audio/voice-live/session` | `create_voice_live_session_api_audio_voice_live_session_post` | Hermes control | Create Voice Live Session |
| GET | `/api/audio/voice-live/status` | `get_voice_live_status_api_audio_voice_live_status_get` | Hermes control | Get Voice Live Status |
| GET | `/api/auth/me` | `auth_me_api_auth_me_get` | Hermes control | Auth Me |
| GET | `/api/auth/providers` | `auth_providers_api_auth_providers_get` | Hermes control | Auth Providers |
| POST | `/api/auth/ws-ticket` | `auth_ws_ticket_api_auth_ws_ticket_post` | Hermes control | Auth Ws Ticket |
| POST | `/api/chat/image-upload` | `upload_chat_image_api_chat_image_upload_post` | Hermes control | Upload Chat Image |
| GET | `/api/chat/workspaces` | `get_chat_workspaces_api_chat_workspaces_get` | Hermes control | Get Chat Workspaces |
| GET | `/api/config` | `get_config_api_config_get` | Hermes control | Get Config |
| PUT | `/api/config` | `update_config_api_config_put` | Hermes control | Update Config |
| GET | `/api/config/defaults` | `get_defaults_api_config_defaults_get` | Hermes control | Get Defaults |
| GET | `/api/config/raw` | `get_config_raw_api_config_raw_get` | Hermes control | Get Config Raw |
| PUT | `/api/config/raw` | `update_config_raw_api_config_raw_put` | Hermes control | Update Config Raw |
| GET | `/api/config/schema` | `get_schema_api_config_schema_get` | Hermes control | Get Schema |
| GET | `/api/credentials/pool` | `list_credential_pool_api_credentials_pool_get` | Hermes control | List Credential Pool |
| POST | `/api/credentials/pool` | `add_credential_pool_entry_api_credentials_pool_post` | Hermes control | Add Credential Pool Entry |
| DELETE | `/api/credentials/pool/{provider}/{index}` | `remove_credential_pool_entry_api_credentials_pool__provider___index__delete` | Hermes control | Remove Credential Pool Entry |
| GET | `/api/cron/blueprints` | `list_cron_blueprints_api_cron_blueprints_get` | Hermes control | List Cron Blueprints |
| POST | `/api/cron/blueprints/instantiate` | `instantiate_blueprint_api_cron_blueprints_instantiate_post` | Hermes control | Instantiate Blueprint |
| GET | `/api/cron/delivery-targets` | `get_cron_delivery_targets_api_cron_delivery_targets_get` | Hermes control | Get Cron Delivery Targets |
| POST | `/api/cron/fire` | `cron_fire_webhook_api_cron_fire_post` | Hermes control | Cron Fire Webhook |
| GET | `/api/cron/jobs` | `list_cron_jobs_api_cron_jobs_get` | Hermes control | List Cron Jobs |
| POST | `/api/cron/jobs` | `create_cron_job_api_cron_jobs_post` | Hermes control | Create Cron Job |
| DELETE | `/api/cron/jobs/{job_id}` | `delete_cron_job_api_cron_jobs__job_id__delete` | Hermes control | Delete Cron Job |
| GET | `/api/cron/jobs/{job_id}` | `get_cron_job_api_cron_jobs__job_id__get` | Hermes control | Get Cron Job |
| PUT | `/api/cron/jobs/{job_id}` | `update_cron_job_api_cron_jobs__job_id__put` | Hermes control | Update Cron Job |
| POST | `/api/cron/jobs/{job_id}/pause` | `pause_cron_job_api_cron_jobs__job_id__pause_post` | Hermes control | Pause Cron Job |
| POST | `/api/cron/jobs/{job_id}/resume` | `resume_cron_job_api_cron_jobs__job_id__resume_post` | Hermes control | Resume Cron Job |
| GET | `/api/cron/jobs/{job_id}/runs` | `list_cron_job_runs_api_cron_jobs__job_id__runs_get` | Hermes control | List Cron Job Runs |
| POST | `/api/cron/jobs/{job_id}/trigger` | `trigger_cron_job_api_cron_jobs__job_id__trigger_post` | Hermes control | Trigger Cron Job |
| GET | `/api/curator` | `get_curator_status_api_curator_get` | Hermes control | Get Curator Status |
| PUT | `/api/curator/paused` | `set_curator_paused_api_curator_paused_put` | Hermes control | Set Curator Paused |
| POST | `/api/curator/run` | `run_curator_api_curator_run_post` | Hermes control | Run Curator |
| DELETE | `/api/dashboard/agent-plugins/{name}` | `delete_agent_plugin_api_dashboard_agent_plugins__name__delete` | Hermes control | Delete Agent Plugin |
| POST | `/api/dashboard/agent-plugins/{name}/disable` | `post_agent_plugin_disable_api_dashboard_agent_plugins__name__disable_post` | Hermes control | Post Agent Plugin Disable |
| POST | `/api/dashboard/agent-plugins/{name}/enable` | `post_agent_plugin_enable_api_dashboard_agent_plugins__name__enable_post` | Hermes control | Post Agent Plugin Enable |
| POST | `/api/dashboard/agent-plugins/{name}/update` | `post_agent_plugin_update_api_dashboard_agent_plugins__name__update_post` | Hermes control | Post Agent Plugin Update |
| POST | `/api/dashboard/agent-plugins/activate` | `post_agent_plugin_activate_api_dashboard_agent_plugins_activate_post` | Hermes control | Post Agent Plugin Activate |
| POST | `/api/dashboard/agent-plugins/install` | `post_agent_plugin_install_api_dashboard_agent_plugins_install_post` | Hermes control | Post Agent Plugin Install |
| GET | `/api/dashboard/font` | `get_dashboard_font_api_dashboard_font_get` | Hermes control | Get Dashboard Font |
| PUT | `/api/dashboard/font` | `set_dashboard_font_api_dashboard_font_put` | Hermes control | Set Dashboard Font |
| PUT | `/api/dashboard/plugin-providers` | `put_plugin_providers_api_dashboard_plugin_providers_put` | Hermes control | Put Plugin Providers |
| GET | `/api/dashboard/plugins` | `get_dashboard_plugins_api_dashboard_plugins_get` | Hermes control | Get Dashboard Plugins |
| POST | `/api/dashboard/plugins/{name}/visibility` | `post_plugin_visibility_api_dashboard_plugins__name__visibility_post` | Hermes control | Post Plugin Visibility |
| GET | `/api/dashboard/plugins/catalog` | `get_plugins_catalog_api_dashboard_plugins_catalog_get` | Hermes control | Get Plugins Catalog |
| GET | `/api/dashboard/plugins/hub` | `get_plugins_hub_api_dashboard_plugins_hub_get` | Hermes control | Get Plugins Hub |
| GET | `/api/dashboard/plugins/rescan` | `rescan_dashboard_plugins_api_dashboard_plugins_rescan_get` | Hermes control | Rescan Dashboard Plugins |
| PUT | `/api/dashboard/theme` | `set_dashboard_theme_api_dashboard_theme_put` | Hermes control | Set Dashboard Theme |
| GET | `/api/dashboard/themes` | `get_dashboard_themes_api_dashboard_themes_get` | Hermes control | Get Dashboard Themes |
| GET | `/api/egress/status` | `get_egress_status_api_egress_status_get` | Hermes control | Get Egress Status |
| DELETE | `/api/env` | `remove_env_var_api_env_delete` | Hermes control | Remove Env Var |
| GET | `/api/env` | `get_env_vars_api_env_get` | Hermes control | Get Env Vars |
| PUT | `/api/env` | `set_env_var_api_env_put` | Hermes control | Set Env Var |
| POST | `/api/env/reveal` | `reveal_env_var_api_env_reveal_post` | Hermes control | Reveal Env Var |
| DELETE | `/api/files` | `delete_managed_file_api_files_delete` | Hermes control | Delete Managed File |
| GET | `/api/files` | `list_managed_files_api_files_get` | Hermes control | List Managed Files |
| GET | `/api/files/download` | `download_managed_file_api_files_download_get` | Hermes control | Download Managed File |
| POST | `/api/files/mkdir` | `create_managed_directory_api_files_mkdir_post` | Hermes control | Create Managed Directory |
| GET | `/api/files/read` | `read_managed_file_api_files_read_get` | Hermes control | Read Managed File |
| GET | `/api/files/stream` | `stream_managed_file_api_files_stream_get` | Hermes control | Stream Managed File |
| HEAD | `/api/files/stream` | `stream_managed_file_api_files_stream_head` | Hermes control | Stream Managed File |
| POST | `/api/files/upload` | `upload_managed_file_api_files_upload_post` | Hermes control | Upload Managed File |
| POST | `/api/files/upload-stream` | `upload_managed_file_stream_api_files_upload_stream_post` | Hermes control | Upload Managed File Stream |
| GET | `/api/fs/default-cwd` | `fs_default_cwd_api_fs_default_cwd_get` | Hermes control | Fs Default Cwd |
| GET | `/api/fs/download` | `fs_download_api_fs_download_get` | Hermes control | Fs Download |
| GET | `/api/fs/git-root` | `fs_git_root_api_fs_git_root_get` | Hermes control | Fs Git Root |
| GET | `/api/fs/list` | `fs_list_api_fs_list_get` | Hermes control | Fs List |
| GET | `/api/fs/read-data-url` | `fs_read_data_url_api_fs_read_data_url_get` | Hermes control | Fs Read Data Url |
| GET | `/api/fs/read-text` | `fs_read_text_api_fs_read_text_get` | Hermes control | Fs Read Text |
| POST | `/api/fs/write-text` | `fs_write_text_api_fs_write_text_post` | Hermes control | Fs Write Text |
| POST | `/api/gateway/drain` | `gateway_drain_api_gateway_drain_post` | Hermes control | Gateway Drain |
| POST | `/api/gateway/migrate` | `gateway_migrate_api_gateway_migrate_post` | Hermes control | Gateway Migrate |
| GET | `/api/gateway/migrate/plan` | `gateway_migrate_plan_api_gateway_migrate_plan_get` | Hermes control | Gateway Migrate Plan |
| POST | `/api/gateway/restart` | `restart_gateway_api_gateway_restart_post` | Hermes control | Restart Gateway |
| POST | `/api/gateway/start` | `start_gateway_api_gateway_start_post` | Hermes control | Start Gateway |
| POST | `/api/gateway/stop` | `stop_gateway_api_gateway_stop_post` | Hermes control | Stop Gateway |
| GET | `/api/git/base-branches` | `git_base_branches_route_api_git_base_branches_get` | Hermes control | Git Base Branches Route |
| POST | `/api/git/branch/switch` | `git_branch_switch_route_api_git_branch_switch_post` | Hermes control | Git Branch Switch Route |
| GET | `/api/git/branches` | `git_branches_route_api_git_branches_get` | Hermes control | Git Branches Route |
| GET | `/api/git/file-diff` | `git_file_diff_route_api_git_file_diff_get` | Hermes control | Git File Diff Route |
| GET | `/api/git/gh-auth` | `gh_auth_status_route_api_git_gh_auth_get` | Hermes control | Gh Auth Status Route |
| POST | `/api/git/review/commit` | `git_commit_route_api_git_review_commit_post` | Hermes control | Git Commit Route |
| GET | `/api/git/review/commit-context` | `git_commit_context_route_api_git_review_commit_context_get` | Hermes control | Git Commit Context Route |
| POST | `/api/git/review/create-pr` | `git_create_pr_route_api_git_review_create_pr_post` | Hermes control | Git Create Pr Route |
| GET | `/api/git/review/diff` | `git_review_diff_route_api_git_review_diff_get` | Hermes control | Git Review Diff Route |
| GET | `/api/git/review/list` | `git_review_list_route_api_git_review_list_get` | Hermes control | Git Review List Route |
| POST | `/api/git/review/pr-list` | `git_pr_list_route_api_git_review_pr_list_post` | Hermes control | Git Pr List Route |
| POST | `/api/git/review/push` | `git_push_route_api_git_review_push_post` | Hermes control | Git Push Route |
| GET | `/api/git/review/rev-parse` | `git_rev_parse_route_api_git_review_rev_parse_get` | Hermes control | Git Rev Parse Route |
| POST | `/api/git/review/revert` | `git_revert_route_api_git_review_revert_post` | Hermes control | Git Revert Route |
| GET | `/api/git/review/ship-info` | `git_ship_info_route_api_git_review_ship_info_get` | Hermes control | Git Ship Info Route |
| POST | `/api/git/review/stage` | `git_stage_route_api_git_review_stage_post` | Hermes control | Git Stage Route |
| POST | `/api/git/review/unstage` | `git_unstage_route_api_git_review_unstage_post` | Hermes control | Git Unstage Route |
| GET | `/api/git/status` | `git_status_route_api_git_status_get` | Hermes control | Git Status Route |
| POST | `/api/git/worktree/add` | `git_worktree_add_route_api_git_worktree_add_post` | Hermes control | Git Worktree Add Route |
| POST | `/api/git/worktree/remove` | `git_worktree_remove_route_api_git_worktree_remove_post` | Hermes control | Git Worktree Remove Route |
| GET | `/api/git/worktrees` | `git_worktrees_route_api_git_worktrees_get` | Hermes control | Git Worktrees Route |
| GET | `/api/health` | `get_health_api_health_get` | Hermes control | Get Health |
| GET | `/api/health/idle` | `get_health_idle_api_health_idle_get` | Hermes control | Get Health Idle |
| POST | `/api/health/retirement` | `post_health_retirement_api_health_retirement_post` | Hermes control | Post Health Retirement |
| POST | `/api/hermes/update` | `update_hermes_api_hermes_update_post` | Hermes control | Update Hermes |
| GET | `/api/hermes/update/check` | `check_hermes_update_api_hermes_update_check_get` | Hermes control | Check Hermes Update |
| GET | `/api/hermes/update/receipt` | `get_update_receipt_api_hermes_update_receipt_get` | Hermes control | Get Update Receipt |
| GET | `/api/host/identity` | `get_host_identity_api_host_identity_get` | Hermes control | Get Host Identity |
| GET | `/api/learning/graph` | `get_learning_graph_api_learning_graph_get` | Hermes control | Get Learning Graph |
| DELETE | `/api/learning/node` | `delete_learning_node_api_learning_node_delete` | Hermes control | Delete Learning Node |
| GET | `/api/learning/node` | `get_learning_node_api_learning_node_get` | Hermes control | Get Learning Node |
| PUT | `/api/learning/node` | `update_learning_node_api_learning_node_put` | Hermes control | Update Learning Node |
| POST | `/api/local-models/activate` | `local_models_activate_api_local_models_activate_post` | Hermes control | Local Models Activate |
| GET | `/api/local-models/catalog` | `local_models_catalog_api_local_models_catalog_get` | Hermes control | Local Models Catalog |
| POST | `/api/local-models/download` | `local_models_download_api_local_models_download_post` | Hermes control | Local Models Download |
| POST | `/api/local-models/download-browsed` | `local_models_download_browsed_api_local_models_download_browsed_post` | Hermes control | Local Models Download Browsed |
| POST | `/api/local-models/download/pause` | `local_models_download_pause_api_local_models_download_pause_post` | Hermes control | Local Models Download Pause |
| POST | `/api/local-models/download/resume` | `local_models_download_resume_api_local_models_download_resume_post` | Hermes control | Local Models Download Resume |
| POST | `/api/local-models/eject` | `local_models_eject_api_local_models_eject_post` | Hermes control | Local Models Eject |
| GET | `/api/local-models/hardware` | `local_models_hardware_api_local_models_hardware_get` | Hermes control | Local Models Hardware |
| GET | `/api/local-models/jobs` | `local_models_jobs_api_local_models_jobs_get` | Hermes control | Local Models Jobs |
| GET | `/api/local-models/jobs/{job_id}` | `local_models_job_api_local_models_jobs__job_id__get` | Hermes control | Local Models Job |
| DELETE | `/api/local-models/models/{model_id}` | `local_models_delete_api_local_models_models__model_id__delete` | Hermes control | Local Models Delete |
| POST | `/api/local-models/quickstart` | `local_models_quickstart_api_local_models_quickstart_post` | Hermes control | Local Models Quickstart |
| POST | `/api/local-models/runtime/install` | `local_models_runtime_install_api_local_models_runtime_install_post` | Hermes control | Local Models Runtime Install |
| GET | `/api/local-models/search` | `local_models_search_api_local_models_search_get` | Hermes control | Local Models Search |
| GET | `/api/local-models/search/files` | `local_models_search_files_api_local_models_search_files_get` | Hermes control | Local Models Search Files |
| POST | `/api/local-models/server` | `local_models_server_api_local_models_server_post` | Hermes control | Local Models Server |
| POST | `/api/local-models/sideload` | `local_models_sideload_api_local_models_sideload_post` | Hermes control | Local Models Sideload |
| GET | `/api/local-models/status` | `local_models_status_api_local_models_status_get` | Hermes control | Local Models Status |
| GET | `/api/logs` | `get_logs_api_logs_get` | Hermes control | Get Logs |
| GET | `/api/mcp/catalog` | `list_mcp_catalog_api_mcp_catalog_get` | Hermes control | List Mcp Catalog |
| POST | `/api/mcp/catalog/install` | `install_mcp_catalog_entry_api_mcp_catalog_install_post` | Hermes control | Install Mcp Catalog Entry |
| GET | `/api/mcp/oauth/callback/{server_name}` | `mcp_oauth_callback_api_mcp_oauth_callback__server_name__get` | Hermes control | Mcp Oauth Callback |
| DELETE | `/api/mcp/oauth/flows/{flow_id}` | `cancel_mcp_oauth_flow_api_mcp_oauth_flows__flow_id__delete` | Hermes control | Cancel Mcp Oauth Flow |
| GET | `/api/mcp/oauth/flows/{flow_id}` | `mcp_oauth_flow_status_api_mcp_oauth_flows__flow_id__get` | Hermes control | Mcp Oauth Flow Status |
| GET | `/api/mcp/servers` | `list_mcp_servers_api_mcp_servers_get` | Hermes control | List Mcp Servers |
| POST | `/api/mcp/servers` | `add_mcp_server_api_mcp_servers_post` | Hermes control | Add Mcp Server |
| PUT | `/api/mcp/servers` | `replace_mcp_servers_api_mcp_servers_put` | Hermes control | Replace Mcp Servers |
| DELETE | `/api/mcp/servers/{name}` | `remove_mcp_server_api_mcp_servers__name__delete` | Hermes control | Remove Mcp Server |
| POST | `/api/mcp/servers/{name}/auth` | `auth_mcp_server_api_mcp_servers__name__auth_post` | Hermes control | Auth Mcp Server |
| PUT | `/api/mcp/servers/{name}/enabled` | `set_mcp_server_enabled_api_mcp_servers__name__enabled_put` | Hermes control | Set Mcp Server Enabled |
| POST | `/api/mcp/servers/{name}/test` | `test_mcp_server_api_mcp_servers__name__test_post` | Hermes control | Test Mcp Server |
| GET | `/api/media` | `get_media_api_media_get` | Hermes control | Get Media |
| GET | `/api/media/proxy` | `proxy_remote_media_api_media_proxy_get` | Hermes control | Proxy Remote Media |
| GET | `/api/memory` | `get_memory_status_api_memory_get` | Hermes control | Get Memory Status |
| PUT | `/api/memory/provider` | `set_memory_provider_api_memory_provider_put` | Hermes control | Set Memory Provider |
| GET | `/api/memory/providers/{name}/config` | `get_memory_provider_config_api_memory_providers__name__config_get` | Hermes control | Get Memory Provider Config |
| PUT | `/api/memory/providers/{name}/config` | `update_memory_provider_config_api_memory_providers__name__config_put` | Hermes control | Update Memory Provider Config |
| POST | `/api/memory/providers/{name}/setup` | `setup_memory_provider_api_memory_providers__name__setup_post` | Hermes control | Setup Memory Provider |
| POST | `/api/memory/providers/{provider}/oauth/start` | `start_memory_oauth_api_memory_providers__provider__oauth_start_post` | Hermes control | Start Memory Oauth |
| GET | `/api/memory/providers/{provider}/oauth/status` | `memory_oauth_status_api_memory_providers__provider__oauth_status_get` | Hermes control | Memory Oauth Status |
| POST | `/api/memory/reset` | `reset_memory_api_memory_reset_post` | Hermes control | Reset Memory |
| GET | `/api/messaging/platforms` | `get_messaging_platforms_api_messaging_platforms_get` | Hermes control | Get Messaging Platforms |
| PUT | `/api/messaging/platforms/{platform_id}` | `update_messaging_platform_api_messaging_platforms__platform_id__put` | Hermes control | Update Messaging Platform |
| POST | `/api/messaging/platforms/{platform_id}/test` | `test_messaging_platform_api_messaging_platforms__platform_id__test_post` | Hermes control | Test Messaging Platform |
| DELETE | `/api/messaging/telegram/onboarding/{pairing_id}` | `cancel_telegram_onboarding_api_messaging_telegram_onboarding__pairing_id__delete` | Hermes control | Cancel Telegram Onboarding |
| GET | `/api/messaging/telegram/onboarding/{pairing_id}` | `get_telegram_onboarding_status_api_messaging_telegram_onboarding__pairing_id__get` | Hermes control | Get Telegram Onboarding Status |
| POST | `/api/messaging/telegram/onboarding/{pairing_id}/apply` | `apply_telegram_onboarding_api_messaging_telegram_onboarding__pairing_id__apply_post` | Hermes control | Apply Telegram Onboarding |
| POST | `/api/messaging/telegram/onboarding/start` | `start_telegram_onboarding_api_messaging_telegram_onboarding_start_post` | Hermes control | Start Telegram Onboarding |
| DELETE | `/api/messaging/whatsapp/onboarding/{pairing_id}` | `cancel_whatsapp_onboarding_api_messaging_whatsapp_onboarding__pairing_id__delete` | Hermes control | Cancel Whatsapp Onboarding |
| GET | `/api/messaging/whatsapp/onboarding/{pairing_id}` | `get_whatsapp_onboarding_status_api_messaging_whatsapp_onboarding__pairing_id__get` | Hermes control | Get Whatsapp Onboarding Status |
| POST | `/api/messaging/whatsapp/onboarding/{pairing_id}/apply` | `apply_whatsapp_onboarding_api_messaging_whatsapp_onboarding__pairing_id__apply_post` | Hermes control | Apply Whatsapp Onboarding |
| POST | `/api/messaging/whatsapp/onboarding/start` | `start_whatsapp_onboarding_api_messaging_whatsapp_onboarding_start_post` | Hermes control | Start Whatsapp Onboarding |
| GET | `/api/model/auxiliary` | `get_auxiliary_models_api_model_auxiliary_get` | Hermes control | Get Auxiliary Models |
| GET | `/api/model/info` | `get_model_info_api_model_info_get` | Hermes control | Get Model Info |
| GET | `/api/model/moa` | `get_moa_models_api_model_moa_get` | Hermes control | Get Moa Models |
| PUT | `/api/model/moa` | `set_moa_models_api_model_moa_put` | Hermes control | Set Moa Models |
| GET | `/api/model/options` | `get_model_options_api_model_options_get` | Hermes control | Get Model Options |
| GET | `/api/model/recommended-default` | `get_recommended_default_model_api_model_recommended_default_get` | Hermes control | Get Recommended Default Model |
| POST | `/api/model/set` | `set_model_assignment_api_model_set_post` | Hermes control | Set Model Assignment |
| POST | `/api/ops/backup` | `run_backup_api_ops_backup_post` | Hermes control | Run Backup |
| GET | `/api/ops/backup/download` | `download_dashboard_backup_api_ops_backup_download_get` | Hermes control | Download Dashboard Backup |
| GET | `/api/ops/checkpoints` | `list_checkpoints_api_ops_checkpoints_get` | Hermes control | List Checkpoints |
| POST | `/api/ops/checkpoints/prune` | `prune_checkpoints_api_ops_checkpoints_prune_post` | Hermes control | Prune Checkpoints |
| POST | `/api/ops/config-migrate` | `run_config_migrate_api_ops_config_migrate_post` | Hermes control | Run Config Migrate |
| POST | `/api/ops/debug-share` | `run_debug_share_endpoint_api_ops_debug_share_post` | Hermes control | Run Debug Share Endpoint |
| POST | `/api/ops/doctor` | `run_doctor_api_ops_doctor_post` | Hermes control | Run Doctor |
| POST | `/api/ops/dump` | `run_dump_api_ops_dump_post` | Hermes control | Run Dump |
| DELETE | `/api/ops/hooks` | `delete_hook_api_ops_hooks_delete` | Hermes control | Delete Hook |
| GET | `/api/ops/hooks` | `list_hooks_api_ops_hooks_get` | Hermes control | List Hooks |
| POST | `/api/ops/hooks` | `create_hook_api_ops_hooks_post` | Hermes control | Create Hook |
| POST | `/api/ops/import` | `run_import_api_ops_import_post` | Hermes control | Run Import |
| POST | `/api/ops/import-upload` | `run_import_upload_api_ops_import_upload_post` | Hermes control | Run Import Upload |
| POST | `/api/ops/prompt-size` | `run_prompt_size_api_ops_prompt_size_post` | Hermes control | Run Prompt Size |
| POST | `/api/ops/security-audit` | `run_security_audit_api_ops_security_audit_post` | Hermes control | Run Security Audit |
| GET | `/api/pairing` | `list_pairing_api_pairing_get` | Hermes control | List Pairing |
| POST | `/api/pairing/approve` | `approve_pairing_api_pairing_approve_post` | Hermes control | Approve Pairing |
| POST | `/api/pairing/clear-pending` | `clear_pending_pairing_api_pairing_clear_pending_post` | Hermes control | Clear Pending Pairing |
| POST | `/api/pairing/revoke` | `revoke_pairing_api_pairing_revoke_post` | Hermes control | Revoke Pairing |
| GET | `/api/plugins/hermes-achievements/achievements` | `achievements_api_plugins_hermes_achievements_achievements_get` | Hermes control | Achievements |
| GET | `/api/plugins/hermes-achievements/recent-unlocks` | `recent_unlocks_api_plugins_hermes_achievements_recent_unlocks_get` | Hermes control | Recent Unlocks |
| POST | `/api/plugins/hermes-achievements/rescan` | `rescan_api_plugins_hermes_achievements_rescan_post` | Hermes control | Rescan |
| POST | `/api/plugins/hermes-achievements/reset-state` | `reset_state_api_plugins_hermes_achievements_reset_state_post` | Hermes control | Reset State |
| GET | `/api/plugins/hermes-achievements/scan-status` | `scan_status_api_plugins_hermes_achievements_scan_status_get` | Hermes control | Scan Status |
| GET | `/api/plugins/hermes-achievements/sessions/{session_id}/badges` | `session_badges_api_plugins_hermes_achievements_sessions__session_id__badges_get` | Hermes control | Session Badges |
| GET | `/api/plugins/judge-m-control-plane/health` | `health_api_plugins_judge_m_control_plane_health_get` | Hermes control | Health |
| GET | `/api/plugins/judge-m-control-plane/links` | `links_api_plugins_judge_m_control_plane_links_get` | Hermes control | Links |
| GET | `/api/plugins/judge-m-control-plane/model-menu` | `model_menu_api_plugins_judge_m_control_plane_model_menu_get` | Hermes control | Model Menu |
| POST | `/api/plugins/judge-m-control-plane/model-menu` | `save_model_menu_api_plugins_judge_m_control_plane_model_menu_post` | Hermes control | Save Model Menu |
| GET | `/api/plugins/judge-m-control-plane/overview` | `overview_api_plugins_judge_m_control_plane_overview_get` | Hermes control | Overview |
| GET | `/api/plugins/kanban/assignees` | `get_assignees_api_plugins_kanban_assignees_get` | Hermes control | Get Assignees |
| DELETE | `/api/plugins/kanban/attachments/{attachment_id}` | `remove_attachment_api_plugins_kanban_attachments__attachment_id__delete` | Hermes control | Remove Attachment |
| GET | `/api/plugins/kanban/attachments/{attachment_id}` | `download_attachment_api_plugins_kanban_attachments__attachment_id__get` | Hermes control | Download Attachment |
| GET | `/api/plugins/kanban/board` | `get_board_endpoint_api_plugins_kanban_board_get` | Hermes control | Get Board Endpoint |
| GET | `/api/plugins/kanban/boards` | `list_boards_api_plugins_kanban_boards_get` | Hermes control | List Boards |
| POST | `/api/plugins/kanban/boards` | `create_board_endpoint_api_plugins_kanban_boards_post` | Hermes control | Create Board Endpoint |
| DELETE | `/api/plugins/kanban/boards/{slug}` | `delete_board_api_plugins_kanban_boards__slug__delete` | Hermes control | Delete Board |
| PATCH | `/api/plugins/kanban/boards/{slug}` | `rename_board_api_plugins_kanban_boards__slug__patch` | Hermes control | Rename Board |
| POST | `/api/plugins/kanban/boards/{slug}/export` | `export_board_endpoint_api_plugins_kanban_boards__slug__export_post` | Hermes control | Export Board Endpoint |
| POST | `/api/plugins/kanban/boards/{slug}/switch` | `switch_board_api_plugins_kanban_boards__slug__switch_post` | Hermes control | Switch Board |
| POST | `/api/plugins/kanban/boards/import` | `import_board_endpoint_api_plugins_kanban_boards_import_post` | Hermes control | Import Board Endpoint |
| GET | `/api/plugins/kanban/config` | `get_config_api_plugins_kanban_config_get` | Hermes control | Get Config |
| GET | `/api/plugins/kanban/diagnostics` | `list_diagnostics_api_plugins_kanban_diagnostics_get` | Hermes control | List Diagnostics |
| POST | `/api/plugins/kanban/dispatch` | `dispatch_api_plugins_kanban_dispatch_post` | Hermes control | Dispatch |
| POST | `/api/plugins/kanban/estimate` | `estimate_text_endpoint_api_plugins_kanban_estimate_post` | Hermes control | Estimate Text Endpoint |
| GET | `/api/plugins/kanban/home-channels` | `get_home_channels_api_plugins_kanban_home_channels_get` | Hermes control | Get Home Channels |
| DELETE | `/api/plugins/kanban/links` | `delete_link_api_plugins_kanban_links_delete` | Hermes control | Delete Link |
| POST | `/api/plugins/kanban/links` | `add_link_api_plugins_kanban_links_post` | Hermes control | Add Link |
| GET | `/api/plugins/kanban/model-options` | `model_options_api_plugins_kanban_model_options_get` | Hermes control | Model Options |
| GET | `/api/plugins/kanban/orchestration` | `get_orchestration_settings_api_plugins_kanban_orchestration_get` | Hermes control | Get Orchestration Settings |
| PUT | `/api/plugins/kanban/orchestration` | `set_orchestration_settings_api_plugins_kanban_orchestration_put` | Hermes control | Set Orchestration Settings |
| GET | `/api/plugins/kanban/profiles` | `list_profile_roster_api_plugins_kanban_profiles_get` | Hermes control | List Profile Roster |
| PATCH | `/api/plugins/kanban/profiles/{profile_name}` | `update_profile_description_api_plugins_kanban_profiles__profile_name__patch` | Hermes control | Update Profile Description |
| POST | `/api/plugins/kanban/profiles/{profile_name}/describe-auto` | `auto_describe_profile_api_plugins_kanban_profiles__profile_name__describe_auto_post` | Hermes control | Auto Describe Profile |
| GET | `/api/plugins/kanban/projects` | `list_kanban_projects_api_plugins_kanban_projects_get` | Hermes control | List Kanban Projects |
| GET | `/api/plugins/kanban/runs/{run_id}` | `get_run_endpoint_api_plugins_kanban_runs__run_id__get` | Hermes control | Get Run Endpoint |
| GET | `/api/plugins/kanban/runs/{run_id}/inspect` | `inspect_run_endpoint_api_plugins_kanban_runs__run_id__inspect_get` | Hermes control | Inspect Run Endpoint |
| POST | `/api/plugins/kanban/runs/{run_id}/terminate` | `terminate_run_endpoint_api_plugins_kanban_runs__run_id__terminate_post` | Hermes control | Terminate Run Endpoint |
| GET | `/api/plugins/kanban/stats` | `get_stats_api_plugins_kanban_stats_get` | Hermes control | Get Stats |
| POST | `/api/plugins/kanban/tasks` | `create_task_api_plugins_kanban_tasks_post` | Hermes control | Create Task |
| DELETE | `/api/plugins/kanban/tasks/{task_id}` | `delete_task_api_plugins_kanban_tasks__task_id__delete` | Hermes control | Delete Task |
| GET | `/api/plugins/kanban/tasks/{task_id}` | `get_task_api_plugins_kanban_tasks__task_id__get` | Hermes control | Get Task |
| PATCH | `/api/plugins/kanban/tasks/{task_id}` | `update_task_api_plugins_kanban_tasks__task_id__patch` | Hermes control | Update Task |
| GET | `/api/plugins/kanban/tasks/{task_id}/attachments` | `list_task_attachments_api_plugins_kanban_tasks__task_id__attachments_get` | Hermes control | List Task Attachments |
| POST | `/api/plugins/kanban/tasks/{task_id}/attachments` | `upload_task_attachment_api_plugins_kanban_tasks__task_id__attachments_post` | Hermes control | Upload Task Attachment |
| POST | `/api/plugins/kanban/tasks/{task_id}/comments` | `add_comment_api_plugins_kanban_tasks__task_id__comments_post` | Hermes control | Add Comment |
| POST | `/api/plugins/kanban/tasks/{task_id}/decompose` | `decompose_task_endpoint_api_plugins_kanban_tasks__task_id__decompose_post` | Hermes control | Decompose Task Endpoint |
| POST | `/api/plugins/kanban/tasks/{task_id}/estimate` | `estimate_task_endpoint_api_plugins_kanban_tasks__task_id__estimate_post` | Hermes control | Estimate Task Endpoint |
| DELETE | `/api/plugins/kanban/tasks/{task_id}/home-subscribe/{platform}` | `unsubscribe_home_api_plugins_kanban_tasks__task_id__home_subscribe__platform__delete` | Hermes control | Unsubscribe Home |
| POST | `/api/plugins/kanban/tasks/{task_id}/home-subscribe/{platform}` | `subscribe_home_api_plugins_kanban_tasks__task_id__home_subscribe__platform__post` | Hermes control | Subscribe Home |
| GET | `/api/plugins/kanban/tasks/{task_id}/log` | `get_task_log_api_plugins_kanban_tasks__task_id__log_get` | Hermes control | Get Task Log |
| POST | `/api/plugins/kanban/tasks/{task_id}/reassign` | `reassign_task_endpoint_api_plugins_kanban_tasks__task_id__reassign_post` | Hermes control | Reassign Task Endpoint |
| POST | `/api/plugins/kanban/tasks/{task_id}/reclaim` | `reclaim_task_endpoint_api_plugins_kanban_tasks__task_id__reclaim_post` | Hermes control | Reclaim Task Endpoint |
| POST | `/api/plugins/kanban/tasks/{task_id}/specify` | `specify_task_endpoint_api_plugins_kanban_tasks__task_id__specify_post` | Hermes control | Specify Task Endpoint |
| POST | `/api/plugins/kanban/tasks/bulk` | `bulk_update_api_plugins_kanban_tasks_bulk_post` | Hermes control | Bulk Update |
| GET | `/api/plugins/kanban/workers/active` | `list_active_workers_api_plugins_kanban_workers_active_get` | Hermes control | List Active Workers |
| GET | `/api/plugins/kanban/workflow` | `get_workflow_api_plugins_kanban_workflow_get` | Hermes control | Get Workflow |
| GET | `/api/portal` | `get_portal_status_api_portal_get` | Hermes control | Get Portal Status |
| GET | `/api/profiles` | `list_profiles_endpoint_api_profiles_get` | Hermes control | List Profiles Endpoint |
| POST | `/api/profiles` | `create_profile_endpoint_api_profiles_post` | Hermes control | Create Profile Endpoint |
| DELETE | `/api/profiles/{name}` | `delete_profile_endpoint_api_profiles__name__delete` | Hermes control | Delete Profile Endpoint |
| PATCH | `/api/profiles/{name}` | `rename_profile_endpoint_api_profiles__name__patch` | Hermes control | Rename Profile Endpoint |
| POST | `/api/profiles/{name}/describe-auto` | `describe_profile_auto_endpoint_api_profiles__name__describe_auto_post` | Hermes control | Describe Profile Auto Endpoint |
| PUT | `/api/profiles/{name}/description` | `update_profile_description_endpoint_api_profiles__name__description_put` | Hermes control | Update Profile Description Endpoint |
| GET | `/api/profiles/{name}/desktop-overlay` | `get_profile_desktop_overlay_api_profiles__name__desktop_overlay_get` | Hermes control | Get Profile Desktop Overlay |
| POST | `/api/profiles/{name}/export` | `export_profile_endpoint_api_profiles__name__export_post` | Hermes control | Export Profile Endpoint |
| PUT | `/api/profiles/{name}/model` | `update_profile_model_endpoint_api_profiles__name__model_put` | Hermes control | Update Profile Model Endpoint |
| POST | `/api/profiles/{name}/open-terminal` | `open_profile_terminal_endpoint_api_profiles__name__open_terminal_post` | Hermes control | Open Profile Terminal Endpoint |
| GET | `/api/profiles/{name}/setup-command` | `get_profile_setup_command_api_profiles__name__setup_command_get` | Hermes control | Get Profile Setup Command |
| GET | `/api/profiles/{name}/soul` | `get_profile_soul_api_profiles__name__soul_get` | Hermes control | Get Profile Soul |
| PUT | `/api/profiles/{name}/soul` | `update_profile_soul_api_profiles__name__soul_put` | Hermes control | Update Profile Soul |
| GET | `/api/profiles/active` | `get_active_profile_endpoint_api_profiles_active_get` | Hermes control | Get Active Profile Endpoint |
| POST | `/api/profiles/active` | `set_active_profile_endpoint_api_profiles_active_post` | Hermes control | Set Active Profile Endpoint |
| POST | `/api/profiles/import` | `import_profile_endpoint_api_profiles_import_post` | Hermes control | Import Profile Endpoint |
| GET | `/api/profiles/projects/tree` | `get_profiles_projects_tree_api_profiles_projects_tree_get` | Hermes control | Get Profiles Projects Tree |
| GET | `/api/profiles/sessions` | `get_profiles_sessions_api_profiles_sessions_get` | Hermes control | Get Profiles Sessions |
| POST | `/api/profiles/sessions/pull-requests` | `post_profiles_sessions_pull_requests_api_profiles_sessions_pull_requests_post` | Hermes control | Post Profiles Sessions Pull Requests |
| GET | `/api/profiles/sessions/sidebar` | `get_profiles_sessions_sidebar_api_profiles_sessions_sidebar_get` | Hermes control | Get Profiles Sessions Sidebar |
| GET | `/api/providers/custom-endpoints` | `list_custom_endpoints_api_providers_custom_endpoints_get` | Hermes control | List Custom Endpoints |
| POST | `/api/providers/custom-endpoints` | `upsert_custom_endpoint_api_providers_custom_endpoints_post` | Hermes control | Upsert Custom Endpoint |
| DELETE | `/api/providers/custom-endpoints/{endpoint_id}` | `delete_custom_endpoint_api_providers_custom_endpoints__endpoint_id__delete` | Hermes control | Delete Custom Endpoint |
| POST | `/api/providers/custom-endpoints/{endpoint_id}/activate` | `activate_custom_endpoint_api_providers_custom_endpoints__endpoint_id__activate_post` | Hermes control | Activate Custom Endpoint |
| POST | `/api/providers/custom-endpoints/validate` | `validate_custom_endpoint_api_providers_custom_endpoints_validate_post` | Hermes control | Validate Custom Endpoint |
| GET | `/api/providers/oauth` | `list_oauth_providers_api_providers_oauth_get` | Hermes control | List Oauth Providers |
| DELETE | `/api/providers/oauth/{provider_id}` | `disconnect_oauth_provider_api_providers_oauth__provider_id__delete` | Hermes control | Disconnect Oauth Provider |
| GET | `/api/providers/oauth/{provider_id}/poll/{session_id}` | `poll_oauth_session_api_providers_oauth__provider_id__poll__session_id__get` | Hermes control | Poll Oauth Session |
| POST | `/api/providers/oauth/{provider_id}/start` | `start_oauth_login_api_providers_oauth__provider_id__start_post` | Hermes control | Start Oauth Login |
| POST | `/api/providers/oauth/{provider_id}/submit` | `submit_oauth_code_api_providers_oauth__provider_id__submit_post` | Hermes control | Submit Oauth Code |
| DELETE | `/api/providers/oauth/sessions/{session_id}` | `cancel_oauth_session_api_providers_oauth_sessions__session_id__delete` | Hermes control | Cancel Oauth Session |
| POST | `/api/providers/validate` | `validate_provider_credential_api_providers_validate_post` | Hermes control | Validate Provider Credential |
| GET | `/api/sessions` | `get_sessions_api_sessions_get` | Hermes control | Get Sessions |
| DELETE | `/api/sessions/{session_id}` | `delete_session_endpoint_api_sessions__session_id__delete` | Hermes control | Delete Session Endpoint |
| GET | `/api/sessions/{session_id}` | `get_session_detail_api_sessions__session_id__get` | Hermes control | Get Session Detail |
| PATCH | `/api/sessions/{session_id}` | `rename_session_endpoint_api_sessions__session_id__patch` | Hermes control | Rename Session Endpoint |
| GET | `/api/sessions/{session_id}/export` | `export_session_endpoint_api_sessions__session_id__export_get` | Hermes control | Export Session Endpoint |
| GET | `/api/sessions/{session_id}/latest-descendant` | `get_session_latest_descendant_api_sessions__session_id__latest_descendant_get` | Hermes control | Get Session Latest Descendant |
| GET | `/api/sessions/{session_id}/messages` | `get_session_messages_api_sessions__session_id__messages_get` | Hermes control | Get Session Messages |
| GET | `/api/sessions/{session_id}/messages/around` | `get_session_messages_around_api_sessions__session_id__messages_around_get` | Hermes control | Get Session Messages Around |
| GET | `/api/sessions/{session_id}/timeline` | `get_session_timeline_api_sessions__session_id__timeline_get` | Hermes control | Get Session Timeline |
| POST | `/api/sessions/bulk-delete` | `bulk_delete_sessions_endpoint_api_sessions_bulk_delete_post` | Hermes control | Bulk Delete Sessions Endpoint |
| DELETE | `/api/sessions/empty` | `delete_empty_sessions_endpoint_api_sessions_empty_delete` | Hermes control | Delete Empty Sessions Endpoint |
| GET | `/api/sessions/empty/count` | `count_empty_sessions_endpoint_api_sessions_empty_count_get` | Hermes control | Count Empty Sessions Endpoint |
| POST | `/api/sessions/import` | `import_sessions_endpoint_api_sessions_import_post` | Hermes control | Import Sessions Endpoint |
| POST | `/api/sessions/owner-backfill` | `backfill_session_owner_profiles_api_sessions_owner_backfill_post` | Hermes control | Backfill Session Owner Profiles |
| POST | `/api/sessions/prune` | `prune_sessions_endpoint_api_sessions_prune_post` | Hermes control | Prune Sessions Endpoint |
| GET | `/api/sessions/search` | `search_sessions_api_sessions_search_get` | Hermes control | Search Sessions |
| GET | `/api/sessions/stats` | `get_session_stats_api_sessions_stats_get` | Hermes control | Get Session Stats |
| GET | `/api/shared-metrics/consent` | `get_shared_metrics_consent_api_shared_metrics_consent_get` | Hermes control | Get Shared Metrics Consent |
| PUT | `/api/shared-metrics/consent` | `put_shared_metrics_consent_api_shared_metrics_consent_put` | Hermes control | Put Shared Metrics Consent |
| GET | `/api/skills` | `get_skills_api_skills_get` | Hermes control | Get Skills |
| POST | `/api/skills` | `create_skill_api_skills_post` | Hermes control | Create Skill |
| GET | `/api/skills/content` | `get_skill_content_api_skills_content_get` | Hermes control | Get Skill Content |
| PUT | `/api/skills/content` | `update_skill_content_api_skills_content_put` | Hermes control | Update Skill Content |
| POST | `/api/skills/hub/install` | `install_skill_hub_api_skills_hub_install_post` | Hermes control | Install Skill Hub |
| GET | `/api/skills/hub/official` | `list_official_skills_api_skills_hub_official_get` | Hermes control | List Official Skills |
| GET | `/api/skills/hub/preview` | `preview_skill_hub_api_skills_hub_preview_get` | Hermes control | Preview Skill Hub |
| GET | `/api/skills/hub/scan` | `scan_skill_hub_api_skills_hub_scan_get` | Hermes control | Scan Skill Hub |
| GET | `/api/skills/hub/search` | `search_skills_hub_api_skills_hub_search_get` | Hermes control | Search Skills Hub |
| GET | `/api/skills/hub/sources` | `list_skills_hub_sources_api_skills_hub_sources_get` | Hermes control | List Skills Hub Sources |
| POST | `/api/skills/hub/uninstall` | `uninstall_skill_hub_api_skills_hub_uninstall_post` | Hermes control | Uninstall Skill Hub |
| POST | `/api/skills/hub/update` | `update_skills_hub_api_skills_hub_update_post` | Hermes control | Update Skills Hub |
| PUT | `/api/skills/toggle` | `toggle_skill_api_skills_toggle_put` | Hermes control | Toggle Skill |
| GET | `/api/ssh/ownership` | `get_ssh_ownership_api_ssh_ownership_get` | Hermes control | Get Ssh Ownership |
| GET | `/api/status` | `get_status_api_status_get` | Hermes control | Get Status |
| GET | `/api/system/stats` | `get_system_stats_api_system_stats_get` | Hermes control | Get System Stats |
| POST | `/api/tools/computer-use/permissions/grant` | `grant_computer_use_permissions_api_tools_computer_use_permissions_grant_post` | Hermes control | Grant Computer Use Permissions |
| GET | `/api/tools/computer-use/status` | `get_computer_use_status_api_tools_computer_use_status_get` | Hermes control | Get Computer Use Status |
| PUT | `/api/tools/terminal/backend` | `select_terminal_backend_api_tools_terminal_backend_put` | Hermes control | Select Terminal Backend |
| GET | `/api/tools/terminal/backends` | `get_terminal_backends_api_tools_terminal_backends_get` | Hermes control | Get Terminal Backends |
| GET | `/api/tools/toolsets` | `get_toolsets_api_tools_toolsets_get` | Hermes control | Get Toolsets |
| PUT | `/api/tools/toolsets/{name}` | `toggle_toolset_api_tools_toolsets__name__put` | Hermes control | Toggle Toolset |
| GET | `/api/tools/toolsets/{name}/config` | `get_toolset_config_api_tools_toolsets__name__config_get` | Hermes control | Get Toolset Config |
| PUT | `/api/tools/toolsets/{name}/env` | `save_toolset_env_api_tools_toolsets__name__env_put` | Hermes control | Save Toolset Env |
| PUT | `/api/tools/toolsets/{name}/model` | `select_toolset_model_api_tools_toolsets__name__model_put` | Hermes control | Select Toolset Model |
| GET | `/api/tools/toolsets/{name}/models` | `get_toolset_models_api_tools_toolsets__name__models_get` | Hermes control | Get Toolset Models |
| POST | `/api/tools/toolsets/{name}/post-setup` | `run_toolset_post_setup_api_tools_toolsets__name__post_setup_post` | Hermes control | Run Toolset Post Setup |
| PUT | `/api/tools/toolsets/{name}/provider` | `select_toolset_provider_api_tools_toolsets__name__provider_put` | Hermes control | Select Toolset Provider |
| GET | `/api/webhooks` | `list_webhooks_api_webhooks_get` | Hermes control | List Webhooks |
| POST | `/api/webhooks` | `create_webhook_api_webhooks_post` | Hermes control | Create Webhook |
| DELETE | `/api/webhooks/{name}` | `delete_webhook_api_webhooks__name__delete` | Hermes control | Delete Webhook |
| PUT | `/api/webhooks/{name}/enabled` | `set_webhook_enabled_api_webhooks__name__enabled_put` | Hermes control | Set Webhook Enabled |
| POST | `/api/webhooks/enable` | `enable_webhooks_api_webhooks_enable_post` | Hermes control | Enable Webhooks |
| GET | `/assets/{filename}.css` | `serve_css_assets__filename__css_get` | Access/web shell | Serve Css |
| GET | `/auth/callback` | `auth_callback_auth_callback_get` | Access/web shell | Auth Callback |
| GET | `/auth/login` | `auth_login_auth_login_get` | Access/web shell | Auth Login |
| POST | `/auth/logout` | `auth_logout_auth_logout_post` | Access/web shell | Auth Logout |
| GET | `/auth/native/authorize` | `auth_native_authorize_auth_native_authorize_get` | Access/web shell | Auth Native Authorize |
| POST | `/auth/native/refresh` | `auth_native_refresh_auth_native_refresh_post` | Access/web shell | Auth Native Refresh |
| POST | `/auth/native/token` | `auth_native_token_auth_native_token_post` | Access/web shell | Auth Native Token |
| POST | `/auth/password-login` | `auth_password_login_auth_password_login_post` | Access/web shell | Auth Password Login |
| GET | `/dashboard-plugins/{plugin_name}/{file_path}` | `serve_plugin_asset_dashboard_plugins__plugin_name___file_path__get` | Access/web shell | Serve Plugin Asset |
| GET | `/login` | `login_page_login_get` | Access/web shell | Login Page |

Request parameter signatures and accepted request-body media types are retained in [`CAPABILITY-INVENTORY.json`](CAPABILITY-INVENTORY.json).

## Rebuild

```sh
node scripts/build-capability-inventory.mjs /path/to/hermes-cli-inventory.json /path/to/hermes-openapi.json
```

The generator exits with an error if the installed CLI gains or loses a top-level family without a corresponding reviewed classification.

