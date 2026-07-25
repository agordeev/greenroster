# Phase 01 — Identity and group isolation

## Goal

Establish the security boundary every later feature depends on: one authenticated identity, one v1 membership, and strict isolation between groups.

## Deliverables

- Implement Supabase Auth session handling for web, member web, and mobile foundations.
- Add the group, user profile, and membership schema with immutable identifiers and tenant ownership.
- Create group and initial administrator membership atomically.
- Resolve group and role from the authenticated membership on the server; never trust a client-supplied group.
- Add deny-by-default RLS for member, coordinator, administrator, unauthenticated, revoked, and cross-group access.
- Establish the shared server mutation pipeline every later phase reuses: the authenticate, resolve, authorize, validate, version, execute, and commit-with-audit sequence, the error taxonomy clients must distinguish, and correlation identifiers threaded from request through audit record. Every later phase adds handlers to this pipeline rather than inventing its own.
- Add the audit event store and prove application users cannot edit or delete its rows.
- Apply rate limiting and non-enumerating copy to sign-in and recovery as those flows are built, not as a later retrofit.
- Add the mobile app shell: the four primary destinations, navigation, first-run profile and legal acceptance with recorded document versions, and honest empty states for features later phases fill in.
- Register app links and universal links and prove a link survives installation, authentication, and recovery before resuming its destination. Phase 02's invitation links depend on this working.
- Add the web portal shell: permission-aware navigation with server-side route authorization, the group and role header, and the role-denied state.
- Add the administrator onboarding checklist backed by real group state.
- Add the basic role model and protect the last active administrator.
- Provide safe loading, error, expired-session, permission-denied, and signed-out states.

No shared group password, active-group switcher, or multi-group identity behavior belongs in this phase or in v1. The header shows the group name as a label, never as a control.

## Exit criteria

- A new administrator can create a group and receives person-specific access.
- Two test groups cannot read, mutate, subscribe to, or infer each other's records.
- Revoked or inactive access fails on the next protected request.
- A second membership for an already-attached identity is refused by the server.
- The onboarding checklist reflects stored state rather than local UI state.
- One correlation identifier can be followed from a client request through the server action to its audit record.
- Authorization and RLS integration tests pass for every role introduced here.

## Master-spec coverage

- Sections 4.1–4.4 — Identity, roles, permissions, and membership states
- Section 5.2 — Domain invariants
- Section 6.1 — Group creation and onboarding
- Sections 7.1–7.3 — Mobile information architecture, role boundary, and first run
- Sections 8.1–8.2 — Portal shell and authorization
- Section 13.1 — Identity and tenant entities
- Section 15 — Service behavior and errors
- Sections 16.1–16.2 and 16.5 — Tenant isolation, authentication, and audit integrity
- Acceptance scenario 1
- Acceptance scenario 20 begins here and closes in Phase 07
