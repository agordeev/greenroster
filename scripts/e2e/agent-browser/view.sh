#!/usr/bin/env bash

# Open app pages as one of the local demo accounts and save what they show.
#
#   scripts/e2e/agent-browser/view.sh <who> <path> [<path> ...]
#
# <who> is organizer, coordinator, member, newmember, neworganizer or guest
# (signed out). Set VIEWPORT=390x844 for a phone-sized window and
# COLOR_SCHEME=dark for the dark theme.
#
# Needs `pnpm db:demo` to have run. Each page gets a full-page screenshot and a
# text snapshot under artifacts/view-<who>/.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

who="${1:-}"
case "$who" in
  organizer | coordinator | member | newmember | neworganizer | guest) ;;
  *)
    printf 'Usage: %s <organizer|coordinator|member|newmember|neworganizer|guest> <path> [<path> ...]\n' "$0" >&2
    exit 2
    ;;
esac
shift
if [[ $# -eq 0 ]]; then
  printf 'Give at least one path, for example /portal/rounds\n' >&2
  exit 2
fi

demo_password="greenroster-demo"
viewport="${VIEWPORT:-1280x900}"
if [[ ! "$viewport" =~ ^[0-9]+x[0-9]+$ ]]; then
  printf 'VIEWPORT must look like 1280x900.\n' >&2
  exit 2
fi

RUN_ID="view-$who"
E2E_AGENT_BROWSER_SESSION="gr-view-$who-$$"
AGENT_BROWSER_COLOR_SCHEME="${COLOR_SCHEME:-light}"
export RUN_ID E2E_AGENT_BROWSER_SESSION AGENT_BROWSER_COLOR_SCHEME

# shellcheck source=config.sh
source "$script_dir/config.sh"

browser() {
  agent-browser --session "$AGENT_BROWSER_SESSION" "$@"
}

cleanup() {
  browser close >/dev/null 2>&1 || true
}

trap cleanup EXIT

browser open "$BASE_URL/sign-in" >/dev/null
browser set viewport "${viewport%x*}" "${viewport#*x}" >/dev/null

if [[ "$who" != "guest" ]]; then
  browser wait --load networkidle >/dev/null
  browser fill 'input[name="email"]' "$who@example.test" >/dev/null
  browser fill 'input[name="password"]' "$demo_password" >/dev/null
  browser focus 'button[type="submit"]' >/dev/null
  browser press Enter >/dev/null
  if ! browser wait --fn '!location.pathname.startsWith("/sign-in")' >/dev/null; then
    printf 'Could not sign in as %s@example.test. Has `pnpm db:demo` run?\n' "$who" >&2
    exit 1
  fi
  browser wait --load networkidle >/dev/null
fi

for path in "$@"; do
  if [[ "$path" != /* ]]; then
    printf 'Paths start with a slash: %s\n' "$path" >&2
    exit 2
  fi
  slug="$(printf '%s' "${path#/}" | tr -c 'A-Za-z0-9._-' '-')"
  slug="${slug:-home}-$viewport-$AGENT_BROWSER_COLOR_SCHEME"

  browser open "$BASE_URL$path" >/dev/null
  browser wait --load networkidle >/dev/null
  browser snapshot >"$AGENT_BROWSER_ARTIFACT_DIR/$slug.snapshot.txt"
  browser screenshot --full "$AGENT_BROWSER_ARTIFACT_DIR/$slug.png" >/dev/null

  printf '%s -> %s\n  %s\n' "$path" "$(browser get url)" "$AGENT_BROWSER_ARTIFACT_DIR/$slug.png"
done

browser errors >"$AGENT_BROWSER_ARTIFACT_DIR/page-errors.txt"
if [[ -s "$AGENT_BROWSER_ARTIFACT_DIR/page-errors.txt" ]]; then
  printf 'Page errors: %s\n' "$AGENT_BROWSER_ARTIFACT_DIR/page-errors.txt"
fi
