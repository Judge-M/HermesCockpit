# Upgrade and rollback

## Upgrade

From the repository checkout:

```sh
git pull --ff-only
./scripts/install-hermes-extension.sh
docker compose up -d --pull always
```

Restart Hermes after the extension installer completes. The installer leaves the previous plugin beside the new one as a timestamped backup.

## Before a Hermes upgrade

Hermes Cockpit's runtime patches are reviewed against Hermes `0.21.7`. Before upgrading Hermes:

1. stop Hermes;
2. back up `~/.hermes` and the Hermes source checkout;
3. upgrade Hermes;
4. rerun the extension installer;
5. do not force a patch that fails its clean-apply check;
6. run the repository checks and exercise Chat, Models, Manage, and Browser preview.

## Web rollback

Check out the previous Cockpit tag or commit and recreate the container:

```sh
git checkout <previous-tag-or-commit>
docker compose up -d --force-recreate
```

## Plugin rollback

Stop Hermes, move the current `~/.hermes/plugins/judge-m-control-plane` aside, restore the timestamped backup produced by the installer, and restart Hermes. Runtime patches must match the plugin version; restore the Hermes source backup when rolling back across a routing-patch change.
