#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
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

open_page() {
  local slug="$1"
  local path="$2"

  browser open "$BASE_URL$path" >/dev/null
  browser wait --load networkidle >/dev/null
  capture_checkpoint "$slug"
}

assert_url() {
  local expected="$1"
  local actual

  actual="$(browser get url)"
  [[ "$actual" == "$expected" ]] || fail "expected URL $expected"
}

assert_heading() {
  local expected="$1"
  local heading

  heading="$(browser get text 'h1')"
  [[ "$heading" == *"$expected"* ]] || fail "expected an h1 containing $expected"
}

assert_return_path() {
  local expected="$1"
  local actual

  actual="$(browser get value 'input[name="returnPath"]')"
  [[ "$actual" == "$expected" ]] || fail "expected the sign-in form to keep the safe return path"
}

smoke_public_route() {
  local slug="$1"
  local path="$2"
  local expected_heading="$3"

  open_page "$slug" "$path"
  assert_url "$BASE_URL$path"
  assert_heading "$expected_heading"
  public_route_count=$((public_route_count + 1))
}

smoke_redirect_route() {
  local slug="$1"
  local path="$2"
  local expected_next="$3"

  open_page "$slug" "$path"
  assert_url "$BASE_URL/sign-in?next=$expected_next"
  assert_heading "Sign in as yourself"
  protected_route_count=$((protected_route_count + 1))
}

public_route_count=0
protected_route_count=0

printf 'run_id=%s\nbase_host=%s\n' "$RUN_ID" "${BASE_URL#*://}" >"$AGENT_BROWSER_ARTIFACT_DIR/manifest.txt"

# Start with a fresh browser context and clear any caller-owned browser data.
# The unique session is not persisted as an auth fixture.
browser open "$BASE_URL/sign-in" >/dev/null
browser cookies clear >/dev/null
browser storage local clear >/dev/null
browser storage session clear >/dev/null

open_page "root-redirect" "/"
assert_url "$BASE_URL/sign-in"
assert_heading "Sign in as yourself"

smoke_public_route "home" "/home" "Your group, rounds, and roster"
smoke_public_route "sign-in" "/sign-in" "Sign in as yourself"
smoke_public_route "sign-up" "/sign-up" "Start your group"
smoke_public_route "recover-password" "/recover-password" "Reset your password"
smoke_public_route "reset-password" "/reset-password" "Choose a new password"
smoke_public_route "privacy" "/privacy" "Privacy Policy"
smoke_public_route "terms" "/terms" "Terms of Use"
smoke_public_route "help" "/help" "Help with your group"
smoke_public_route "support" "/support" "Contact GreenRoster support"
smoke_public_route "feedback" "/feedback" "Tell us what would work better"
smoke_public_route "invitation-accept" "/invitations/accept" "Invitation unavailable"
smoke_public_route "invitation-register" "/invitations/accept/register" "Invitation link unavailable"
smoke_public_route "scoreboard-unavailable" "/scoreboard/not-a-real-smoke-token" "You can’t view this round right now."

# Missing callback codes exercise the public, safe failure destinations without
# using an invitation, recovery, or authenticated account fixture.
open_page "auth-recovery-callback" "/auth/callback"
assert_url "$BASE_URL/recover-password?status=expired"
assert_heading "Reset your password"
public_route_count=$((public_route_count + 1))

open_page "auth-invitation-callback" "/auth/invitation-callback"
assert_url "$BASE_URL/invitations/accept?status=expired"
assert_heading "Invitation unavailable"
public_route_count=$((public_route_count + 1))

open_page "auth-organizer-callback" "/auth/organizer-callback"
assert_url "$BASE_URL/sign-in?next=%2Fportal"
assert_heading "Sign in as yourself"
public_route_count=$((public_route_count + 1))

open_page "auth-member-callback" "/auth/member-callback"
assert_url "$BASE_URL/sign-in?status=member-link-expired"
assert_heading "Sign in as yourself"
public_route_count=$((public_route_count + 1))

smoke_public_route "account-email-change-confirmed" "/account/email-change-confirmed" "Continue your e-mail change"

# An unsafe next value must stay on the sign-in page and resolve to the local
# default rather than becoming an open redirect.
open_page "unsafe-return-path" "/sign-in?next=https%3A%2F%2Fevil.example"
assert_url "$BASE_URL/sign-in?next=https%3A%2F%2Fevil.example"
assert_heading "Sign in as yourself"
assert_return_path "/portal"
public_route_count=$((public_route_count + 1))

# Start from a fresh sign-in document so prior route assertions cannot leave
# focus on a stale node. Resolve the skip link in a fresh accessibility snapshot,
# focus it, and activate it with a real keyboard event; a programmatic click does
# not prove that keyboard activation reaches the landmark.
browser open "$BASE_URL/sign-in" >/dev/null
browser wait --load networkidle >/dev/null
browser snapshot -i >/dev/null
browser focus @e1 >/dev/null
browser press Enter >/dev/null
browser wait --fn 'document.activeElement && document.activeElement.id === "main-content"' >/dev/null
focus_reached_main="$(browser eval 'document.activeElement ? document.activeElement.id === "main-content" : false')"
# Content boundaries wrap eval output with page-origin markers. Match the
# result line without disabling those safety markers for the test session.
[[ "$focus_reached_main" == *$'\ntrue\n'* ]] || fail "the skip link did not move focus to main-content"
capture_checkpoint "skip-link"

smoke_redirect_route "portal" "/portal" "%2Fportal"
smoke_redirect_route "portal-members" "/portal/members" "%2Fportal%2Fmembers"
smoke_redirect_route "portal-members-import" "/portal/members/import" "%2Fportal%2Fmembers%2Fimport"
smoke_redirect_route "portal-invitations" "/portal/invitations" "%2Fportal%2Finvitations"
smoke_redirect_route "portal-rounds" "/portal/rounds" "%2Fportal%2Frounds"
smoke_redirect_route "portal-group" "/portal/group" "%2Fportal%2Fgroup"
smoke_redirect_route "portal-standings" "/portal/standings" "%2Fportal%2Fstandings"
smoke_redirect_route "portal-reports" "/portal/reports" "%2Fportal%2Freports"
smoke_redirect_route "portal-billing" "/portal/billing" "%2Fportal%2Fbilling"
smoke_redirect_route "member-first-run" "/member/first-run" "%2Fmember%2Ffirst-run"
smoke_redirect_route "member-home" "/member/home" "%2Fmember%2Fhome"
smoke_redirect_route "member-inbox" "/member/inbox" "%2Fmember%2Finbox"
smoke_redirect_route "member-profile" "/member/profile" "%2Fmember%2Fprofile"
smoke_redirect_route "member-directory" "/member/directory" "%2Fmember%2Fdirectory"
smoke_redirect_route "member-results" "/member/results" "%2Fmember%2Fresults"
smoke_redirect_route "member-standings" "/member/standings" "%2Fmember%2Fstandings"
smoke_redirect_route "member-round" "/member/rounds/00000000-0000-4000-8000-000000000000" "%2Fmember%2Frounds%2F00000000-0000-4000-8000-000000000000"
smoke_redirect_route "member-results-round" "/member/results?round_id=00000000-0000-4000-8000-000000000000" "%2Fmember%2Fresults%3Fround_id%3D00000000-0000-4000-8000-000000000000"
smoke_redirect_route "account" "/account" "%2Faccount"
smoke_redirect_route "account-privacy" "/account/privacy" "%2Faccount%2Fprivacy"
# The signed-out setup page uses the canonical portal return destination.
smoke_redirect_route "sign-up-finish" "/sign-up/finish" "%2Fportal"

browser errors >"$AGENT_BROWSER_ARTIFACT_DIR/page-errors.txt"
browser console >"$AGENT_BROWSER_ARTIFACT_DIR/console.log"
browser network requests --type document,xhr,fetch >"$AGENT_BROWSER_ARTIFACT_DIR/network.log"
[[ ! -s "$AGENT_BROWSER_ARTIFACT_DIR/page-errors.txt" ]] ||
  fail "the browser reported page errors"

printf 'PASS: %d public routes, %d signed-out protected redirects\nArtifacts: %s\n' "$public_route_count" "$protected_route_count" "$AGENT_BROWSER_ARTIFACT_DIR"
