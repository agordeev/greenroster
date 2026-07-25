# Phase 03 — Round setup and publication

## Goal

Let a coordinator create a private draft and publish a correctly snapshotted round without duplicate participants or notifications.

## Deliverables

- Implement round Draft creation and editing with group-time-zone handling.
- Support only Individual Net and Individual Gross with their allowed final-total field toggles.
- Preview active members as No response participants and show exclusions and ineligible reasons before publication.
- Validate publication readiness, then snapshot the applicable rules, quota, handicap, and participant values atomically.
- Transition Draft to Published, open RSVP, and queue one notification per eligible recipient and enabled channel in the same transaction.
- Make repeated Publish requests idempotent, including their notifications.
- Implement material Published edits with an impact summary and the coordinator's decision whether to announce them.
- Implement round cancellation with confirmation, reason, audit, and mandatory participant notification.
- Add coordinator round-list and round-detail states needed to operate Draft and Published rounds.

This phase proves notification correctness at the delivery-record layer and sends e-mail with default preferences. Push registration, member preferences, and the member-facing destination a notification opens arrive in Phase 04, so nothing here builds a link to a screen that does not exist yet.

Do not implement live scoring, advanced formats, teams, skins, or hole-by-hole entry.

## Exit criteria

- Draft rounds are invisible to members until publication.
- Publication creates stable participant and rule snapshots in one transaction, storing the actual rule values used rather than a pointer to mutable settings.
- Repeating Publish returns the confirmed round without duplicating notifications.
- Individual Net cannot publish without every required quota snapshot.
- Changing group settings after publication does not alter a published round's snapshot.
- Cancelled rounds retain their history and cannot accept RSVP or scores.
- Unit and integration tests cover formats, snapshots, transitions, authorization, audit, and outbox behavior.

## Master-spec coverage

- Section 6.3 — Round creation and publication
- Sections 8.7–8.8 — Round administration and participants
- Section 10.1 — Round lifecycle
- Sections 11.1 and 11.4 — Authoritative calculations and individual formats
- Sections 12.1–12.2 — Round publication, change, and cancellation events
- Sections 13.2–13.3 — Configuration and round entities
- Acceptance scenarios 3 and 4
- Acceptance scenario 21 begins here and closes in Phase 07
