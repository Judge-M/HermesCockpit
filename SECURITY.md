# Security policy

Hermes Cockpit is a privileged control surface for Hermes Agent. A successful
attack may expose conversations, browser contents, provider credentials, or the
ability to run allowlisted Hermes commands. Read the
[threat model](docs/THREAT-MODEL.md) before exposing an installation to other
users or networks.

## Report a vulnerability privately

Do not open a public issue, discussion, pull request, or social-media post for a
suspected vulnerability.

1. Sign in to GitHub and open a
   [private vulnerability report](https://github.com/Judge-M/HermesCockpit/security/advisories/new).
2. Select **Report a vulnerability** and describe the issue in the private
   Security Advisory form.
3. Include, when available:
   - the affected commit, tag, and Hermes Agent version;
   - deployment details relevant to the issue, with hostnames and secrets
     removed;
   - minimal reproduction steps or a proof of concept;
   - the expected and observed security boundary;
   - likely impact and prerequisites; and
   - a suggested mitigation or disclosure constraint.
4. Attach only sanitized logs and screenshots. Replace tokens, cookies, API
   keys, session identifiers, private URLs, and personal browser data with
   placeholders.

GitHub Security Advisories keep the report and any remediation discussion
private while a fix is prepared. If GitHub does not offer the private-reporting
form for this repository, do not publish the details; open a minimal public
issue that says only that the private reporting channel is unavailable and ask
the maintainer to enable it.

Reports are handled on a best-effort basis. This project does not currently
promise a response or remediation service-level agreement. The maintainer will
coordinate disclosure timing in the private advisory and may request a CVE when
the impact warrants one.

## What to report

Security reports are especially useful for:

- authentication or authorization bypasses;
- cross-user access to CLI jobs, sessions, browser previews, or artifacts;
- arbitrary command execution or escape from the typed CLI allowlist;
- unsafe path handling, option injection, or confirmation bypasses;
- CSRF or cross-origin actions that change Hermes state;
- credential, cookie, browser-profile, prompt, or tool-output disclosure;
- exposed Chromium CDP/DevTools access;
- reverse-proxy trust failures or cache leaks;
- malicious or substituted runtime patches; and
- dependencies or build inputs that compromise a Cockpit installation.

If the issue exists entirely in upstream Hermes Agent, report it to the
upstream project's private security channel. If Cockpit makes an upstream issue
reachable or more severe, or you are unsure where the boundary lies, report it
here first.

## Supported versions

Hermes Cockpit has not published a stable release series. Security fixes target
the latest commit on `main`; older commits and unmerged branches are not
supported. Runtime integration is currently tested against Hermes Agent
`0.21.7`. This statement describes maintenance scope, not a security
certification.

## Deployment requirements

- Serve Cockpit and Hermes through one HTTPS origin. Keep the direct Hermes
  dashboard and plugin ports reachable only from the reverse proxy or a trusted
  host.
- Require Hermes authentication for every Cockpit-backed API and WebSocket
  route. Do not use network location as the only access control.
- Configure the proxy to replace, rather than append or trust, client-supplied
  forwarding headers. Trust forwarded scheme and host data only from that
  proxy.
- Do not expose Chromium CDP/DevTools ports. Browser frames and real-profile
  sessions can contain credentials and must be treated as sensitive data.
- Store provider credentials and Hermes session tokens in Hermes' server-side
  facilities. Never put them in `dist/`, committed `.env` files, issue reports,
  browser storage, or exported diagnostics.
- Run Hermes and the CLI bridge as a dedicated, unprivileged service account.
  Grant only the filesystem and host permissions required by the enabled
  operations.
- Treat the current deployment as one administrative trust domain unless
  cross-user isolation has been validated for every enabled Hermes and Cockpit
  feature. CLI job ownership does not automatically prove isolation for chat,
  browser, plugin, or upstream Hermes resources.
- Apply Cockpit's runtime patches only from a reviewed repository revision to
  the explicitly supported Hermes source revision. Review the patch diff and
  preserve a rollback path before restarting Hermes.
- Keep access logs and diagnostics private and short-lived. Redaction is a
  defense in depth, not permission to log secrets.

No independent security audit of Hermes Cockpit is claimed.
