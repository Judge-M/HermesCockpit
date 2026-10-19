# Security policy

Hermes Cockpit is a privileged control surface for Hermes Agent. Deploy it only behind HTTPS and Hermes authentication, and keep Cockpit and Hermes on the same trusted browser origin.

## Reporting a vulnerability

Please do not publish credential exposure, authentication bypass, arbitrary command execution, cross-user job access, or browser-profile leakage in a public issue. Contact the repository owner privately through the security-reporting channel configured on GitHub. Include the affected commit, reproduction steps, expected impact, and whether the issue is already being exploited.

## Supported version

Security fixes target the latest commit on `main`. Runtime integration is currently verified against Hermes Agent `0.21.7`.

## Deployment requirements

- Never expose Chromium CDP/DevTools ports.
- Never put provider credentials or Hermes session tokens into frontend files or `.env` committed to Git.
- Terminate TLS before exposing Cockpit outside a trusted host.
- Review optional service links before making them visible to other users.
- Treat copied personal-browser profiles as credentials.
- Keep the allowlisted CLI bridge running as the Hermes service user, not as an unrestricted remote shell.
