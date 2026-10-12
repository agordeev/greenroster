#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Keep the test account disposable and unique for every run.
RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
E2E_AGENT_BROWSER_SESSION="${E2E_AGENT_BROWSER_SESSION:-gr-organizer-smoke-$RUN_ID}"
E2E_EMAIL="${E2E_EMAIL:-e2e-organizer-$RUN_ID@example.com}"
: "${E2E_PASSWORD:?Set E2E_PASSWORD to a local test password of at least 8 characters.}"
export RUN_ID E2E_AGENT_BROWSER_SESSION E2E_EMAIL E2E_PASSWORD

# shellcheck source=config.sh
source "$script_dir/config.sh"

browser() {
  agent-browser --session "$AGENT_BROWSER_SESSION" "$@"
}

cleanup() {
  browser close >/dev/null 2>&1 || true
}

trap cleanup EXIT

fail() {
  printf 'FAIL: %s\nArtifacts: %s\n' "$1" "$AGENT_BROWSER_ARTIFACT_DIR" >&2
  exit 1
}

capture_checkpoint() {
  local slug="$1"

  browser snapshot -i --json >"$AGENT_BROWSER_ARTIFACT_DIR/$slug.snapshot.json"
  browser screenshot --full "$AGENT_BROWSER_ARTIFACT_DIR/$slug.png" >/dev/null
}

assert_url() {
  local expected="$1"
  local actual

  actual="$(browser get url)"
  [[ "$actual" == "$expected" ]] || fail "expected URL $expected, got $actual"
}

assert_snapshot_text() {
  local slug="$1"
  local expected="$2"

  rg -q --fixed-strings "$expected" "$AGENT_BROWSER_ARTIFACT_DIR/$slug.snapshot.json" ||
    fail "expected $slug to contain: $expected"
}

open_authenticated_route() {
  local slug="$1"
  local path="$2"

  browser open "$BASE_URL$path" >/dev/null
  browser wait --load networkidle >/dev/null
  capture_checkpoint "$slug"
  assert_url "$BASE_URL$path"
}

printf 'run_id=%s\nemail=%s\nbase_host=%s\n' "$RUN_ID" "$E2E_EMAIL" "${BASE_URL#*://}" >"$AGENT_BROWSER_ARTIFACT_DIR/manifest.txt"

# Real organizer signup: no direct database writes or pre-seeded browser state.
browser open "$BASE_URL/sign-up" >/dev/null
browser wait --load networkidle >/dev/null
browser fill 'input[name="email"]' "$E2E_EMAIL" >/dev/null
browser fill 'input[name="password"]' "$E2E_PASSWORD" >/dev/null
browser fill 'input[name="confirmPassword"]' "$E2E_PASSWORD" >/dev/null
browser check 'input[name="acceptedTerms"]' >/dev/null
browser check 'input[name="acceptedPrivacy"]' >/dev/null
browser focus 'button[type="submit"]' >/dev/null
browser press Enter >/dev/null
browser wait --text "Continue to group setup" >/dev/null
capture_checkpoint "signup-complete"
assert_snapshot_text "signup-complete" "Continue to group setup"

browser click 'a[href="/sign-up/finish"]' >/dev/null
browser wait --load networkidle >/dev/null
assert_url "$BASE_URL/sign-up/finish"
if ! browser eval 'document.querySelector("input[name=groupTimeZone]")?.value === Intl.DateTimeFormat().resolvedOptions().timeZone' | rg -q '^true$'; then
  fail "expected group time zone to default to the browser time zone"
fi
if ! browser eval 'document.querySelectorAll("input[name=acceptedTerms], input[name=acceptedPrivacy]").length === 0' | rg -q '^true$'; then
  fail "group setup repeated legal acceptance"
fi
capture_checkpoint "group-setup"
browser fill 'input[name="firstName"]' "E2E" >/dev/null
browser fill 'input[name="lastName"]' "Organizer" >/dev/null
browser fill 'input[name="groupName"]' "E2E Group $RUN_ID" >/dev/null
browser focus 'button[type="submit"]' >/dev/null
browser press Enter >/dev/null
browser wait --url "$BASE_URL/portal" >/dev/null
capture_checkpoint "portal-bootstrap"
assert_url "$BASE_URL/portal"
assert_snapshot_text "portal-bootstrap" "Members"
assert_snapshot_text "portal-bootstrap" "Settings"
assert_snapshot_text "portal-bootstrap" "Rounds"

open_authenticated_route "portal" "/portal"
open_authenticated_route "portal-members" "/portal/members"
assert_snapshot_text "portal-members" "Add member"

open_authenticated_route "portal-members-import" "/portal/members/import"
open_authenticated_route "portal-invitations" "/portal/invitations"
open_authenticated_route "portal-rounds" "/portal/rounds"
open_authenticated_route "portal-group" "/portal/group"
open_authenticated_route "portal-standings" "/portal/standings"
open_authenticated_route "portal-reports" "/portal/reports"
open_authenticated_route "portal-billing" "/portal/billing"
open_authenticated_route "account" "/account"
open_authenticated_route "account-privacy" "/account/privacy"

browser errors >"$AGENT_BROWSER_ARTIFACT_DIR/page-errors.txt"
browser console >"$AGENT_BROWSER_ARTIFACT_DIR/console.log"
browser network requests --type document,xhr,fetch >"$AGENT_BROWSER_ARTIFACT_DIR/network.log"
[[ ! -s "$AGENT_BROWSER_ARTIFACT_DIR/page-errors.txt" ]] ||
  fail "the browser reported page errors"

printf 'PASS: organizer signup, group bootstrap, and %s authenticated routes\nArtifacts: %s\n' \
  "11" "$AGENT_BROWSER_ARTIFACT_DIR"
