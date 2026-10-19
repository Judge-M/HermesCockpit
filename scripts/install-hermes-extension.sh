#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
HERMES_HOME=${HERMES_HOME:-"$HOME/.hermes"}
HERMES_SOURCE=${HERMES_SOURCE:-"$HERMES_HOME/hermes-agent"}
APPLY_PATCHES=1

usage() {
    cat <<'EOF'
Install the Hermes Cockpit control-plane extension.

Usage: scripts/install-hermes-extension.sh [options]

Options:
  --hermes-home PATH    Hermes data directory (default: ~/.hermes)
  --hermes-source PATH  Hermes Agent source checkout
  --skip-patches        Install the plugin without semantic-routing patches
  -h, --help            Show this help

The installer backs up an existing plugin directory and applies each runtime
patch only when it has not already been applied.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --hermes-home)
            [ "$#" -ge 2 ] || { echo "Missing value for --hermes-home" >&2; exit 2; }
            HERMES_HOME=$2
            shift 2
            ;;
        --hermes-source)
            [ "$#" -ge 2 ] || { echo "Missing value for --hermes-source" >&2; exit 2; }
            HERMES_SOURCE=$2
            shift 2
            ;;
        --skip-patches)
            APPLY_PATCHES=0
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

PLUGIN_SOURCE="$REPO_DIR/server/judge-m-control-plane"
PLUGIN_PARENT="$HERMES_HOME/plugins"
PLUGIN_TARGET="$PLUGIN_PARENT/judge-m-control-plane"
PLUGIN_STAGE="$PLUGIN_PARENT/.judge-m-control-plane.install.$$"

[ -f "$PLUGIN_SOURCE/plugin.yaml" ] || { echo "Plugin source is incomplete: $PLUGIN_SOURCE" >&2; exit 1; }

apply_patch_once() {
    patch_file=$1
    label=$2
    PATCH_APPLIED_NOW=0
    if git -C "$HERMES_SOURCE" apply --reverse --check "$patch_file" >/dev/null 2>&1; then
        echo "$label is already applied"
    elif git -C "$HERMES_SOURCE" apply --check "$patch_file" >/dev/null 2>&1; then
        git -C "$HERMES_SOURCE" apply "$patch_file"
        PATCH_APPLIED_NOW=1
        echo "Applied $label"
    else
        echo "Cannot apply $label cleanly. The installed Hermes version may be incompatible." >&2
        return 1
    fi
}

if [ "$APPLY_PATCHES" -eq 1 ]; then
    command -v git >/dev/null 2>&1 || { echo "git is required to apply the Hermes runtime patches" >&2; exit 1; }
    [ -d "$HERMES_SOURCE" ] || { echo "Hermes source not found: $HERMES_SOURCE" >&2; exit 1; }
    MODEL_PATCH="$REPO_DIR/server/hermes-runtime-patches/semantic-routing-hooks.patch"
    MEMORY_PATCH="$REPO_DIR/server/hermes-runtime-patches/semantic-routing-memory-hooks.patch"
    apply_patch_once "$MODEL_PATCH" "model-routing patch" || exit 1
    MODEL_APPLIED_NOW=$PATCH_APPLIED_NOW
    if ! apply_patch_once "$MEMORY_PATCH" "memory-routing patch"; then
        if [ "$MODEL_APPLIED_NOW" -eq 1 ]; then
            git -C "$HERMES_SOURCE" apply --reverse "$MODEL_PATCH"
            echo "Rolled back the newly applied model-routing patch" >&2
        fi
        exit 1
    fi
fi

mkdir -p "$PLUGIN_PARENT"
trap 'rm -rf "$PLUGIN_STAGE"' EXIT INT TERM
cp -R "$PLUGIN_SOURCE" "$PLUGIN_STAGE"
BACKUP=""
if [ -e "$PLUGIN_TARGET" ]; then
    BACKUP="$PLUGIN_TARGET.backup-$(date +%Y%m%d%H%M%S)-$$"
    mv "$PLUGIN_TARGET" "$BACKUP"
    echo "Backed up the previous plugin to $BACKUP"
fi
if ! mv "$PLUGIN_STAGE" "$PLUGIN_TARGET"; then
    if [ -n "$BACKUP" ] && [ -e "$BACKUP" ]; then
        mv "$BACKUP" "$PLUGIN_TARGET"
        echo "Restored the previous plugin after an installation failure" >&2
    fi
    exit 1
fi
echo "Installed the control-plane plugin at $PLUGIN_TARGET"

cat <<EOF

Hermes Cockpit extension installation is complete.
Restart the Hermes dashboard/service, then open /hermes/login and /cockpit/.
Hermes home:   $HERMES_HOME
Hermes source: $HERMES_SOURCE
EOF
