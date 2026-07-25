# Phase 05 — Live round

## Goal

Run round day safely: open scoring manually, accept authorized score revisions, and keep the live leaderboard current.

## Deliverables

- Implement the confirmed, authorized, and audited Published-to-Live transition, and notify Playing participants that scoring is open.
- Implement server-authoritative score mutations with expected version and device operation ID.
- Enforce field authority for members, sponsors, coordinators, and administrators.
- Calculate plus/minus and rankings on the server from snapshotted round inputs.
- Publish authorized score and leaderboard changes through Supabase Realtime.
- Add reconnect snapshot recovery and visible stale-state handling.
- Implement the mobile offline queue only for cached live-round score changes.
- Reject stale versions without overwriting and show the current server value for deliberate re-entry.
- Show the entered points total's resulting plus/minus as it is typed, so an entry error is visible at the moment it is made rather than at completion.
- Implement coordinator live operations, missing-score visibility, score corrections, and reasons/audit.
- Implement the atomic Playing-to-Not Playing workflow after scoring.
- Add the once-per-condition forgotten-round reminder, its missing-score count, and the persistent action-required flag on the dashboard and coordinator Home.

Nothing transitions a round automatically, and no client-authored rank or plus/minus becomes official. There is no merge interface and no separate sync-issues console: a stale write fails on the field that produced it.

## Exit criteria

- A score is official only after the server confirms its state and version.
- Connected authorized clients receive leaderboard changes within the specified target.
- Offline score operations survive app restart, sync exactly once, and surface permanent rejection.
- Concurrent stale edits are rejected and never silently overwrite confirmed values.
- Disabled fields and unauthorized scorers are rejected even when requests bypass the UI.
- A forgotten Live round produces one reminder, keeps its dashboard flag until completion or cancellation, and never changes state on its own.

## Master-spec coverage

- Sections 6.5 and 8.9–8.11 — Live scoring, operations, leaderboard, and manual opening
- Sections 7.4, 7.7–7.8 — Home live-round card, scorecard and offline sync, live leaderboard
- Sections 10.3, 11.1–11.4, and 14 — Score state, authority, calculations, realtime, and offline
- Sections 12.1 and 12.3 — Scoring-opened and awaiting-completion events, and the reminder job
- Acceptance scenarios 7, 8, 9, 12, 14, 15, and 16
