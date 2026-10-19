# Judge-M control-plane server extension

This directory contains the Hermes dashboard plugin files that Cockpit needs for capabilities which Hermes 0.21.7 exposes only through its command-line interface.

The bridge is intentionally narrow:

- 170 reviewed command paths are registered: 43 from the 22 genuinely CLI-only families and 127 missing paths from partial/generic API families;
- request values are converted into an argument vector and never interpolated into a shell command;
- arguments and positionals are derived from Hermes' installed parser, so the browser receives typed fields, choices, defaults, and help text;
- destructive and host-lifecycle actions require an operation-specific confirmation phrase;
- interactive commands run in an isolated pseudo-terminal and accept input through a job-specific endpoint;
- output is bounded, ANSI-cleaned, and scrubbed for common credential formats;
- jobs are scoped to the stable provider/subject identity from Hermes' verified dashboard session;
- path-bearing fields use command-specific approved roots and are canonicalized before execution;
- concurrent and retained jobs are capped, and running process groups can be stopped from Cockpit.

Hermes' global dashboard cookie/token middleware protects every `/api/plugins/*` endpoint before its plugin runtime gate and route handler. `plugin_api.py` mounts `cli_bridge.py` under that normal plugin API prefix and the bridge additionally requires a stable authenticated dashboard identity for all job access; there is no browser-accessible arbitrary shell.

The same plugin provides a read-only Browser preview adapter. It uses Hermes' trusted in-process browser supervisor to capture the active page through CDP, but never returns the CDP address, browser socket, raw task identifier, or copied-profile path to the browser. Preview identifiers are opaque, process-local values and frames are returned with private, no-store caching headers.

It also provides native semantic routing. Cockpit stores profile-scoped policy under `smart_model_routing`, registers a real `Semantic Router` auxiliary-model slot, resolves only concrete provider/model pairs from the curated model catalog, and exposes prompt-redacted decision history and aggregate metrics. The policy layer enforces verified-local, capability, health, allow-list, timeout, fallback, and recursion constraints before a decision can affect Hermes.

Tool and memory routing can only narrow resources Hermes already authorized. Tool selections are pinned to the Hermes `turn_id`, so a tool-call loop sees a stable schema. Memory routing runs immediately before native provider prefetch and can select or skip an authorized source; it cannot add a provider, replace Hermes memory storage, or bypass source access control. Dedicated tool and memory decision models are optional and inherit the shared router when omitted.

Shadow routing is passive and never controls execution. Escalation is deliberately next-turn-only and blocked after side-effecting actions by default. Verification uses bounded auxiliary calls with no tool schemas. Caching is off by default, stores successful routing decisions only, and includes profile, session, configuration, router identity, candidate metadata, and a process-salted prompt fingerprint in its key.

## Endpoints

- `GET /cli-operations` — typed operation catalog
- `POST /cli-operations/{operation_id}/run` — start an allowlisted operation
- `GET /cli-jobs` and `GET /cli-jobs/{job_id}` — inspect work and bounded output
- `POST /cli-jobs/{job_id}/input` — answer an interactive prompt
- `DELETE /cli-jobs/{job_id}` — stop the process group
- `GET /browser-preview?session_id=...` — list preview-safe metadata for the caller's active Hermes browser session
- `GET /browser-preview/{preview_id}/frame` — capture the current browser page as an authenticated JPEG frame
- `GET` and `PUT /semantic-routing` — read or atomically save one profile's routing policy
- `POST /semantic-routing/decide` — resolve a concrete eligible model for a primary, subagent, or auxiliary operation
- `GET /semantic-routing/decisions` — inspect bounded routing metadata without stored prompt text or credentials
- `GET /semantic-routing/metrics` — inspect routing counts, latency percentiles, fallbacks, errors, and selection frequency
- `POST /semantic-routing/escalate` — evaluate a bounded next-turn-only escalation without replaying work
- `POST /semantic-routing/verify` — run configured tool-free verifiers (maximum three)
- `POST /semantic-routing/outcome` — attach bounded execution outcome metadata to a recent decision

The command frontend is the Manage workspace in `dist/runtime-config-settings.html`. Browser preview and routing history are inspector panels in `dist/live-control.html` and `dist/bot-mode.html`. Model eligibility, policy, decision-model setup, fallbacks, tool routing, and per-slot `Semantic Auto` modes are in `dist/models-providers.html`.

Hermes 0.21.7 already provides the request middleware used for safe tool selection. Apply `server/hermes-runtime-patches/semantic-routing-hooks.patch` to add the generic model-resolution seam used by subagent and auxiliary invocations. Apply `server/hermes-runtime-patches/semantic-routing-memory-hooks.patch` after it to add the authorized-provider memory-prefetch seam. Primary Cockpit sessions resolve their concrete route through Hermes' existing `session.create` provider/model override.

## Supported boundaries and honest limitations

- Primary Semantic Auto currently resolves when Cockpit creates a session. A session already running an active tool loop is not switched mid-turn.
- Subagent routing resolves when each child is created; auxiliary routing resolves before the native auxiliary request.
- Memory routing can choose among the installed `MemoryManager` providers. This Hermes version permits one external provider, so multiple logical stores must remain inside that provider's authorized implementation.
- Escalation and verification are exposed as authenticated lifecycle-safe operations, but this Hermes version does not expose a public ordinary-turn completion hook for the plugin. Cockpit therefore does not pretend that either can interrupt or replay an active turn.
- Complete prompts, credentials, tool outputs, and raw memory results are not persisted in routing traces. The process-local trace and cache are intentionally bounded and reset on restart.
