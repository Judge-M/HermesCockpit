#!/usr/bin/env sh
set -eu

node scripts/check.mjs
python scripts/validate-semantic-routing.py
python build.py --check-only
version=$(tr -d '\r\n' < VERSION)
python build.py --release --output build/release-check-a
python build.py --release --output build/release-check-b
cmp "build/release-check-a/hermes-cockpit-${version}.zip" "build/release-check-b/hermes-cockpit-${version}.zip"
cmp "build/release-check-a/hermes-cockpit-${version}.tar.gz" "build/release-check-b/hermes-cockpit-${version}.tar.gz"
(cd build/release-check-a && sha256sum --check SHA256SUMS.txt)
for script in \
  scripts/bootstrap.sh \
  scripts/hermes-cockpit-doctor.sh \
  scripts/install-hermes-extension.sh \
  scripts/uninstall-hermes-extension.sh
do
  sh -n "$script"
done

rm -rf build/release-check-a build/release-check-b

if grep -R -n -E '192\.168\.[0-9]+\.[0-9]+|tail[0-9a-f]+\.ts\.net' \
  --exclude-dir=.git \
  --exclude-dir=build \
  --exclude-dir=node_modules \
  --exclude='CAPABILITY-INVENTORY.json' \
  --exclude='CAPABILITY-INVENTORY.md' .
then
  echo 'Private installation address found in the public repository.' >&2
  exit 1
fi
