# Phase 02 — Member onboarding

## Goal

Let coordinators add and manage members while preserving identity, history, privacy, and role rules.

## Deliverables

- Implement member create, invite, resend, accept, edit, deactivate, and reactivate flows.
- Attach an accepted invitation to the authenticated identity and refuse a second active membership for that identity.
- Support invitation acceptance when the authenticated account e-mail differs from the invited address, including the administrator correction path for a pending invitation.
- Introduce the notification infrastructure this phase's e-mail needs and no more: the outbox job, per-recipient delivery records keyed by event, recipient, and channel, hard-bounce and complaint suppression, and delivery state on the member record and dashboard. Preferences are unnecessary here because both events this phase sends are mandatory categories.
- Send the membership invitation and the role granted or revoked e-mail through that outbox.
- Implement member profile, private contact projections, role changes, and their audit events.
- Build the group settings surface with the quota rules this phase needs: method, history length, precision and rounding, initial-quota behavior, and the Method C adjustment-band editor with its completeness and overlap validation. Guest permission and merit settings arrive in the phases that consume them.
- Support up to 20 validated seed point totals and initial quota.
- Implement and unit-test the three quota methods as server-side domain rules; later phases connect official round results and reopen behavior.
- Implement all-or-nothing CSV member import with validation, progress, idempotency, and audit.
- Keep historical members resolvable by deactivating instead of deleting them.

This phase does not add billing, GHIN synchronization, multi-group membership, per-group contact addresses, or bulk communication.

## Exit criteria

- New and existing identities can accept invitations according to the identity rules.
- Pending, active, and inactive membership behavior is enforced by the server.
- Member contact data is private by default and returned only through role-filtered projections.
- Seed history and quota examples produce the specified exact results and precision, including half-away-from-zero rounding at each supported precision.
- A Method C band table with a gap or an overlap cannot be saved.
- Repeated invitation, import, and role operations do not create duplicate effects.
- Invitation delivery failures are stored, suppress further optional e-mail to that address, and are visible to authorized administrators rather than looking like an ignored invitation.

## Master-spec coverage

- Section 6.2 — Member invitation and onboarding
- Sections 7.9–7.11 — Member-facing history, directory, profile, and account
- Sections 8.3–8.6, 8.11, and 8.13 — Dashboard membership counts, member administration, import, quota settings, roles, and activity
- Sections 10.4–10.5 — Membership and import job lifecycles
- Sections 11.5–11.6 — Quota calculation, initial quota, and precision
- Sections 12.1–12.2 — Invitation and role notification events and delivery rules
- Section 13.4 — Audit event, outbox job, import job, delivery, and suppression entities
- Acceptance scenarios 2 and 19
- Acceptance scenario 3 begins here and closes in Phase 03
