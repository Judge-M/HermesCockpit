# Hermes Cockpit working agreement

- Read the linked Hermes Cockpit Page and preserve its current product scope.
- Reuse the original `dist/` implementation. Do not regenerate the frontend, redesign it, replace it with a scaffold, or import the broader Cockpit preview.
- Preserve layout, typography, spacing, colors, density, navigation, and shared shell. Make targeted edits only.
- Keep `source-provenance.json` as the immutable import record; do not rewrite baseline hashes to make changed source pass checks. Clearly separate later intentional source changes from baseline-integrity checks.
- No live Hermes backend exists yet. Never present demo data or mock controls as real execution or verified protocol support.
- Do not enter or persist real secrets in the current frontend. Replace browser-local credential handling before connecting real providers.
- After each work session, record substantive changes, decisions, commit/PR links, checks and results, blockers, and next steps on the Hermes Cockpit Page: https://chatgpt.com/space/page_91803be0d0c48191967667305453301f . If Page access fails, report it explicitly.
- This recordkeeping requirement is not permission for unrelated changes or deployment.
- Completed code changes should be committed and pushed to a GitHub feature branch with a pull request by default. Exclude secrets, temporary files, and unrelated edits; report publication blockers. Merging still requires explicit approval for the pull request.
