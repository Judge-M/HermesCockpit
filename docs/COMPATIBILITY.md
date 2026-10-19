# Compatibility

Hermes Cockpit releases are tied to a verified Hermes Agent runtime. The web
application can render without Hermes, but its live controls and server plugin
must match the installed Hermes API and CLI contracts.

| Cockpit | Hermes Agent | Hermes commit | Support level |
| --- | --- | --- | --- |
| `0.4.x` | `0.21.7` | `71d34bad1045610252eda02ee79549436896e784` | Fully verified |

The compatibility job checks both Cockpit runtime patches against the official
Hermes tag. The capability inventory was generated from the same commit and
records 348 API operations and 170 reviewed CLI bridge operations.

## Other Hermes versions

The installer stops if the runtime patches do not apply cleanly. Do not force a
failed patch. A newer Hermes version may change API schemas, CLI arguments,
plugin hooks, or session behavior even when the Cockpit pages still load.

`--skip-patches` installs only the Cockpit plugin. This is useful for inspection
or a deliberately reduced setup, but semantic routing for subagents, auxiliary
models, and memory is not complete in that mode.

Before declaring another Hermes version supported:

1. regenerate and review the API/CLI capability inventory;
2. rebase both runtime patches onto the exact upstream tag;
3. run the CLI bridge validator in Hermes' managed Python runtime;
4. run the browser smoke suite against a live deployment;
5. exercise Chat, Bot Mode, Models, Manage, Browser preview, and Kanban;
6. add the version and upstream commit to this table.
