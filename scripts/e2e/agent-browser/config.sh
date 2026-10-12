#!/usr/bin/env bash

set -euo pipefail

agent_browser_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v agent-browser >/dev/null 2>&1; then
  printf 'agent-browser is required; install it before running this smoke harness.\n' >&2
  exit 127
fi

BASE_URL="${BASE_URL:-${APP_URL:-http://127.0.0.1:3000}}"
BASE_URL="${BASE_URL%/}"
if [[ ! "$BASE_URL" =~ ^https?://[^/]+$ ]]; then
  printf 'BASE_URL must be an HTTP(S) origin without a path, query, or fragment.\n' >&2
  exit 2
fi

RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
if [[ ! "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
  printf 'RUN_ID contains unsupported characters.\n' >&2
  exit 2
fi

if [[ -n "${ARTIFACT_DIR:-}" ]]; then
  AGENT_BROWSER_ARTIFACT_DIR="${ARTIFACT_DIR%/}"
else
  AGENT_BROWSER_ARTIFACT_DIR="$agent_browser_script_dir/artifacts/$RUN_ID"
fi
if [[ -z "$AGENT_BROWSER_ARTIFACT_DIR" || "$AGENT_BROWSER_ARTIFACT_DIR" == "/" ]]; then
  printf 'ARTIFACT_DIR must name a specific directory.\n' >&2
  exit 2
fi

umask 077
mkdir -p "$AGENT_BROWSER_ARTIFACT_DIR"

agent_browser_base_host="${BASE_URL#*://}"
agent_browser_base_host="${agent_browser_base_host%%/*}"
agent_browser_base_host="${agent_browser_base_host%%:*}"
if [[ -z "$agent_browser_base_host" ]]; then
  printf 'BASE_URL does not contain a browser host.\n' >&2
  exit 2
fi

# This lane is intentionally fresh and signed out. Do not inherit a profile,
# saved state, auto-connected browser, or auto-restored session from the caller.
requested_agent_browser_session="${E2E_AGENT_BROWSER_SESSION:-}"
unset AGENT_BROWSER_AUTO_CONNECT AGENT_BROWSER_CONFIG AGENT_BROWSER_PROFILE
unset AGENT_BROWSER_SESSION AGENT_BROWSER_SESSION_NAME AGENT_BROWSER_STATE

AGENT_BROWSER_SESSION="${requested_agent_browser_session:-gr-public-smoke-$RUN_ID}"
AGENT_BROWSER_ALLOWED_DOMAINS="${AGENT_BROWSER_ALLOWED_DOMAINS:-$agent_browser_base_host}"
AGENT_BROWSER_CONTENT_BOUNDARIES="${AGENT_BROWSER_CONTENT_BOUNDARIES:-1}"
AGENT_BROWSER_DEFAULT_TIMEOUT="${AGENT_BROWSER_DEFAULT_TIMEOUT:-15000}"
AGENT_BROWSER_IDLE_TIMEOUT_MS="${AGENT_BROWSER_IDLE_TIMEOUT_MS:-60000}"
AGENT_BROWSER_MAX_OUTPUT="${AGENT_BROWSER_MAX_OUTPUT:-50000}"
AGENT_BROWSER_COLOR_SCHEME="${AGENT_BROWSER_COLOR_SCHEME:-light}"
AGENT_BROWSER_DOWNLOAD_PATH="$AGENT_BROWSER_ARTIFACT_DIR/downloads"
AGENT_BROWSER_SCREENSHOT_DIR="$AGENT_BROWSER_ARTIFACT_DIR"

export AGENT_BROWSER_ALLOWED_DOMAINS
export AGENT_BROWSER_ARTIFACT_DIR AGENT_BROWSER_COLOR_SCHEME
export AGENT_BROWSER_CONTENT_BOUNDARIES AGENT_BROWSER_DEFAULT_TIMEOUT
export AGENT_BROWSER_DOWNLOAD_PATH AGENT_BROWSER_IDLE_TIMEOUT_MS
export AGENT_BROWSER_MAX_OUTPUT AGENT_BROWSER_SCREENSHOT_DIR
export AGENT_BROWSER_SESSION
export BASE_URL RUN_ID
