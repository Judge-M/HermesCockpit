#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
HERMES_HOME=${HERMES_HOME:-"$HOME/.hermes"}
HERMES_SOURCE=${HERMES_SOURCE:-"$HERMES_HOME/hermes-agent"}
START_WEB=1
DRY_RUN=0

usage() {
    cat <<'EOF'
Install Hermes Cockpit, optionally start its Compose web tier, and run doctor.

Usage: scripts/bootstrap.sh [options]

Options:
  --hermes-home PATH    Hermes data directory (default: ~/.hermes)
  --hermes-source PATH  Official Hermes Agent v0.21.7 source checkout
  --no-start            Do not start the Compose web tier
  --dry-run             Run installer preflight without making changes
  -h, --help            Show this help

Path options are passed directly to installer and doctor. If Docker Compose is
not available, web startup is skipped with a warning and doctor still runs.
EOF
}

die() { echo "ERROR: $*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
    case "$1" in
        --hermes-home) [ "$#" -ge 2 ] || die "Missing value for --hermes-home"; HERMES_HOME=$2; shift 2 ;;
        --hermes-source) [ "$#" -ge 2 ] || die "Missing value for --hermes-source"; HERMES_SOURCE=$2; shift 2 ;;
        --no-start) START_WEB=0; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

if [ "$DRY_RUN" -eq 1 ]; then
    "$SCRIPT_DIR/install-hermes-extension.sh" --hermes-home "$HERMES_HOME" --hermes-source "$HERMES_SOURCE" --dry-run
    echo "DRY RUN: bootstrap stops after installer preflight"
    exit 0
fi

"$SCRIPT_DIR/install-hermes-extension.sh" --hermes-home "$HERMES_HOME" --hermes-source "$HERMES_SOURCE"

START_STATUS=0
WEB_STARTED=0
if [ "$START_WEB" -eq 1 ]; then
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        if ! docker compose -f "$REPO_DIR/compose.yaml" up -d; then
            echo "ERROR: Docker Compose web tier failed to start" >&2
            START_STATUS=1
        else WEB_STARTED=1; fi
    elif command -v docker-compose >/dev/null 2>&1; then
        if ! docker-compose -f "$REPO_DIR/compose.yaml" up -d; then
            echo "ERROR: Docker Compose web tier failed to start" >&2
            START_STATUS=1
        else WEB_STARTED=1; fi
    else
        echo "ERROR: Docker Compose is unavailable; use --no-start only when another proxy serves Cockpit" >&2
        START_STATUS=1
    fi
else
    echo "Web tier startup skipped by --no-start"
fi

DOCTOR_STATUS=0
if [ "$WEB_STARTED" -eq 1 ]; then
    DOCTOR_UPSTREAM="http://127.0.0.1:${COCKPIT_PORT:-8088}"
else
    DOCTOR_UPSTREAM=""
fi
if [ -n "$DOCTOR_UPSTREAM" ]; then
    set -- --hermes-home "$HERMES_HOME" --hermes-source "$HERMES_SOURCE" --upstream "$DOCTOR_UPSTREAM"
else
    set -- --hermes-home "$HERMES_HOME" --hermes-source "$HERMES_SOURCE"
fi
if ! "$SCRIPT_DIR/hermes-cockpit-doctor.sh" "$@"; then
    DOCTOR_STATUS=1
fi
[ "$START_STATUS" -eq 0 ] && [ "$DOCTOR_STATUS" -eq 0 ]
