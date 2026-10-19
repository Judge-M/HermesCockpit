# Development guide

Hermes Cockpit intentionally has a small runtime footprint: nginx serves the
checked-in browser application and proxies authenticated Hermes traffic. There
is no client-side package installation in production.

## Repository conventions

- `dist/` is the canonical browser source and deployable output.
- `server/judge-m-control-plane/` is the Hermes plugin.
- `server/hermes-runtime-patches/` contains version-specific upstream seams.
- `source-provenance.json` is immutable import history.
- Changes to an imported file must be recorded in `source-changes.json`; never
  rewrite the baseline hash to conceal a modification.
- Do not add sample agents, tasks, topology, metrics, or other simulated state.

## Local frontend work

```sh
node scripts/serve.mjs
```

Open <http://127.0.0.1:4174>. Static navigation works without Hermes. Live
operations require the same-origin `/hermes` reverse proxy described in the
installation guide.

## Required checks

```sh
node scripts/check.mjs
python scripts/validate-semantic-routing.py
python build.py --check-only
sh -n scripts/*.sh
```

When Node dependencies are installed, run the browser smoke suite using the
commands in `package.json`. Validate the CLI bridge inside Hermes' managed
Python environment:

```sh
python scripts/run-cli-bridge-validation.py
```

## Release artifacts

```sh
python build.py --release --output build/release
```

The builder verifies that `VERSION`, `plugin.yaml`, and the dashboard manifest
agree, then emits deterministic ZIP and tar.gz archives plus `SHA256SUMS.txt`.
The tag-triggered release workflow publishes those exact files.
