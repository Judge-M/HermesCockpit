# Release checklist

Use this checklist for every public Hermes Cockpit release.

## Code and compatibility

- [ ] `VERSION`, `plugin.yaml`, and `dashboard/manifest.json` agree.
- [ ] The compatibility table names the exact supported Hermes tag and commit.
- [ ] Both runtime patches apply to a clean checkout of that commit.
- [ ] The API/CLI capability inventory matches the supported runtime.
- [ ] Portable, semantic-routing, CLI bridge, Compose, nginx, and browser checks pass.
- [ ] A clean Linux host or VM completes bootstrap and doctor successfully.

## Product verification

- [ ] Login and expired-session recovery work through the public origin.
- [ ] New and resumed Chat sessions display complete transcripts.
- [ ] Bot Mode uses canonical Hermes Bot Chat sessions.
- [ ] Desktop and mobile navigation have no unreachable workspace.
- [ ] Provider onboarding, model curation, assignments, and Semantic Auto work.
- [ ] Tools, Kanban, Manage, System, and Observability show live or explicit unavailable states.
- [ ] Browser preview never exposes CDP addresses or copied-profile paths.
- [ ] Long-running CLI jobs stream, accept input, stop, and redact secrets.

## Security and operations

- [ ] The threat model was reviewed for any changed trust boundary.
- [ ] No private addresses, credentials, session material, or personal paths are tracked.
- [ ] HTTPS, authentication, unprivileged service ownership, backup, and rollback were tested.
- [ ] Private vulnerability reporting is enabled in GitHub Security settings.
- [ ] The deployed `/healthz` response is exactly `ok`.

## Publication

- [ ] `CHANGELOG.md` contains the version and release date.
- [ ] `python build.py --release --output build/release` succeeds twice with identical checksums.
- [ ] The release tag points to the reviewed `main` commit.
- [ ] GitHub publishes both archives and `SHA256SUMS.txt`.
- [ ] The Pages preview and README links work.
