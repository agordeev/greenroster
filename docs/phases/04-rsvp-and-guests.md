# Phase 04 — RSVP and guests

## Goal

Let invited members respond from mobile or the member web view and manage permitted round-scoped guests.

## Deliverables

- Implement Playing and Not Playing mutations with eligibility, deadline, version, source, and audit checks.
- Append an RSVP event for every confirmed change and update coordinator counts through realtime.
- Implement the mobile next-round and round-detail RSVP experience, and the Home next-round card that leads to it.
- Implement the authenticated member-web Next round page using the same server mutation, and the one-time e-mail sign-in that establishes a normal session for a member who has not installed the app.
- Register Expo push devices per authenticated user, request permission in context with an explanation, retire tokens on sign-out and on invalid receipts, and keep every feature usable when permission is declined.
- Add the member notification preference model and its mobile screen, including which categories are mandatory and whether the operating system currently grants push. Phase 03's published-round notification becomes preference-aware here.
- Make a notification tap and an e-mail link resolve through authorization to the round it references, or to a permission-denied state when the resource is outside the member's group.
- Add the RSVP reminder condition to the scheduled job, sent once to participants who have not responded as a deadline or start time approaches.
- Add the guest-permission group setting, and implement member-sponsored guest creation, editing, withdrawal, and coordinator override.
- Create a guest atomically as a Playing round participant without account or contact data.
- Prevent guests from appearing in permanent membership, quota history, or standings.

The remaining member-web Results and Standings pages are completed with their authoritative data in Phase 06. This phase does not add guest accounts or guest notifications, and quiet hours and provider-outage behavior are hardened in Phase 07.

## Exit criteria

- iOS, Android, and member-web RSVP calls produce the same confirmed state, timestamp, audit event, and realtime count, with a source that distinguishes them.
- Duplicate submissions are idempotent and busy states prevent accidental resubmission.
- Offline RSVP is never displayed as confirmed before the server accepts it.
- A member who declines push permission still receives every event by e-mail, and disabling an optional category stops it while mandatory categories continue.
- A signed-out device receives no further notifications.
- An RSVP reminder is sent at most once per participant per round.
- Guest creation and withdrawal enforce sponsor, coordinator, and round-state permissions.
- Cross-group, inactive-member, expired-deadline, and stale-version cases fail safely, and a deep link outside the member's group reveals nothing about the resource.

## Master-spec coverage

- Section 6.4 — RSVP and guest signup
- Sections 7.4–7.6 and 9 — Mobile Home, round detail, RSVP, guests, and member web view
- Section 10.2 — RSVP lifecycle
- Section 14 — Realtime subscriptions and authorized projections, first consumed by RSVP counts
- Sections 12.1–12.4 — RSVP reminder event, preferences, the reminder job, and push channel rules
- Section 13.4 — Notification preference and push device entities
- Acceptance scenarios 5 and 6
- Acceptance scenario 17 begins here and closes in Phase 07
- Acceptance scenario 18 begins here and closes in Phase 06
