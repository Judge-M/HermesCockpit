# Contributing to Hermes Cockpit

Thank you for helping improve Hermes Cockpit. The project is an independent
graphical frontend for Hermes Agent, not a replacement agent runtime. Changes
should preserve the existing interface and expose real, supported Hermes
behavior without simulated data or invented capabilities.

## Before you start

- Search existing issues and pull requests before proposing duplicate work.
- For a security issue, stop and follow [SECURITY.md](SECURITY.md). Never put
  vulnerability details or secrets in a public issue.
- Discuss broad product-scope or architecture changes in an issue before
  implementation. Small fixes and documentation improvements can go directly
  to a pull request.
- Read `AGENTS.md` and the relevant documentation before changing code.

## Development workflow

1. Fork the repository and create a focused branch from the latest `main`.
2. Make the smallest coherent change that solves the problem.
3. Preserve `source-provenance.json` as the immutable import record. Record
   intentional changes through the repository's existing change-tracking
   mechanism; never rewrite baseline hashes to make a check pass.
4. Do not add real tokens, cookies, API keys, private hostnames, LAN addresses,
   Tailscale names, personal browser data, or copied production configuration.
5. Add or update tests for changed behavior. Do not represent sample data,
   stubs, or an unverified protocol as working integration.
6. Run the required checks, then open a pull request using the repository
   template.

## Required checks

The standard checks have no npm or Python package-install step:

```sh
node scripts/check.mjs
python scripts/validate-semantic-routing.py
python build.py --check-only
sh -n scripts/install-hermes-extension.sh
```

Changes to the CLI bridge also require a Hermes Agent `0.21.7` source checkout
with its managed Python dependencies available:

```sh
HERMES_SOURCE=/path/to/hermes-agent \
  python scripts/run-cli-bridge-validation.py
```

For user-interface changes, manually exercise the affected workflow through a
local HTTP server at desktop and mobile widths. Check the browser console,
authentication expiry, error states, reconnect behavior, and keyboard/scroll
interaction where applicable. Include screenshots when the visual result
changed.

For integration changes, state exactly which Hermes version and commit you
tested. Exercise both the successful path and relevant denied, invalid, or
unavailable states. A command appearing in a parser or an endpoint appearing in
OpenAPI is not, by itself, proof that the complete workflow works.

If a check cannot run in your environment, explain why in the pull request and
describe the closest validation performed. Do not mark an unrun check as
passing.

## Security expectations for code changes

- Keep browser APIs behind Hermes authentication and the same-origin deployment
  boundary.
- Treat every state-changing route as CSRF-sensitive. Do not weaken cookie,
  origin, or request-verification controls.
- Never introduce a browser-accessible arbitrary shell. CLI actions must remain
  explicit, typed, allowlisted argument vectors executed without a shell.
- Preserve owner checks for job listing, detail, input, cancellation, and
  output. A caller-supplied session or job identifier is not authorization.
- Validate and canonicalize paths before use; keep command-specific allowed
  roots narrow.
- Assume command output, screenshots, prompts, logs, and imported browser
  profiles can contain secrets. Minimize, bound, redact, and avoid persistence.
- Keep CDP/DevTools endpoints server-side and unreachable from the browser or
  public network.
- Do not trust client-supplied forwarding headers or use them as identity.
- Pin and review executable dependencies and runtime patches. Avoid installer
  patterns that execute unreviewed remote content.

See [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) for the system boundaries and
review checklist.

## Pull request expectations

Keep each pull request reviewable and include:

- the user-visible problem and the chosen solution;
- files and trust boundaries affected;
- exact checks run and their results;
- Hermes version/commit and deployment shape, when relevant;
- screenshots for visual changes;
- security and privacy impact, including any new stored or logged data; and
- migration, compatibility, and rollback notes when behavior or patches change.

Use clear commit messages and do not mix unrelated cleanup into a functional
change. Maintainers may ask for a smaller pull request when the security or
compatibility impact cannot be reviewed confidently.
