# Hermes Cockpit

An independent graphical frontend for Hermes Agent CLI. This repository starts with the actual source of the original five-screen demo, not a regenerated UI.

## Current status

This is a frontend prototype with sample data and browser-local interactions. It does not connect to Hermes, execute agent tasks, manage remote machines, or implement a secure credential store. Version numbers, ACP labels, connectivity, usage, security claims, and provider indicators shown in the demo are illustrative, not verified capabilities.

Do not enter real credentials or sensitive information. The original demo persists form fields in browser localStorage and can export them. Two credential-like password defaults were cleared before the public import. Credential handling must be replaced before live integration.

## Run locally

With Node.js 18 or newer installed:

```sh
node scripts/serve.mjs
```

Open http://127.0.0.1:4174. The server binds only to loopback. The shared header and sidebar use the embedded `shell-data.js` fallback when opened directly from `file://`, and use `shell.json` when served over HTTP.

```sh
node scripts/check.mjs
```

The check validates immutable imported-file hashes, recorded intentional source changes, the five screens, local asset references, inline JavaScript syntax, and blank password defaults. It is not a Hermes integration test.

## Live demo

The static prototype is published from `main` through GitHub Pages:

[Open the Hermes Cockpit demo](https://judge-m.github.io/HermesCockpit/)

The header uses the checked-in [Hermes Aviator Girl asset](dist/assets/hermes-aviator-girl.jpg), so the demo does not depend on the original externally hosted image.

## Original frontend

- `dist/live-control.html`
- `dist/mesh-topology.html`
- `dist/tool-registry.html`
- `dist/acp-telemetry.html`
- `dist/runtime-config-settings.html`
- Shared shell, CSS, JavaScript, and index redirect in `dist/`.

The files were recovered from the owned [original demo](https://hermes-copilot-workbench.artfulperch7.chatgpt.site) at source commit `e52f5d2ac25718b67c5f135c4bfbd50c52fe5206`. `source-provenance.json` records original and imported SHA-256 hashes. All copied files remain byte-identical except the two password default values in the settings screen; the later local-logo change is recorded separately in `source-changes.json`. No layout, CSS, or interaction logic was redesigned.

The prototype vendors its Tailwind browser runtime, Inter and JetBrains Mono fonts, Material Symbols font, and Hermes Aviator Girl image under `dist/vendor/` and `dist/assets/`, so the demo has no network dependency at runtime. It is still served through the included loopback server because the shared shell loads `shell.json`; opening HTML with `file://` is not sufficient. The copied `build.py` is a historical generator that requires the original uploaded Stitch exports at an environment-specific path; it is not the local build command. Serve the already-generated `dist/` files instead.

The existing Site's `.openai/hosting.json` is deliberately excluded so this repository does not accidentally target the original hosted Site. No Site deployment was changed by this import.

## Product scope

Preserve the existing design and edit only where required to expose a supported Hermes CLI version, improve ergonomics, manage multiple Hermes instances on different machines, and inspect genuine parent/subagent activity. Hermes remains the runtime. Custom semantic routing, independent memory, automatic machine scheduling, and multi-runtime orchestration belong to the separate broader Cockpit project.

Next milestone: connect one local Hermes installation, complete a real task through the copied interface, and resume the same session after reopening. Validate upstream interfaces before implementing or claiming CLI parity.

## Project record

Keep the [Hermes Cockpit Page](https://chatgpt.com/space/page_91803be0d0c48191967667305453301f) updated with changes, decisions, commits, checks, blockers, and next steps after each work session. Never record secrets.

This project is not affiliated with or endorsed by Nous Research or the Hermes team. [Hermes Agent](https://github.com/NousResearch/hermes-agent) is the upstream integration target.
