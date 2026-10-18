# Judge-M control-plane server extension

This directory contains the Hermes dashboard plugin files that Cockpit needs for capabilities which Hermes 0.21.7 exposes only through its command-line interface.

The bridge is intentionally narrow:

- 169 reviewed command paths are registered: 43 from the 22 genuinely CLI-only families and 126 missing paths from partial/generic API families;
- request values are converted into an argument vector and never interpolated into a shell command;
- arguments and positionals are derived from Hermes' installed parser, so the browser receives typed fields, choices, defaults, and help text;
- destructive and host-lifecycle actions require an operation-specific confirmation phrase;
- interactive commands run in an isolated pseudo-terminal and accept input through a job-specific endpoint;
- output is bounded, ANSI-cleaned, and scrubbed for common credential formats;
- jobs are scoped to the stable provider/subject identity from Hermes' verified dashboard session;
- path-bearing fields use command-specific approved roots and are canonicalized before execution;
- concurrent and retained jobs are capped, and running process groups can be stopped from Cockpit.

Hermes' global dashboard cookie/token middleware protects every `/api/plugins/*` endpoint before its plugin runtime gate and route handler. `plugin_api.py` mounts `cli_bridge.py` under that normal plugin API prefix and the bridge additionally requires a stable authenticated dashboard identity for all job access; there is no browser-accessible arbitrary shell.

## Endpoints

- `GET /cli-operations` — typed operation catalog
- `POST /cli-operations/{operation_id}/run` — start an allowlisted operation
- `GET /cli-jobs` and `GET /cli-jobs/{job_id}` — inspect work and bounded output
- `POST /cli-jobs/{job_id}/input` — answer an interactive prompt
- `DELETE /cli-jobs/{job_id}` — stop the process group

The frontend for these endpoints is `dist/cli-control.html` in the repository root.
