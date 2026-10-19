## What changed

<!-- Describe the user-visible problem and the solution. -->

## Scope and trust boundaries

<!-- List affected areas: UI, authentication, CLI bridge, browser preview, proxy, patches, secrets, storage, or none. -->

## Validation

<!-- List exact commands and manual checks. Say "not run" with a reason when applicable. -->

- [ ] `node scripts/check.mjs`
- [ ] `python scripts/validate-semantic-routing.py`
- [ ] `python build.py --check-only`
- [ ] `sh -n scripts/install-hermes-extension.sh`
- [ ] CLI bridge validation, if applicable
- [ ] Manual desktop/mobile or integration checks, if applicable

Hermes version/commit tested: <!-- or N/A -->

## Security and privacy

<!-- Describe new permissions, inputs, outputs, stored/logged data, and mitigations. Use "no change" only after checking. -->

- [ ] No secrets, private addresses, personal browser data, or production configuration are included.
- [ ] New or changed state mutations preserve authentication and CSRF/origin protections.
- [ ] User-owned jobs/resources have negative cross-user authorization coverage.
- [ ] Documentation does not claim unperformed testing, protocol support, or a security audit.

## Compatibility and rollback

<!-- Describe migrations, upstream-version assumptions, patch impact, and rollback. Use N/A when none. -->

## Visual evidence

<!-- Add before/after screenshots for visible changes, with sensitive data removed. Otherwise N/A. -->
