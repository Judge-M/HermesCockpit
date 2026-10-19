#!/usr/bin/env sh
set -eu

EXPECTED_HERMES_VERSION=0.21.7
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
HERMES_HOME=${HERMES_HOME:-"$HOME/.hermes"}
HERMES_SOURCE=${HERMES_SOURCE:-"$HERMES_HOME/hermes-agent"}
UPSTREAM_URL=""
FAILURES=0
WARNINGS=0

usage() {
    cat <<'EOF'
Check a Hermes Cockpit extension installation.

Usage: scripts/hermes-cockpit-doctor.sh [options]

Options:
  --hermes-home PATH    Hermes data directory (default: ~/.hermes)
  --hermes-source PATH  Official Hermes Agent source checkout
  --upstream URL        Also request URL/healthz (or URL itself if it ends in /healthz)
  -h, --help            Show this help

The doctor is read-only. The HTTP check is optional and requires curl or wget.
EOF
}

pass() { echo "PASS: $*"; }
warn() { echo "WARN: $*" >&2; WARNINGS=$((WARNINGS + 1)); }
fail() { echo "FAIL: $*" >&2; FAILURES=$((FAILURES + 1)); }

detect_hermes_version() {
    tags=$(git -C "$HERMES_SOURCE" tag --points-at HEAD 2>/dev/null || :)
    for tag in $tags; do
        case "$tag" in
            "v$EXPECTED_HERMES_VERSION"|"$EXPECTED_HERMES_VERSION") printf '%s\n' "$EXPECTED_HERMES_VERSION"; return 0 ;;
        esac
    done
    for version_file in pyproject.toml hermes_cli/__init__.py hermes_cli/version.py; do
        [ -f "$HERMES_SOURCE/$version_file" ] || continue
        version=$(sed -n "s/^[[:space:]]*\(__version__\|version\)[[:space:]]*=[[:space:]]*['\"]\([^'\"]*\)['\"].*/\2/p" "$HERMES_SOURCE/$version_file" | sed -n '1p')
        if [ -n "$version" ]; then printf '%s\n' "$version"; return 0; fi
    done
    return 1
}

patch_state() {
    patch_file=$1
    if git -C "$HERMES_SOURCE" apply --reverse --check "$patch_file" >/dev/null 2>&1; then printf '%s\n' applied
    elif git -C "$HERMES_SOURCE" apply --check "$patch_file" >/dev/null 2>&1; then printf '%s\n' unapplied
    else printf '%s\n' drifted
    fi
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --hermes-home) [ "$#" -ge 2 ] || { echo "Missing value for --hermes-home" >&2; exit 2; }; HERMES_HOME=$2; shift 2 ;;
        --hermes-source) [ "$#" -ge 2 ] || { echo "Missing value for --hermes-source" >&2; exit 2; }; HERMES_SOURCE=$2; shift 2 ;;
        --upstream) [ "$#" -ge 2 ] || { echo "Missing value for --upstream" >&2; exit 2; }; UPSTREAM_URL=$2; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

PLUGIN_SOURCE="$REPO_DIR/server/judge-m-control-plane"
PLUGIN_TARGET="$HERMES_HOME/plugins/judge-m-control-plane"
MODEL_PATCH="$REPO_DIR/server/hermes-runtime-patches/semantic-routing-hooks.patch"
MEMORY_PATCH="$REPO_DIR/server/hermes-runtime-patches/semantic-routing-memory-hooks.patch"

echo "Hermes Cockpit doctor"
echo "Hermes home:   $HERMES_HOME"
echo "Hermes source: $HERMES_SOURCE"

if [ "$(uname -s 2>/dev/null || :)" = Linux ]; then pass "Linux host detected"; else fail "runtime host is not Linux"; fi
if command -v git >/dev/null 2>&1; then pass "git is available"; else fail "git is not available"; fi

if command -v git >/dev/null 2>&1 && [ "$(git -C "$HERMES_SOURCE" rev-parse --is-inside-work-tree 2>/dev/null || :)" = true ]; then
    remote=$(git -C "$HERMES_SOURCE" remote get-url origin 2>/dev/null || :)
    remote_lower=$(printf '%s' "$remote" | tr '[:upper:]' '[:lower:]')
    case "$remote_lower" in
        *github.com/nousresearch/hermes-agent|*github.com/nousresearch/hermes-agent.git) pass "official NousResearch/hermes-agent source detected" ;;
        *) fail "source origin is not official: ${remote:-<missing>}" ;;
    esac
    version=$(detect_hermes_version || :)
    if [ "$version" = "$EXPECTED_HERMES_VERSION" ]; then pass "Hermes version is $EXPECTED_HERMES_VERSION";
    else fail "Hermes version is ${version:-unknown}; expected $EXPECTED_HERMES_VERSION"; fi
    memory_state=$(patch_state "$MEMORY_PATCH")
    if [ "$memory_state" = applied ]; then model_state=applied-below-memory; else model_state=$(patch_state "$MODEL_PATCH"); fi
    case "$model_state" in applied|applied-below-memory) pass "model-routing patch is applied" ;; *) fail "model-routing patch state is $model_state" ;; esac
    if [ "$memory_state" = applied ]; then pass "memory-routing patch is applied"; else fail "memory-routing patch state is $memory_state"; fi
else
    fail "Hermes source is not a git checkout: $HERMES_SOURCE"
fi

if [ -d "$PLUGIN_TARGET" ]; then
    pass "plugin directory exists"
    for plugin_file in plugin.yaml __init__.py semantic_routing.py dashboard/__init__.py dashboard/cli_bridge.py dashboard/manifest.json dashboard/plugin_api.py; do
        if [ -f "$PLUGIN_TARGET/$plugin_file" ]; then pass "plugin file exists: $plugin_file";
        else fail "plugin file is missing: $plugin_file"; fi
    done
    if [ -f "$PLUGIN_TARGET/plugin.yaml" ] && [ -f "$PLUGIN_SOURCE/plugin.yaml" ]; then
        installed_version=$(sed -n 's/^[[:space:]]*version:[[:space:]]*//p' "$PLUGIN_TARGET/plugin.yaml" | sed -n '1p')
        packaged_version=$(sed -n 's/^[[:space:]]*version:[[:space:]]*//p' "$PLUGIN_SOURCE/plugin.yaml" | sed -n '1p')
        if [ -n "$installed_version" ] && [ "$installed_version" = "$packaged_version" ]; then pass "plugin version matches package ($installed_version)";
        else fail "plugin version ${installed_version:-unknown} does not match package ${packaged_version:-unknown}"; fi
    fi
else
    fail "plugin directory is missing: $PLUGIN_TARGET"
fi

if [ -n "$UPSTREAM_URL" ]; then
    case "$UPSTREAM_URL" in */healthz) health_url=$UPSTREAM_URL ;; *) health_url=${UPSTREAM_URL%/}/healthz ;; esac
    if command -v curl >/dev/null 2>&1; then
        if curl --fail --silent --show-error --location --max-time 10 --output /dev/null "$health_url"; then pass "HTTP upstream is healthy: $health_url";
        else fail "HTTP upstream check failed: $health_url"; fi
    elif command -v wget >/dev/null 2>&1; then
        if wget -q -T 10 -O /dev/null "$health_url"; then pass "HTTP upstream is healthy: $health_url";
        else fail "HTTP upstream check failed: $health_url"; fi
    else fail "curl or wget is required for --upstream"; fi
else
    warn "HTTP upstream check skipped (pass --upstream URL to enable it)"
fi

echo "Summary: $FAILURES failure(s), $WARNINGS warning(s)"
[ "$FAILURES" -eq 0 ]
