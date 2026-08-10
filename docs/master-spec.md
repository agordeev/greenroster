# GreenRoster v1 specification

Version: 2.0 simplified v1 baseline
Date: July 25, 2026
Status: implementation specification for the core product loop plus the approved August 10, 2026 parity expansion

## 1. Purpose and scope

This document specifies GreenRoster v1: one cross-platform golfer app for iOS and Android, one responsive web administration portal, and one shared service and data layer.

V1 covers the core round loop:

- identity, groups, and tenant isolation;
- member administration;
- round creation and publication;
- RSVP and guest participation;
- transactional e-mail and push notifications that drive the loop;
- server-authoritative scoring with a realtime live leaderboard;
- completion, reopen, and published results;
- quota history and standings.

### Approved parity expansion (August 10, 2026)

The original v1 baseline below was intentionally narrow. The current
implementation plan now includes the following locally verified parity slices,
which supersede any conflicting baseline exclusion:

- Stripe-normalized group billing, trial state, checkout/portal boundaries,
  webhook idempotency, invoices, and member entitlement enforcement;
- dated group news/media, round messages, coordinator contact, branding assets,
  and token-scoped kiosk scoreboard branding;
- hole-level strokes, putts, fairways, greens, sand saves, comments, revisions,
  and personal golf-statistics reads;
- member-web round detail and round-day parity views, plus operational CSV/PDF
  reports and score-pad downloads;
- a tenant-safe legacy import foundation with fingerprinted jobs, row
  validation, mappings, exceptions, and audit history.

These additions keep the server authoritative, preserve tenant isolation, and
do not invent undocumented game rules. Teams, skins, Require Entry, best ball,
scramble, GHIN, SMS, multi-group identities, and production legacy cutover
remain outside the executable contract until their rules, credentials, or
migration ownership are approved. Hosted migration, provider configuration,
and deployment verification remain release gates.

### 1.1 Historical v1 baseline exclusions

The following paragraph records the original core-loop boundary. The approved
parity expansion above takes precedence for the named slices.

The following are deliberately out of scope. Planning detail for each is preserved in [`future-scope.md`](./future-scope.md), which creates no v1 obligation.

Billing and subscription entitlement, in-app and round messaging, news and media content, group branding, the clubhouse scoreboard, GHIN handicap integration, generated reports and administrator exports, legacy-data migration and cutover, advanced game formats (teams, skins, `Require Entry`, best ball, scramble, hole-by-hole scoring), and multi-group membership for a single identity.

One identity belongs to one group in v1, as Section 4.1 explains. The service is still multi-tenant with strict isolation between groups; what is deferred is one person spanning them, along with the active-group switching, group-scoped contact addresses, and per-membership preferences that would require.

Notifications are in scope, but only as fixed transactional messages tied to the events in Section 12. What stays deferred is the surrounding machinery: an in-app notification inbox, free-text bulk communication, templates, an audience builder, scheduled campaigns, and per-group notification policy configuration. A coordinator cannot compose and send arbitrary messages in v1.

SMS is excluded outright. There is no v1 provider, consent model, storage, UI, or send path, and legacy carrier e-mail gateways must never be used as an SMS substitute.

Printed and PDF output is excluded from v1. Groups that need paper use the browser's own print function on a results or roster page.

Ordinary operational concerns — deployment, backups, release rollback, security, privacy, accessibility, and observability — remain in scope at the level described in Sections 16 and 17.

### 1.2 Sources

[`tech-stack.md`](./tech-stack.md) is authoritative for technology and architecture. [`GreenRoster-system-explained.md`](./GreenRoster-system-explained.md) documents the legacy product and observed business behavior. Where this document defines behavior the legacy product did not have, it is a deliberate replacement decision rather than a parity claim.

The legacy product was audited from ten desktop-web screenshots; its mobile site could not be inspected. Every mobile layout and interaction below is therefore a target requirement derived from documented workflows, not a reconstruction of a legacy screen.

## 2. Product overview

GreenRoster is a multi-tenant golf points-game service. A group maintains members and rules, schedules recurring rounds, collects Playing/Not Playing responses, manages guests, captures scores and points, calculates plus/minus and winners, publishes live and final results, and updates quotas and standings.

The repeated loop is:

`Invitation → RSVP → round-day scoring → live leaderboard → completion → published results → updated history/quota/standings`

### 2.1 Surfaces

| Surface           | Audience                                                    | Scope                                                                                                                               |
| ----------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Golfer mobile app | Members, coordinators, and administrators acting as golfers | Identity, home, rounds, RSVP, guest signup, score entry, live leaderboard, results, standings, directory, personal history, profile |
| Web admin portal  | Coordinators and administrators                             | Group onboarding, members, rounds, live operations, game and quota rules, roles, recent activity                                    |
| Member web view   | Members who have not installed the app                      | Next round with RSVP, round results, and standings, read-only apart from RSVP                                                       |
| Service layer     | All clients                                                 | Authentication, authorization, business rules, transactions, realtime publication, notification delivery, auditability              |

The mobile app is one React Native/Expo product with identical features and business behavior on iOS and Android. Platform differences are limited to native conventions: system back behavior, secure token storage, accessibility APIs, and deep-link registration.

The mobile app is the primary member surface and the only place scores are entered. The member web view exists so that a golfer who will not install an app can still answer an invitation and read results, which the legacy shared group login allowed. It is three authenticated screens on the existing Next.js application, not a second product: no scoring, no guest management, no profile editing, no directory. Section 9 defines it.

App links open the installed app when present and otherwise fall back to the member web view. Anonymous response tokens are prohibited: every RSVP is made by an authenticated person, whether in the app or the browser.

### 2.2 Goals

- Make the round-day loop understandable without prior knowledge of the legacy tables.
- Let members respond, score, and see results from either mobile platform.
- Reach members where they already are, so a published round produces responses without the coordinator chasing people by hand.
- Give coordinators a fast view of invitations, responses, missing scores, and completion readiness.
- Make every score mutation server-authoritative, realtime, and auditable.
- Preserve historical quotas and results even when current member values or group rules change.
- Support many independent groups with strict tenant isolation.
- Replace shared credentials with one person identity and group-scoped roles.

### 2.3 Non-goals

- Do not recreate the legacy interface pixel for pixel.
- Do not create separate iOS and Android roadmaps or divergent business behavior.
- Do not introduce a separate backend, microservices, Kubernetes, Redis, or a message broker without a demonstrated need and a change to `tech-stack.md`.
- Do not calculate or claim GHIN data without an authorized integration.
- Do not invent team, skins, non-points, or hole-by-hole scoring rules.
- Do not carry the legacy shared group password or secondary administrator password into the replacement.
- Do not build a free-text message composer, template editor, or audience builder; v1 notifications are fixed transactional messages only.
- Do not grow the member web view into a second full portal.
- Do not build active-group switching, group-scoped contact addresses, or any UI implying one person can hold two memberships.
- Do not expose controls for any capability listed in Section 1.1.

### 2.4 Shared screen states

Every data screen on both clients defines and implements:

- initial loading or skeleton state;
- first-use empty state showing the next permitted action;
- filtered-empty state, distinct from a truly empty dataset;
- recoverable network/error state with retry;
- permission-denied state that leaks no protected data;
- stale/offline state where applicable;
- success confirmation for consequential mutations;
- unsaved-change protection on multi-field forms;
- disabled/busy state preventing duplicate submission.

Bulk actions stay disabled until the selection is valid and always show the selected record count. Destructive or consequential actions show a dependency and effect summary before confirmation.

## 3. Technology and architecture

| Concern                                | Technology                     |
| -------------------------------------- | ------------------------------ |
| Mobile                                 | React Native, Expo, TypeScript |
| Web portal, member web view, and API   | Next.js, React, TypeScript     |
| Database, auth, realtime, file storage | Supabase                       |
| Push notifications                     | Expo Notifications             |
| E-mail                                 | Resend                         |
| Hosting                                | Vercel and Supabase            |

Architecture rules:

- One Next.js application codebase and one hosted Supabase project. GreenRoster has only one application environment.
- PostgreSQL is the source of truth.
- Business rules execute in Next.js server code and transactional PostgreSQL operations, never independently in client code.
- Clients call authenticated Next.js server endpoints for every protected mutation.
- Supabase Row Level Security provides defense in depth for all tenant data.
- Supabase Realtime distributes authorized changes for leaderboards, RSVP counts, and round state. It is never an alternate mutation path.
- Supabase Storage holds v1 application files.
- Notification sends and scheduled reminders use an idempotent database-backed outbox and job model, so a committed business event cannot lose its notification and a retry cannot double-send. No separate queue service.
- Provider calls to Expo and Resend happen only from server-side jobs. Clients never hold provider credentials.
- Secrets live only in runtime configuration or provider-managed secret storage, and configuration is validated at startup.

### 3.1 Single environment

GreenRoster has one application environment backed by one hosted Supabase project, including Auth, Realtime, Storage, secrets, and callback URLs. Local Docker is used for development and automated testing with synthetic data; it is a local runtime, not another application environment, and it never uses hosted user data or credentials.

The operating organization owns the Apple Developer/App Store Connect and Google Play Console accounts; personal developer accounts are prohibited. The app uses `com.greenroster.app` as both the iOS bundle identifier and the Android application ID, subject to availability verification before registration. These identifiers are immutable once registered.

## 4. Users, roles, and permissions

### 4.1 Identity

- Every authenticated person has one Supabase Auth identity.
- One person belongs to exactly one group in v1. The service is multi-tenant — many independent groups coexist with strict isolation — but a single identity does not span them.
- Every permission derives from the person's membership and role in that group.
- The server resolves the group from the authenticated membership rather than trusting a client-supplied group, and validates group ownership on every request.
- Role changes take effect immediately for new mutations.
- Shared group credentials and separate administrator unlock passwords do not exist.
- Invitation acceptance attaches a pending membership to the authenticated identity, and is refused when that identity already holds an active membership.

Because one identity maps to one membership, v1 needs only one e-mail concept. The **account e-mail** belongs to the Auth identity, is globally unique, and is used for sign-in, recovery, and every product notification. There is no separate group-scoped contact address to keep unique, verify, or reconcile.

Invitations are the one place two addresses can meet. A coordinator invites the address they know; acceptance proves possession of the token and control of the authenticated account. If the invitee signs in with a different address, the invitation still attaches to their identity, and the coordinator sees the address that actually accepted. An administrator may correct a pending invitation's address before acceptance. A user-initiated account e-mail change affects authentication and where notifications go; it never creates a second identity.

An optional secondary e-mail and phone numbers remain as directory contact metadata for legacy parity. They are never used for sign-in or notification delivery.

A person who needs to belong to two groups signs up separately in each, with separate accounts, in v1. Multi-group membership is deferred; see [`future-scope.md`](./future-scope.md).

### 4.2 Roles

| Role              | Definition                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Member            | Permanent golfer. Uses member-facing functions for self and views group information permitted by privacy rules.                                                                      |
| Coordinator       | Operational manager. All member capabilities plus day-to-day member, round, and score management.                                                                                    |
| Administrator     | Group owner. All coordinator capabilities plus group configuration, roles, and security.                                                                                             |
| Guest participant | Round-scoped golfer without a permanent membership. Appears only in the round and its results. No account access.                                                                    |
| System actor      | Authenticated background action such as a completion calculation, a notification send, a scheduled reminder, or an import job, holding only the narrow permission that job requires. |

A coordinator or administrator using the mobile app gets the golfer experience plus the designated mobile round-operation controls. The full administrative surface stays on the web portal.

### 4.3 Permission matrix

| Capability                                |          Member           |       Coordinator       |      Administrator      |             Guest              |
| ----------------------------------------- | :-----------------------: | :---------------------: | :---------------------: | :----------------------------: |
| View own profile/history                  |            Yes            |           Yes           |           Yes           |      No permanent profile      |
| Edit own permitted profile/privacy fields |            Yes            |           Yes           |           Yes           |               No               |
| View directory and public member fields   |            Yes            |           Yes           |           Yes           |               No               |
| View rounds, standings, and results       |            Yes            |           Yes           |           Yes           |      No in-product access      |
| RSVP for self                             | When active and eligible  |           Yes           |           Yes           | Sponsor or coordinator manages |
| Add own guest                             | When group policy permits |           Yes           |           Yes           |               No               |
| Enter score during a live round           |  Own Playing participant  | Any Playing participant | Any Playing participant | Sponsor or coordinator enters  |
| Add/edit/import members                   |            No             |           Yes           |           Yes           |               No               |
| View private contact data                 |            No             |      Yes, audited       |           Yes           |               No               |
| Manage rounds, participants, and scores   |            No             |           Yes           |           Yes           |               No               |
| Complete/reopen a round                   |            No             |           Yes           |           Yes           |               No               |
| Change quota/game rules                   |            No             |           No            |           Yes           |               No               |
| Manage roles                              |            No             |           No            |           Yes           |               No               |
| Read audit log                            |            No             |   Operational subset    |           Yes           |               No               |

The server enforces this matrix. Hidden controls are not authorization.

### 4.4 Membership states

- `pending` — invited but not accepted;
- `active` — may RSVP and be assigned to rounds;
- `inactive` — cannot RSVP or be newly assigned, is hidden from default lists and the directory, and receives no notifications.

Inactive members cannot sign up, and reactivation precedes any new round assignment. Deactivation replaces destructive member deletion: a member who has ever appeared in a round is never deleted, because historical participant records must stay resolvable. There is no separate archived state — inactive already carries both meanings.

## 5. Domain model and invariants

### 5.1 Terms

| Term                | Meaning                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Group               | Tenant representing a club or recurring golfer collection. It need not belong to one course.                                                                                                                     |
| Membership/member   | A person's long-lived relationship to a group: role, status, current quota, handicap, history.                                                                                                                   |
| Guest               | A golfer added to one round without permanent membership.                                                                                                                                                        |
| Round               | Scheduled golf event with settings, participants, scores, results, and lifecycle state. Called a DogFight in the legacy product.                                                                                 |
| Participant         | A member or guest represented in one round with snapshotted golf values and round-specific state.                                                                                                                |
| Points              | Golf-game points recorded for a participant as a final round total.                                                                                                                                              |
| Quota               | Target points for a golfer. Stronger golfers normally have higher quotas.                                                                                                                                        |
| Plus/minus          | `round points − round quota`.                                                                                                                                                                                    |
| Merit points        | Separate ranking points used for Order of Merit, made up of a participation amount, an optional placement amount from the round's ranking, and any manual adjustment. Not the same as golf points or plus/minus. |
| Order of Merit      | Group ranking derived from eligible member merit points within the configured standings window.                                                                                                                  |
| Playing/Not Playing | Human-readable RSVP states corresponding to legacy `P` and `N`.                                                                                                                                                  |
| Completed round     | A finalized round whose results are visible and whose scoring fields are locked until an authorized reopen.                                                                                                      |

### 5.2 Invariants

- Every tenant-owned record resolves unambiguously to one group.
- A member record and a round participant record stay separate.
- A participant snapshots every value the selected format requires. Individual Net requires a quota snapshot; Individual Gross does not. Handicap is snapshotted only when supplied. Later membership or rule changes never rewrite an existing snapshot.
- A guest never silently becomes a member and never appears in permanent-member totals or long-term standings.
- Only a participant whose RSVP status is Playing may receive scoring values.
- Plus/minus is calculated on the server as `points − round quota` whenever both values exist. Clients may preview it but cannot author it. It does not apply when Individual Gross has no quota snapshot.
- Completed results are read-only until an authorized reopen.
- Reopening reverses only completion-generated effects, including generated participation and placement merit, before recalculation. Manually authored merit is not generated and survives.
- Every completion, reopen, score override, quota override, role change, and import is audited.
- Historic rounds, results, and audit records are never hard-deleted through product UI.
- All ranking and tie logic executes in a registered server rule, never in display sorting.

## 6. Core workflows

### 6.1 Group creation and onboarding

An authorized new administrator supplies group name, group time zone, and administrator contact identity. The server creates the group and the administrator membership atomically. The dashboard then shows an onboarding checklist: complete the group profile, select quota and game rules, invite or import members, create and publish the first round. The checklist reflects real state and cannot be dismissed as complete while mandatory configuration is missing.

### 6.2 Member invitation and onboarding

1. A coordinator chooses Add member, Invite member, or CSV import.
2. A permanent member requires at minimum first name, last name, a normalized e-mail address, membership status, and initial golf/quota configuration.
3. Optional fields remain available: spouse names, secondary e-mail, phones, address, contact visibility, Handicap ID, handicap, tee, dues-paid flag, role, and up to 20 prior points totals.
4. The portal validates the record, then creates a pending membership and a single-use expiring invitation.
5. The server e-mails the invitation to the contact address. The portal also exposes the link so an administrator can resend or hand it over directly, and shows delivery state so a bounced address is visible rather than silently unanswered.
6. The invitee authenticates through Supabase Auth, accepts the membership, and lands in the app or, if they have not installed it, the member web view.
7. If an existing identity matches the normalized e-mail, the invitation attaches a new membership rather than creating a second identity.

### 6.3 Round creation and publication

1. A coordinator creates a round in Draft.
2. General information is completed and validated.
3. The coordinator selects Individual Net or Individual Gross and configures the enabled final-total fields.
4. The draft previews every active member as a No response participant and lets the coordinator explicitly exclude records before publication. Inactive members stay ineligible until reactivated.
5. Review shows the final included participants, explicit exclusions, and ineligible members with reasons.
6. Publishing snapshots the applicable rule values plus each participant quota and handicap value the format requires or that was supplied, then opens RSVP and notifies the invited participants.
7. Repeated Publish actions are idempotent and never re-notify anyone already notified.

### 6.4 RSVP and guest signup

1. A member opens the round from a push notification, an e-mail link, or the app, and sees date and time in the group time zone, venue, notes, format, current response, and the response deadline when configured.
2. The member selects Playing or Not Playing and confirms, from either the app or the member web view.
3. The server records actor, previous status, new status, timestamp, and source.
4. Mobile updates optimistically, then shows confirmed or failed. A failure restores the prior confirmed state.
5. Coordinator dashboard counts update through Realtime.
6. Where group policy permits guests, a Playing member may add a round-scoped guest in the app. The guest is created atomically with RSVP state Playing and an RSVP event naming the sponsor as actor.
7. Coordinator guest corrections follow the live/first-score lock in Section 7.6. All changes are audited.
8. Inactive or otherwise unauthorized members see a clear non-actionable state and cannot bypass the server rule.

### 6.5 Live scoring

1. An authorized scorer opens a live round.
2. The app downloads the roster, current record versions, available quota and handicap snapshots, and the format's enabled score fields.
3. The scorer enters the round-level points total and any other enabled final-total values their role permits.
4. Client validation catches format and required-field errors. The server repeats all validation.
5. Each submission carries an idempotency key and the last-seen record version.
6. In one logical operation the server commits the score revision, recalculates plus/minus and applicable results, writes an audit event, and emits the authorized realtime change.
7. Other clients receive the update with no manual import step.
8. Offline, the app stores a durable pending operation, labels the affected values Pending sync, and retries in order once connectivity returns.
9. If the record changed since the edit began, the server rejects the write rather than overwriting. The app says the value was changed by someone else, shows the current server value, and requires the scorer to re-enter their intended value. There is no merge interface.
10. The UI always distinguishes confirmed server values from local pending values.

Who computes the points is a deliberate boundary. V1 records the final points total a golfer or coordinator enters; it does not calculate points from hole-by-hole scores, because the legacy product did not either and no confirmed per-hole point rules exist. Golfers work out their own points on the paper scorecard as they always have, then enter the total. To keep entry errors visible rather than silent, the app shows the resulting plus/minus immediately as the total is typed, validates the total against the range in Section 11.6, and lets a coordinator correct any value with an audited reason. Automatic point calculation requires hole-by-hole scoring and course data, which stay out of scope.

### 6.6 Completion, publication, and reopen

1. A coordinator requests completion from the round operations page.
2. The server runs a readiness check and returns Playing participants missing required data, unsynced mobile scores, invalid format configuration, calculation errors, and non-blocking warnings.
3. The portal presents winners, ties, generated merit effects, and standing and quota impacts.
4. The coordinator confirms.
5. In one idempotent server workflow the system freezes the final input revision, calculates official results, applies generated merit, updates eligible history, quota, and standing projections, marks the round Completed, records an audit event, and queues the results-published notification.
6. Completed results become read-only and appear in Home, round history, and member history.
7. An authorized coordinator may Reopen with a reason, having seen the consequences.
8. Reopen removes generated merit and derived completion outputs, retains prior audit and revision history, and returns the round to Live.
9. Re-completion recalculates from the latest authoritative inputs and replaces the published result.

A round nobody completes is a real operational failure, because quotas stop updating for everyone in it. The server therefore treats a round still Live well after its start time as an exception: it appears as action-required on the dashboard, and the scheduled reminder in Section 12.3 notifies coordinators. Reminders never change round state on their own — completion stays a deliberate human action.

## 7. Mobile app

Both platforms expose the same data, roles, actions, calculation results, and offline semantics. Both support the current Expo-supported operating-system versions, with exact minimums recorded in release configuration. Android system Back and iOS navigation gestures must return to equivalent states.

Secure session material uses platform-secure storage. Sensitive content is never written to general logs or unencrypted caches. App links and universal links support invitation acceptance, round detail, RSVP, live leaderboard, and result detail. A link referencing a resource outside the signed-in member's group resolves to a permission-denied state that reveals nothing about the resource, not to a context switch.

### 7.1 Information architecture

Four primary destinations:

1. **Home** — next round, RSVP, live-round status, recent result.
2. **Rounds** — upcoming, live, and completed rounds with round detail.
3. **Leaderboard** — direct entry to the active live board, or a no-live-round state with recent results.
4. **Profile** — personal golf data, history, privacy, account.

The member directory, standings, and group information are reachable from Home and Profile. Deep links and notification taps open the exact round after authentication. Unsynced scores are surfaced inline on the scorecard and as an action-required item on Home rather than in a separate operations console.

### 7.2 Role boundary

| Capability                                           | Member                      | Coordinator/admin in mobile                 | Web portal                            |
| ---------------------------------------------------- | --------------------------- | ------------------------------------------- | ------------------------------------- |
| Home, directory, rounds, results, standings, profile | Native                      | Native                                      | Read views where useful               |
| Own RSVP and permitted guest signup                  | Native                      | Native when acting as participant           | Override/manage                       |
| Round score entry                                    | Own Playing participant     | Any Playing participant                     | Full operational entry and correction |
| Live roster and leaderboard                          | Native permitted projection | Native, including unsynced-score visibility | Full history                          |
| Add/import/mass-update members                       | No                          | Web handoff                                 | Yes                                   |
| Create/edit/publish/cancel/complete/reopen rounds    | No                          | Web handoff                                 | Yes                                   |
| Rules, roles, and recent activity                    | No                          | Web handoff                                 | Yes                                   |

A web handoff opens the signed-in responsive portal at the exact resource. Mobile never shows a control that has neither a native action nor a working handoff.

### 7.3 Authentication and first run

Screens: welcome/sign in, e-mail and password sign in, password recovery, invitation acceptance, and first-run profile and legal acceptance. There is no group-selection step, because an identity has one membership.

- Sign in uses Supabase Auth and a person-specific identity.
- The sign-in form validates normalized e-mail format, required password, submission state, authentication failure, network failure, and rate-limit response without revealing whether an arbitrary account exists.
- Password recovery uses the configured Supabase Auth flow and shows a neutral confirmation.
- An invitation link survives app installation, authentication, and account recovery, then resumes at the invitation decision.
- Invitation acceptance displays group name, inviter, invited e-mail, proposed role, expiration, and links to Terms and Privacy Policy.
- An expired, revoked, already-used, or address-mismatched invitation shows a specific safe recovery path.
- First run confirms first and last name and records acceptance of the current Terms and Privacy Policy, storing document versions and server timestamps. Optional golfer fields never block activation.
- The app requests push permission in context, when the user first sees a round they can respond to, and explains what it will send. Declining is fully supported: e-mail continues to carry the same events, and the app never blocks a feature behind push permission.
- Sign out removes local session credentials and protected cached group data, retaining only non-sensitive app preferences, and retires the device's push token so a later user of that device receives nothing.
- A deleted or disabled identity, or a revoked membership, loses access on the next server request and realtime subscription refresh.

### 7.4 Home

Content priority: active live round, then next upcoming round and current RSVP, then action-required items (invitation, missing RSVP, failed score sync), then the most recent completed result, then current quota and Order of Merit summary.

- The header shows the member's group name for orientation. It is a label, not a control.
- The next-round card shows local date and time, a group time-zone indicator when relevant, description, venue, format, roster count, RSVP state, and a primary action.
- A live-round card shows round state, the user's score sync state, leaderboard last-updated time, and Open scorecard / Open leaderboard actions as authorized.
- A recent-result card distinguishes the winner summary from full standings, names the format's ranking criterion, and links to official results.
- The quota and standing summary shows effective current quota, handicap source and date, merit total, rounds counted, and rank when available.
- Empty states distinguish no group, incomplete group setup, no upcoming round, and no completed history.
- Pull-to-refresh reconciles server state. Realtime updates may change visible values without moving focus or reordering content the user is acting on.
- Coordinator warnings deep-link to a real mobile action or the web portal, never to a non-functional control. For coordinators, a round still Live after its start time appears here as action-required.
- When several rounds are Live, Home lists them rather than silently choosing one, with the user's Playing rounds first and then by start time.

### 7.5 Rounds and round detail

The list provides Upcoming, Live, and Completed segments, with cancelled rounds behind a secondary filter. Each row shows date and time, description and venue, state, format summary, the current user's Playing/Not Playing/no-response status, participant count, and a pending or failed sync indicator when applicable.

- The default segment is Live when the group has a live round, otherwise Upcoming.
- Completed rounds paginate incrementally and support date filtering without loading full group history.
- A no-results filter state keeps the filter controls and offers Clear filters.
- A cached accessible round opens offline with a conspicuous last-synced indicator and mutations limited to offline-supported actions.
- State labels use full words. Legacy `P` and `N` codes never stand alone.

Round detail shows description, lifecycle state, date and time with group time zone, course or venue and optional URL, notes subject to the player-visible setting, the selected format and its scoring description, RSVP deadline if configured, the current user's response and its timestamp, Playing/Not Playing/no-response counts, and the completion timestamp when applicable. Sections are Overview, Players, Scorecard when authorized, and Live leaderboard or Results depending on state.

- Notes hidden from players are never delivered in member client payloads.
- The roster identifies member versus guest and shows only fields permitted by privacy settings.
- Each participant quota or handicap displays as the historical snapshot, labeled as such when it differs from the member's current profile. A value not enabled or not supplied is absent or marked Not applicable, never shown as zero.
- Format help explains quota, points, plus/minus, gross, net, and merit in the context of the selected format without requiring a global help page.
- A completed round replaces score-edit actions with official-result actions.
- A cancelled round stays readable to users who had access, shows the cancellation reason when present, and disables RSVP and scoring.

### 7.6 RSVP and guest signup

Available choices are Playing and Not Playing. No response is a system state, not a submitted response.

- The current confirmed selection and its last-changed time stay visible.
- Changing a response shows an immediate pending state, then server confirmation or rollback with an error.
- The server rejects RSVP after a closed deadline, and the app directs the member to a coordinator.
- An inactive or unauthorized member sees the exact restriction category.
- Coordinator overrides identify the coordinator in the audit log.
- RSVP changes update coordinator counts in realtime.
- An RSVP choice made offline is a local draft, not a queued response. It persists securely across restart, is labeled Not sent, and requires explicit confirmation after reconnect and server revalidation. If the deadline passes or eligibility changes, the draft is retained only long enough to explain the rejection.
- RSVP is locked after completion. Operational correction requires Reopen.

When group policy allows member-added guests, the mobile form provides:

| Field          | Requirement                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| First name     | Required                                                                                                        |
| Last name      | Required                                                                                                        |
| Round quota    | Required for Individual Net; optional informational snapshot for Individual Gross, never used for Gross ranking |
| Round handicap | Optional informational snapshot; no v1 calculation depends on it                                                |
| Tee            | Optional informational value                                                                                    |

V1 collects no guest e-mail or other guest contact detail. Guests receive no account, no notification, and no product access, so an address would be unused data carrying a privacy obligation. The sponsor is the contact path.

- Guest data creates a participant scoped only to the selected round.
- A new guest starts Playing. A sponsor withdraws the guest through the edit/remove workflow rather than submitting a separate guest RSVP.
- Adding a guest never sends an account invitation or creates a membership.
- Duplicate-like guests produce a warning, never an automatic merge.
- The sponsoring member may edit or remove their guest until the round becomes Live or the guest receives a confirmed score, whichever comes first. After that lock, only coordinators may make an audited correction, and completed-round changes require Reopen. A guest with score history is withdrawn, never deleted.
- Guests have no v1 authentication or self-scoring surface. The sponsor may enter the guest's enabled score fields; coordinators retain full operational authority.
- The UI states that guests appear in round results but are excluded from permanent-member totals and long-term standings.
- Guests receive no generated merit, quota updates, quota history, Order of Merit points, or member history.

### 7.7 Score entry and offline sync

V1 records round-level final totals only: gross score, net score, points, merit points, and derived plus/minus. Hole-by-hole entry and point conversion do not exist, for the reason given in Section 6.5.

The scorecard shows the current participant's name and roster position, read-only quota and handicap snapshots where applicable, the format's editable fields, a server-calculated plus/minus that updates as the points total is typed, sync state (Confirmed, Pending sync, Syncing, Failed, Locked), the last confirmed update time, previous/next participant navigation for operational scorers, and a save action reachable above the keyboard and by assistive technology.

- Only fields the selected format supports appear.
- Not Playing participants are read-only and receive no score, points, or merit values.
- The client never authors plus/minus, rank, winners, generated merit, or quota changes.
- Numeric inputs reject malformed values and preserve a valid zero. Range, sign, and decimal rules come from format policy, not UI constants.
- A submission includes round, participant, changed fields, last-seen version, device-local operation ID, and client timestamp. Server receipt time is authoritative.
- Offline operations persist across app restarts and are isolated by authenticated user and group.
- Signing out with pending operations warns the user and offers retry. Pending operations never transfer to another account.
- Retry is idempotent; a confirmed operation is never applied twice.
- If the server rejects a write because the record changed, the affected field shows Failed with the current server value and a Re-enter action. The app never silently overwrites and never asks the user to merge two versions.
- A round completed while a device was offline rejects queued score mutations when they arrive and states that coordinator action is required.
- Local preview ranking is visually distinct from confirmed live ranking while pending values exist.
- Coordinator corrections require a reason once a score has been published or previously confirmed in a completed result.

Unsynced and failed values are surfaced where the work happens: on the affected scorecard field, on the round row, and as one action-required item on Home that opens the affected scorecard. Copy never describes Pending sync as Saved.

### 7.8 Live leaderboard

A result row can contain rank, player, member/guest indicator, quota, points, plus/minus, gross or net score where relevant, merit points, and sync state.

- The leaderboard subscribes to authorized Realtime changes and updates confirmed rows without manual refresh.
- Confirmed online changes should reach other connected clients within about two seconds under normal conditions.
- The screen displays the last successful server update and the connection state.
- Ranking uses the server's format rule: Individual Net ranks by highest plus/minus, Individual Gross by highest points.
- Ties display the same rank and tie treatment the format policy defines. Alphabetic order never implies a winner.
- Missing scores are distinguishable from zero.
- Pending local scores may be shown to their author but never alter the official shared ranking until confirmed.
- Completed mode displays an Official result marker and the publication time. Internal result versioning is never surfaced as a number to users.
- If group policy disables visibility of other golfers' live scores, the client receives only the allowed projection.
- If several rounds are Live, the Leaderboard destination lists them in the same Playing-first, then start-time order as Home.
- When a screen reader is active or a row holds accessibility focus, incoming updates do not move that row. The app batches polite summary announcements and offers an Updated action to review rank changes.

### 7.9 Results, history, and standings

- Official round results show rank and tie, player, points, merit points, RSVP status, publication time, and the format-applicable quota, gross or net score, and plus/minus.
- Guests may appear in round results, labeled Guest, but are excluded from longitudinal member standings.
- Recent Results shows a true winner or tie summary separately from the full result list.
- Member history shows round date, format, points, merit points, applicable quota/score/plus-minus values, and whether the round counts in the current standings window.
- Personal statistics include current quota, quota history and trend, handicap with source and as-of time, total eligible merit points, eligible rounds played, last round, and Order of Merit rank.
- Standings show the configured reset date and explain that earlier data is retained but excluded from current rounds-played and Order of Merit calculations.
- Historical pages paginate with stable server ordering.
- A reopened round loses its Official state everywhere until recompleted, and members whose result changes are notified when it is republished.

### 7.10 Directory and group information

- The directory supports search and alphabet filtering and lists active members only by default.
- A directory record may show name, current quota, Order of Merit points and rank, recent points history, and last round, subject to privacy policy.
- Private e-mail, phone, and address fields are absent from unauthorized payloads, not merely hidden in the UI.
- Member details distinguish current profile values from historical round snapshots.
- The Group screen shows group name and only administrator-approved member-visible details: optional course information, optional golf-professional information, group contact details, group time zone, and rule summaries useful to golfers.
- Private administrator and contact fields are excluded by the server projection. A blank optional section is omitted or explained, never filled with placeholder data.
- Contact and external links use safe native actions and make the destination visible before leaving the app.
- The screen includes the member directory, standings, and group-rules help where the user has permission.

### 7.11 Profile and account

The profile surface exposes only fields the user may edit: first and last name, spouse fields if retained, the protected account e-mail in Account (changed only through the verified identity flow), an optional secondary contact e-mail, home/work/mobile phone, postal address, per-field directory visibility, Handicap ID and current handicap with source and as-of time, tee preference (Pro, Back, Middle, Front), group role and status as read-only, notification preferences, and privacy preferences.

Notification preferences let the user choose push, e-mail, or both for each category in Section 12.1, and turn optional categories off entirely. Round cancellation and account or security messages cannot be disabled, because a member who does not learn a round was cancelled will drive to the course. The screen states plainly which categories are mandatory and shows whether push permission is currently granted at the operating-system level, with a shortcut to system settings when it is not.

- Changing the sign-in e-mail uses a verified identity-change flow, never silently creates a second user, and redirects future notifications to the new address.
- Changing current quota, membership status, role, or dues is not member self-service.
- Users can sign out, leave the group where policy permits, and request account deletion or data access.
- Leaving or deleting an account pseudonymizes the person while retaining historical sporting records. The impact is explained before confirmation.
- Profile/About provides contextual help, contact support, send feedback, Privacy Policy, Terms of Use, app version and build, and a way to copy a support correlation identifier after an error.

### 7.12 Mobile accessibility and resilience

Support Dynamic Type without clipping essential controls, and give every interactive element a screen-reader name, value, state, and hint. Never convey Playing/Not Playing, sync state, rank movement, or errors by color alone. Touch targets meet platform guidance: at least 44×44 points on iOS and 48×48 density-independent pixels on Android where feasible. Keyboard type matches the field, though server validation stays authoritative; focus moves to the first invalid field after submission and validation messages are announced. Motion for live rank changes respects reduced-motion settings and never steals focus.

Score entry must stay usable one-handed, in sunlight, and with transient poor connectivity. Sensitive content is obscured in task-switcher snapshots. A cold start with no network shows the last safely cached authorized state and clear offline limitations, not an indefinite spinner. Cached protected data and pending operations are purged on sign-out and on detected membership revocation.

## 8. Web admin portal

### 8.1 Global shell

- Every authenticated page shows product identity, group name, signed-in person, role, help, account, and sign out. Footer or account navigation also exposes Contact support, Send feedback, Privacy Policy, and Terms of Use.
- Navigation is permission-aware, but route authorization stays server-side.
- The portal is fully usable at 1280 CSS pixels and above and remains operational at 768 pixels through responsive layout, prioritized columns, drawers, or task-specific detail views. It does not reproduce the clipped fixed-width legacy grid.
- Tables provide an accessible caption, sortable labeled headers, keyboard-operable row actions, persistent filters in the URL where useful, pagination, and a non-table narrow-screen presentation.
- Status labels are full words with an optional explained code. `P`, `N`, `Part.`, and `Not Part.` never stand alone.
- Forms use explicit Save and Cancel semantics. Navigation never autosaves undisclosed changes, and dirty forms warn before loss.
- Save produces field-level errors plus a page summary, or a durable success confirmation with the last-saved time.
- Mutations carry idempotency and version controls appropriate to their risk.
- Browser Back, copied URLs, refresh, and new tabs retain the correct group and resource context without replaying mutations.
- Help content is contextual and explains golf terms at point of use.

### 8.2 Authentication and authorization

- The portal uses Supabase Auth. There is no shared group login and no separate admin password.
- Unauthenticated routes preserve a safe return location through sign-in without exposing protected route parameters in analytics or error pages.
- Coordinator and administrator access is checked on the server for every page load and every mutation.
- A role or membership revocation terminates privileged realtime subscriptions and blocks future mutations immediately.

Screens and states: sign in with verified account e-mail and password, a show-password control, busy submission, and safe invalid-credential, rate-limit, and network states; invitation acceptance with group, inviter, invited address, proposed role, expiry, account match, accept/decline, and recovery paths; password recovery and reset with a neutral request confirmation, single-use and expired-link handling, and return to the intended destination; expired session handling that preserves unsaved local form state where safe and never replays a mutation automatically; and a role-denied state that explains the account is signed in but lacks the required role, offers home and support, and reveals no protected page data.

All authentication screens have labeled fields, sensible keyboard order, announced validation, visible focus, password-manager compatibility, and no account-enumerating copy.

### 8.3 Dashboard

The dashboard prioritizes operational exceptions over static totals: an onboarding checklist for an incomplete group; next round with state, time, format, response counts, and guest count; live round with score completion, unsynced scores, last activity, leaderboard link, and completion readiness; most recent completed round with winner summary; membership counts by state; current standings summary; and recent high-impact activity.

Three exceptions are called out as action-required because nothing else will catch them: a round still Live after its start time and awaiting completion, invitations that failed to deliver, and members with no response as an RSVP deadline approaches.

Counts link to the corresponding filtered list. Empty-state calls to action distinguish coordinator from administrator permissions; a member-only user cannot enter the dashboard and receives the role-denied handoff. Realtime round counts and score health update without a page reload and show the last server update.

### 8.4 Members list

Default columns: selection, name, membership status, role, dues paid, tee location, handicap with source date, current quota, use-initial-quota state, date added, last round, invitation state, row actions.

Filters and actions: search by name and permitted e-mail or Handicap ID; alphabet, status, role, dues, and last-round date filters; sorting on supported columns; and Add member, Invite member, Import CSV, Mass update, Activate/Deactivate, and role assignment where permitted. There is no separate handicap-import action: handicap is a column in the member CSV import.

- No active members, no members at all, and no filter matches are distinct states.
- Bulk actions display selection count, eligibility exclusions, and a confirmation summary.
- Selection across pages states whether it includes only visible rows, all matched rows, or explicit records.
- Contact information is independently permission-checked and audited.
- Deactivation shows historical dependencies. Permanent destructive deletion is not available through normal UI.
- The legacy `Dues Paid` value stays a separate club-maintained field and is never presented as payment or subscription status.

### 8.5 Member create and edit

One progressive form, not the legacy six-step wizard. Sections may collapse, but their state and validation persist.

| Field                                             | Behavior                                                                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First name, last name                             | Required for a permanent member                                                                                                                                |
| Invited e-mail                                    | Required to invite; normalized and not already in use in the group. It is the address the invitation is sent to, and becomes read-only once an account accepts |
| Account e-mail                                    | Read-only; owned by the member and changed only through their verified Account flow. All notifications go here after acceptance                                |
| Secondary e-mail                                  | Optional directory contact metadata; never used for sign-in or notifications                                                                                   |
| Spouse first/last name                            | Optional legacy parity fields                                                                                                                                  |
| Invitation state                                  | Read-only status plus create, regenerate, and revoke-link actions                                                                                              |
| Home, work, mobile phone                          | Optional; normalized where possible without losing the original display form                                                                                   |
| Address, city, state/region, postal code, country | Optional                                                                                                                                                       |
| Contact-field visibility                          | Individual control for each e-mail and phone field; defaults private                                                                                           |
| Address listing permission                        | One explicit permission for directory display of the postal address; defaults private                                                                          |
| Handicap ID                                       | Optional external identifier; no provider behavior implied                                                                                                     |
| Handicap                                          | Numeric under Section 11.6 range and precision; source and as-of date stored                                                                                   |
| Tee location                                      | Pro, Back, Middle, or Front                                                                                                                                    |
| Status                                            | Pending, Active, or Inactive                                                                                                                                   |
| Role                                              | Member, Coordinator, Administrator; administrator changes require confirmation                                                                                 |
| Initial quota                                     | Numeric under group precision policy                                                                                                                           |
| Use initial quota                                 | Explicit bootstrap freeze control with contextual explanation                                                                                                  |
| Dues paid                                         | Club-maintained boolean                                                                                                                                        |
| Date added, last round                            | Read-only system values                                                                                                                                        |

Initial history accepts up to 20 prior point totals in entry order, validates each value independently, labels seed history as not representing full historical rounds, and shows the projected quota effect before save when the current quota method can calculate it. Insufficient-history behavior follows Section 11 and is previewed before save.

- Saving member data and creating an invitation are separate confirmable actions unless the submission summary explicitly combines them.
- A role elevation, status deactivation, quota override, or pending-invitation address correction requires reason and confirmation and creates an audit event. The member form never edits the account sign-in e-mail.
- The portal displays current values, provenance, and effective time for handicap and quota.
- Changing a member's current golf data never rewrites an existing participant snapshot.
- A coordinator cannot grant Administrator or edit administrator-only settings.

The detail page also provides read views: overview with membership state, role, and dues; quota current value with provenance, overrides, seed history, and quota history; handicap current value with source and as-of time; round history using historical snapshots; invitation and notification-delivery history; and member-scoped activity within the actor's permission. Sensitive sections are server-authorized: a coordinator sees the operational subset, and administrator-only detail stays excluded.

### 8.6 Import and bulk changes

CSV import is a single-pass tool for initial onboarding, not a general data pipeline: download a template, upload the file, and the portal validates every row and shows the errors. Nothing is written until the coordinator confirms, and the apply is all-or-nothing and idempotent, so a retry of the same file cannot create duplicates. Rows matching an existing member by normalized e-mail are reported as skipped rather than silently updated.

Bulk update: only fields approved for bulk modification appear; the portal previews old and new values and the affected record count; a partial failure identifies each unsuccessful record and preserves the successful audit trail; and role and e-mail identity changes are never bundled into a generic bulk update.

### 8.7 Rounds list

Columns: date and time, description, state, format, Playing count, Not Playing count, no-response count, guest count, scoring completion state, result publication time, row actions.

Filters and actions: state (Draft, Published, Live, Completed, Cancelled); date range, format, text search, and action-required; and Create round, Duplicate as draft, Edit, Open operations, Open leaderboard, Cancel.

- The empty state offers Create first round to authorized users.
- Rounds are never hard-deleted. Old rounds leave the default view through date filtering rather than a separate archived state.
- Duplicating a round copies configuration only, never RSVP, guests, scores, or result state.
- State actions are explicit, and unavailable transitions state the reason.

### 8.8 Create and edit round

The flow allows Save draft at any step and consists of General, Format and rules, Participants, and Review.

| Field                    | Requirement                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Description              | Required                                                                                  |
| Date                     | Required                                                                                  |
| Start time               | Required                                                                                  |
| Group time zone          | Required IANA zone inherited from the group, displayed and snapshotted; no round override |
| Venue/course             | Optional free text; no course catalog                                                     |
| Round URL                | Optional valid HTTPS URL                                                                  |
| Notes                    | Optional, maximum 500 characters                                                          |
| Notes visible to players | Boolean, defaults true when notes are present                                             |
| RSVP deadline            | Optional and before round start                                                           |
| Scoring state            | Opened manually by an authorized coordinator                                              |

Format exposes exactly two options: Individual Net (best plus/minus) and Individual Gross (most points). Controls for teams, skins, `Require Entry`, best ball, scramble, other non-points formats, and hole-by-hole scoring are absent from v1 UI and payloads.

Participants: show eligible active members and explicit ineligibility reasons; on Publish, create No response participant records for every active member not explicitly excluded in the reviewed list; support explicit pre-publication exclusion, new-member handoff, and guest addition, with every exclusion visible in Review; preview initial quota and handicap snapshots where the format requires or they were supplied; and never silently exclude a selected member.

Review summarizes general details, format, participant counts, ineligible records, guest policy, missing configuration, and who will be notified on publish. Publish requires confirmation and is idempotent. Post-publication edits that materially change time, format, roster, or scoring show the affected records and scoring consequences, and the coordinator confirms whether to notify affected participants.

### 8.9 Round operations

This page replaces the legacy 12-column score grid with task-oriented sections while keeping a dense desktop mode for efficient keyboard entry.

The header shows date and time, description, state, format, Playing/Not Playing/no-response/guest counts, live connection and last-event state, and an action menu for edit, cancel, complete, and reopen as permitted.

Roster columns: selection, player with member/guest marker, applicable quota snapshot, supplied handicap snapshot, gross score, net score, points, merit points, server-calculated plus/minus, signup status, signup status changed at and by, score sync state, last confirmed score editor and time, the member's prior-round reference where useful, and row actions and history. Actions include Add member, Add guest, Assign player, Change RSVP, Correct score, and View participant history.

- Filters support Playing only, Not Playing, no response, missing score, unsynced, member or guest, and text and alphabet search.
- Only Playing participants expose editable score fields.
- Format-disabled fields are absent or clearly marked not applicable, never ambiguous blank inputs.
- Keyboard entry supports predictable row movement without changing values on navigation.
- Save applies only disclosed changes. Cancel restores the last confirmed server version of unsaved fields.
- Server-calculated values are visually distinct and non-editable.
- A row whose record changed since the page loaded is rejected on save with the current server value shown, so the coordinator re-enters rather than overwrites.
- The page shows unsynced mobile scores so a coordinator knows whether completion is safe.
- Completion uses the reviewed workflow, not a bare checkbox.
- Completed mode is read-only and sorted by the official rule, with a separate authorized Reopen action.
- Generated merit applied on completion and removed on reopen is distinguishable from manually entered merit in history.

### 8.10 Live leaderboard and result review

The admin live view shares the server-authoritative projection mobile uses. Coordinators can inspect calculation inputs and participant score history without accidentally changing the public leaderboard. Pre-completion review shows the proposed official rank, winners and ties, guest labels, missing fields, and warnings. Published result detail includes player, points, merit points broken into its manual and generated parts, signup status and timestamp, and the applicable quota, score, and plus/minus. Disabled or unavailable fields are omitted or marked Not applicable, never coerced to zero.

### 8.11 Quota and game settings

Only administrators may change these settings. There is one current set of settings per group. Changes are recorded in the activity log with actor, timestamp, and reason, and each published round snapshots the actual rule values it used, so history stays correct without effective-dated policy versions to administer.

Quota method is one of: moving average of a member's previous `N` eligible rounds where `N` is 4–20 and defaults to 10; average of the best 10 point totals from the last 20 eligible rounds; or previous quota adjusted by an administrator-configured mapping from prior plus/minus ranges to quota adjustment.

Other settings: quota rounding precision of 0, 1, or 2 decimal places; initial quota and use-initial-quota behavior; participation merit and the optional placement merit table described below; the rounds and Order of Merit reset date, where blank includes all history and a date excludes older rounds from current calculations without deleting data; and whether members may add guests.

- The portal explains the selected algorithm in plain language and shows sample effects.
- A change applies to rounds published after it and never silently recalculates a completed round. Correcting a completed round always goes through Reopen.
- The portal shows members with insufficient history before a quota method is selected.

Merit settings have two parts, and both are optional so a group can run on participation alone:

- **Participation merit** is a single amount from 0 through 100 added to every Playing permanent member when the round completes.
- **Placement merit** is an ordered table mapping finishing rank to merit points, for example 10 points for first, 6 for second, 4 for third. It defaults to empty, meaning no placement merit is awarded. When it is configured, completion applies it automatically from the official ranking, so a coordinator never hand-enters merit for a whole field. Ranks beyond the last configured row receive nothing. Tied players share a rank and each receives that rank's full amount; nothing is split or averaged, and the next distinct rank still follows competition numbering.

The Method C adjustment-band editor displays ordered rows with lower bound, upper bound, bound inclusivity, and adjustment value; supports add, remove, reorder, and cancel; and validates numeric policy, lower ≤ upper, no overlap, and no uncovered plus/minus range, so exactly one band matches any allowed input. Inline gap and overlap errors plus a page summary keep Save disabled until the table is valid, and a test input shows the selected band and the projected quota at the configured precision. Bands save as a set: a partially edited table is never half-applied.

Scoring opens manually. An authorized coordinator or administrator uses Open scoring, reviews the effect, confirms, and creates an audit event. The action is idempotent and unavailable outside Published state. Nothing in v1 changes a round's state automatically — the reminders in Section 12.3 notify people but never transition a round.

### 8.12 Standings

The portal shows current group standings and Order of Merit plus completed round result views. Standings show the reset date and exclude guests. Historical result views use round snapshots, not current member quota or handicap values.

### 8.13 Group profile, roles, and activity

Group profile covers group name, group time zone, optional course information, optional golf-professional information, and administrator contact details.

Roles lists administrators and coordinators with invitation and acceptance state; supports grant and revoke with confirmation, reason, and audit; prevents removal of the last active administrator until a replacement is confirmed; and shows active sessions with revoke controls where the auth stack supports them.

The audit trail is written for every consequential action, and the portal surfaces it as a reverse-chronological activity list scoped to the group, with a filter by entity so a coordinator can see one member's or one round's history. A full query interface over all actors, actions, and severities is not a v1 requirement — the rows must exist and be readable, which is what matters for investigating a disputed score.

Each record includes group, actor or system actor, action, target, timestamp, a safe before/after summary, source channel, correlation ID, and reason where required. Sensitive values, secrets, passwords, and authentication tokens never appear. Coverage includes at minimum member create, status, role, and contact changes; quota and handicap overrides and imports; round create, publish, cancel, complete, and reopen; RSVP overrides and participant changes; score and result revisions; and settings changes.

### 8.14 Web accessibility

The portal follows WCAG 2.2 Level AA as a working standard rather than a certified conformance claim, and accessibility defects are triaged like any other defect. In practice that means: all navigation, tables, forms, dialogs, menus, date pickers, and bulk actions are keyboard operable; dialogs trap focus, announce their title, close with Escape where safe, and return focus to the invoker; sort direction, validation, busy state, and completion state are programmatically available and never color-only; pages provide semantic landmarks, ordered headings, and skip-to-main-content; icon-only controls have accessible names; text stays readable and operable at 200% resize; dense score entry offers a row-detail alternative so one player's edit never requires two-dimensional scrolling; and realtime reordering announces a polite summary instead of moving the user's focus.

## 9. Member web view

The legacy product let any member read the group's board using a shared group login. V1 replaces shared credentials with personal identities, which is correct, but it would otherwise leave a golfer who declines to install an app with no way to answer an invitation or see a result. This surface closes that gap at minimal cost: three server-rendered pages on the Next.js application already being built, reusing the same authorization, projections, and business rules as everything else.

Scope is deliberately fixed at three screens:

1. **Next round** — date and time in the group time zone, venue, notes visible to players, format, the member's current response and its timestamp, the response deadline when configured, and Playing/Not Playing actions.
2. **Round results** — the official result table for a completed round, identical in content to the mobile results view.
3. **Standings** — current Order of Merit and the member's own quota and rounds played, with the reset date shown.

Rules:

- Access requires authentication as the member. E-mail links carry a one-time sign-in that establishes a normal authenticated session; they are never bearer tokens that act on the member's behalf without a session, and they never reveal group data before sign-in.
- RSVP from this surface is the same server mutation the app calls, subject to the same deadline, eligibility, and audit rules, and recorded with a source that distinguishes it from the app.
- Everything else is out of scope: no score entry, no guest management, no profile or privacy editing, no directory, no member list, no coordinator function. Where a member tries to reach one of those, the page explains that it lives in the app and offers install links.
- The pages meet the same accessibility expectations as the admin portal and are usable on a phone browser, since that is where most people will open an e-mail link.
- A coordinator or administrator who signs in here is redirected to the admin portal rather than shown a degraded view.

## 10. Lifecycles and states

### 10.1 Round lifecycle

| State     | Meaning                                                                       | Permitted next states       |
| --------- | ----------------------------------------------------------------------------- | --------------------------- |
| Draft     | Configuration can be saved without member visibility.                         | Published, Cancelled        |
| Published | Visible to the eligible audience; RSVP is open.                               | Live, Cancelled             |
| Live      | Scoring is open; authoritative score updates and live leaderboard are active. | Completed, Cancelled        |
| Completed | Official results are published; scoring locked.                               | Live through audited Reopen |
| Cancelled | Round will not be played; RSVP and scoring disabled, history retained.        | Terminal                    |

- Draft is a replacement improvement; the legacy product created an incomplete round immediately.
- The Published-to-Live transition is manual and requires an explicit authorized Open scoring action with confirmation and audit.
- A material edit to a Published round produces an impact summary.
- A Live round cannot return to Draft.
- Completed results cannot be edited directly; Reopen is mandatory.
- Cancel and Reopen require a reason and an audit record.
- No transition happens on a timer. A round left Live is flagged and its coordinators are reminded, never advanced automatically.

### 10.2 RSVP lifecycle

| State       | Meaning                                             |
| ----------- | --------------------------------------------------- |
| No response | Participant has not made a confirmed choice.        |
| Playing     | Eligible for score entry and participation effects. |
| Not Playing | Ineligible for score, points, and merit entry.      |

Every change appends an event with previous and new state, actor, server timestamp, source, and optional reason. The participant record may cache the current state, but event history is authoritative for audit.

Changing a participant from Playing to Not Playing after score data exists is one explicit atomic operation. It shows the affected score, result, and leaderboard values, requires confirmation, preserves prior score revisions as invalidated history, clears them from the current scoring projection, recalculates the live leaderboard, and reverses generated completion effects if the round was reopened. A completed round must be reopened first. Changing back to Playing does not silently restore invalidated scores; a coordinator may deliberately restore or re-enter them with audit.

### 10.3 Score synchronization lifecycle

| State        | Meaning                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Confirmed    | Value and version accepted by the server.                                                                               |
| Pending sync | Persisted locally but not yet acknowledged.                                                                             |
| Syncing      | Request in flight.                                                                                                      |
| Failed       | Server rejected the operation, including a stale-version rejection, or retry policy is exhausted; user action required. |
| Locked       | Round state or permission forbids mutation.                                                                             |

There is no Conflict state. A stale-version rejection is a Failed operation whose message names the current server value and asks the scorer to re-enter, which removes an entire class of merge interface without ever silently overwriting a score.

### 10.4 Membership lifecycle

`Pending → Active ↔ Inactive`

Invitation revoke or expiry may leave a Pending record available for audited resend. Reactivation checks required identity and profile state. Inactive members remain resolvable from historical participant records.

### 10.5 Import job lifecycle

`Uploaded → Validating → Ready or Rejected → Applying → Completed`

A file with any invalid row is rejected as a whole with its errors listed, so there is no partially valid intermediate state to administer. Retrying uses the same source fingerprint and idempotency boundary and never duplicates successfully applied records.

## 11. Scoring, quota, and standings rules

### 11.1 Authoritative calculations

All official calculations run on the server against a specific set of inputs and the rule values the round snapshotted at publication. The output records those snapshotted rule values, the input score revision identifiers, calculation timestamp, result values, warnings or manual overrides, and the actor or system correlation identifier. Clients may display previews but must label them Pending until confirmed.

### 11.2 Plus/minus

`plus_minus = round_points − round_quota_snapshot`

When quota applies, the result uses the participant's round quota snapshot, not the current membership quota. Display formatting preserves the configured quota precision and shows an explicit plus sign for positive values where the design does so consistently.

### 11.3 Score-field authority

V1 uses a least-privilege scoring model with no designated-scorer or team-scoring role. Every mutation is server-authorized, and the server checks both role and field authority. A client showing an input does not grant permission.

- A member may set their own RSVP and enter their own Playing participant's enabled score fields and points.
- A sponsoring member may enter their guest's enabled score fields; the guest has no self-scoring route.
- Coordinators and administrators may enter or correct any Playing participant's enabled score fields, change any RSVP, author manual merit points, and make pre-score quota or handicap snapshot corrections with a reason.
- Members never author manual merit points, quota snapshots, or handicap snapshots.
- Current membership quota and rule changes are administrator-only.
- Calculated values — plus/minus, rank, winner, and generated merit — are never directly editable by anyone. They change only through new inputs, new rules, or Reopen.
- Completion and Reopen are coordinator and administrator actions. Everything above is locked in the Completed state; operational correction requires Reopen.
- Correcting an already confirmed value requires a reason and an audit event. Readiness blockers cannot be bypassed, and official results are never directly edited. No dual approval is required.

### 11.4 Individual formats

- **Individual Net** ranks descending by plus/minus. Highest plus/minus wins.
- **Individual Gross** ranks descending by golf points, independent of quota. Highest points wins.
- Equal official ranking values are tied co-winners sharing the same competition rank (`1, 1, 3`). Alphabetic display order may stabilize the UI but is never presented as a sporting tie-break.
- Gross score and net score are retained inputs and outputs, but their relationship to game points is not confirmed. They are never auto-derived without an approved formula.

The Draft round rule snapshot fixes the enabled final-total fields. Golf points are the only completion-required authored score in both formats. Enabled gross and net fields stay optional and may be blank; disabled fields are absent from entry, validation, APIs, and official projections rather than shown as misleading blanks.

| Format and field                | V1 contract                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Individual Net — golf points    | Always enabled; required to complete; entered directly                                                            |
| Individual Net — quota          | Required read-only participant snapshot                                                                           |
| Individual Net — plus/minus     | Required server-derived output from points minus quota                                                            |
| Individual Net — gross score    | Optional Draft toggle; direct final-total entry; no derivation                                                    |
| Individual Net — net score      | Optional Draft toggle; direct final-total entry; no derivation                                                    |
| Individual Gross — golf points  | Always enabled; required to complete and used for ranking; entered directly                                       |
| Individual Gross — quota        | Optional informational snapshot; never used for Gross ranking                                                     |
| Individual Gross — plus/minus   | Derived and displayed only when a quota snapshot exists; otherwise not applicable                                 |
| Individual Gross — gross score  | Optional Draft toggle; direct final-total entry; no derivation                                                    |
| Individual Gross — net score    | Not available                                                                                                     |
| Either format — manual merit    | Optional coordinator-authored component; blank means zero                                                         |
| Either format — generated merit | Server-derived on completion for eligible permanent members from the participation amount and the placement table |

### 11.5 Quota calculation

A member's quota input history is the ordered list of their eligible point totals: seed totals supplied at setup, oldest first, followed by official results ordered by round completion time. An eligible quota round is an official completed result for a Playing permanent member with valid golf points. Guests, Not Playing and no-response participants, cancelled rounds, and reopened rounds are excluded.

Methods A and B are pure functions of that history, so there is no replay machinery to build or reason about: whenever a round completes or reopens, the server recomputes each affected member's current quota from their history and stores the result with the rounds it drew on. Recomputation never rewrites a participant or result snapshot, so a completed round's own quota stays exactly as it was played.

**Method A — moving average.** Take the most recent `N` totals from the history, where `N` is 4 through 20 and defaults to 10. Compute the arithmetic mean without intermediate display rounding, round the final quota to the group precision, and store it with its source rounds. With one through `N−1` totals, use all available totals unless `Use Initial Quota` is still active. With zero, use the configured initial quota; if none exists, the member is not ready for Individual Net publication.

**Method B — best 10 of last 20.** Take the 20 most recent totals, keep the 10 highest, compute their arithmetic mean without intermediate rounding, apply the precision policy, and store it with its source rounds. With one through nine totals, average all available unless `Use Initial Quota` is still active. With 10 to 19, average the best 10 of all available. With zero, use the configured initial quota; if none exists, the member is not ready for Individual Net publication.

**Method C — previous plus/minus adjustment.** This is the one path-dependent method: each quota depends on the one before it. Read the participant's prior quota, read the official plus/minus from the completed round, find the single configured adjustment band containing that plus/minus, compute `new quota = prior quota + adjustment`, apply the precision policy, and store the source result and the band that matched. A member with no prior quota requires an initial quota, which serves as the snapshot for their first eligible round; completion then applies the matching band to produce the next quota. Because the chain is ordered, a reopen under Method C recomputes that member's quota chain forward from the affected round, in completion order, and a recompletion appends to the end of the chain rather than reclaiming its old position. Concurrent completions affecting one membership serialize, and a retried completion is idempotent.

### 11.6 Initial quota, snapshots, precision

- A new member may have an initial quota.
- `Use Initial Quota` is a bootstrap freeze, not a permanent override. It stays active until Method A has `N` totals, Method B has 10 totals, or Method C has one eligible completed round, then deactivates automatically with an audit event.
- Individual Net publication requires an initial quota when the member has no eligible or seed history. Supplying an initial quota defaults `Use Initial Quota` to true.
- An administrator may disable the bootstrap early only with an impact preview, reason, and audit. It cannot be re-enabled after an eligible official result exists; later changes use the normal quota-override path.
- Up to 20 ordered seed point totals may inform initial calculation without creating fake historical rounds. Seeds are calculation-only inputs and never count as rounds played, results, participation, or standings.
- When a participant is created at publication, the system records a quota snapshot and its source where Individual Net requires it or an optional Individual Gross quota was supplied.
- An authorized pre-score quota override requires a reason and produces a new participant snapshot revision. Once a result is official, quota correction requires Reopen and the recalculation described in Section 11.5.

Precision rules: group quota precision is 0, 1, or 2 decimal places; the database retains sufficient exact numeric precision, and floating-point binary arithmetic never determines official output; exact half values round half away from zero, implemented and unit-tested in server code; display formatting never changes stored official values.

| Value                          | Allowed range and scale                                   |
| ------------------------------ | --------------------------------------------------------- |
| Quota and quota snapshot       | 0–100 inclusive; group-selected 0, 1, or 2 decimal places |
| Handicap and handicap snapshot | −10.0–54.0 inclusive; at most 1 decimal place             |
| Gross/net score                | 0–300 inclusive; whole numbers                            |
| Golf points                    | 0–100 inclusive; at most 2 decimal places                 |
| Manual merit                   | −1,000–1,000 inclusive; at most 2 decimal places          |
| Generated merit per round      | 0–1,000 inclusive; at most 2 decimal places               |
| Participation merit setting    | 0–100 inclusive; at most 2 decimal places                 |
| Placement merit per rank       | 0–500 inclusive; at most 2 decimal places                 |
| Method C quota adjustment      | −20–20 inclusive; at most 2 decimal places                |

Plus/minus is derived, may be negative or positive, and takes the greater configured scale of points and quota.

### 11.7 Merit points and standings

Merit points are the Order of Merit currency and are unrelated to golf points and plus/minus. The legacy product recorded them but left the awarding rule to each group, which in practice meant somebody typed a number into every row. V1 resolves that with two configured, automatic components plus a manual escape hatch, so a group can run a season without hand-entering merit while still being able to correct anything.

A round's merit for a permanent member is `participation + placement + manual`:

- **Participation** is the configured amount, added to every Playing permanent member on completion. Zero is a valid configuration.
- **Placement** comes from the group's rank-to-points table applied to the round's official ranking. An empty table awards nothing, which is the default and reproduces the legacy participation-only behavior. Ranks past the last configured row award nothing.
- **Manual** is a coordinator-authored value for anything the rules do not cover, such as a side competition or a correction. It may be negative.

Rules:

- Ranking for placement is the format's official ranking: plus/minus for Individual Net, points for Individual Gross.
- Tied players share a competition rank and each receives that rank's full placement amount. Nothing is split, averaged, or broken by alphabetical order. The next distinct rank continues competition numbering, so a tie for first is followed by rank three.
- Guests are ranked and shown in round results but never receive merit of any kind and never enter standings.
- Participation and placement are generated components computed only on completion. Reopen removes both; recompletion recomputes them from the corrected result. Manual merit survives a reopen, because a human authored it deliberately.
- The stored round total is the sum of confirmed components, and results and member history show the breakdown rather than one opaque number, so a member can see why they received what they did.
- Equal merit totals share the same Order of Merit rank using competition ranking.
- The standings reset date affects current Rounds Played and Order of Merit totals for rounds on or after that date. A blank reset date includes all eligible history. Changing the reset date deletes nothing and does not limit quota eligibility or quota history.

### 11.8 Completion readiness

Completion is blocked when a Playing participant is missing the primary ranking input the format requires, an unsynced mobile score is still outstanding, a configured calculation has no deterministic result, or the round has no rule snapshot. Optional blank values and non-blocking anomalies appear as warnings. Any approved override must be explicit, reasoned, and auditable.

## 12. Notifications and reminders

The legacy product's whole communication model was the coordinator sending bulk e-mail and SMS by hand, and that is how members learned a round existed. A replacement without any outbound message would be worse than what it replaces: rounds would be published to silence. V1 therefore includes push and e-mail, but only as fixed transactional messages generated by business events. There is no composer, no template editor, no audience builder, and no campaign scheduling.

### 12.1 Events and categories

| Event                             | Trigger                                         | Audience                        | Channels          | Optional |
| --------------------------------- | ----------------------------------------------- | ------------------------------- | ----------------- | -------- |
| Membership invitation             | Invitation created or resent                    | The invitee                     | E-mail            | No       |
| Round published                   | Publish confirmed                               | Invited participants            | Push, e-mail      | Yes      |
| RSVP reminder                     | Scheduled, before the deadline or start         | Participants with no response   | Push, e-mail      | Yes      |
| Round details changed             | Material edit the coordinator chose to announce | Participants                    | Push, e-mail      | Yes      |
| Round cancelled                   | Cancel confirmed                                | Participants                    | Push, e-mail      | No       |
| Scoring opened                    | Published to Live                               | Playing participants            | Push              | Yes      |
| Results published                 | Completion, including recompletion after reopen | Participants                    | Push, e-mail      | Yes      |
| Round awaiting completion         | Scheduled, round still Live after its start     | Coordinators and administrators | Push, e-mail      | No       |
| Invitation could not be delivered | Provider reports a hard bounce                  | Coordinators and administrators | E-mail, dashboard | No       |
| Role granted or revoked           | Role change                                     | The affected member             | E-mail            | No       |

Optional categories can be switched off, or restricted to one channel, in the member's notification preferences. Mandatory categories cannot: a member who does not learn a round was cancelled will drive to the course, a member unaware of a role change cannot reason about their own permissions, and a coordinator who never learns an invitation bounced will assume the invitee is ignoring them.

Supabase Auth verification and password-recovery e-mail sit outside this table. They belong to authentication, are never optional, and are never used to carry product content.

### 12.2 Delivery rules

- A notification is queued in the same transaction that commits its business event, and sent by a separate idempotent job. A committed round publication can therefore never lose its notification, and a retried job can never double-send.
- Every send is keyed by event, recipient, and channel, so repeated Publish actions, retries, and job restarts converge on exactly one delivery per recipient per channel.
- Payloads carry only what the recipient is already authorized to see and never include protected contact data, scores belonging to others, or tokens. Push payloads carry an identifier and a short human summary; the app fetches the real data on open.
- Every message deep-links to the exact resource, opening the app when installed and the member web view otherwise.
- Push respects quiet hours from 21:00 to 07:00 in the group time zone: an optional notification generated in that window is held until morning. Cancellations and operational reminders are exempt, because their value is time-critical.
- E-mail records provider identifiers and delivery outcome. A hard bounce or spam complaint suppresses further optional e-mail to that address, is visible on the member record, and surfaces on the dashboard, since an undeliverable invitation is indistinguishable from an ignored one otherwise.
- Delivery state is stored and readable per recipient. Failed sends are retried with backoff, then abandoned and reported rather than retried forever.
- Inactive memberships, revoked roles, and deleted accounts are excluded at send time, not merely at queue time.
- Guests are never notified. They have no address on file and no product access.
- A notification is never a mutation path. Nothing changes state because a message was sent, opened, or ignored.

### 12.3 Scheduled reminders

One scheduled job runs on a fixed interval and evaluates three conditions per group in the group's own time zone. Reminders notify and flag; they never transition a round, close RSVP, or write scores.

| Condition                                                                                                                           | Action                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A Published round has an approaching RSVP deadline, or starts soon with no deadline configured, and participants have not responded | Remind those participants once                                                                                      |
| A round is still Live after its start time and has not been completed                                                               | Notify coordinators and administrators, and flag the round as action-required on the dashboard and coordinator Home |
| A round has been Live well past its start with required scores still missing                                                        | Include the missing-score count in the same coordinator reminder rather than sending a second message               |

Reminders are sent at most once per condition per round, so a round nobody completes produces one nudge rather than a daily nag, while the dashboard flag persists until the round is completed or cancelled. This closes the failure the legacy product had no answer for: an uncompleted round silently freezes every participant's quota.

### 12.4 Channels

Push uses Expo Notifications. A device registers its token against the authenticated user, and tokens are stored per device so one person's phone and tablet both work. A token is retired on sign-out, when the provider reports it invalid, and when membership is revoked. Permission is requested in context and declining is a supported state: e-mail continues to carry every event, and no feature is gated behind push.

E-mail uses Resend from a verified sending domain with SPF, DKIM, and DMARC configured, since these messages must reach inboxes to be worth building. Optional-category e-mail includes a one-click path to notification preferences. Templates are plain, accessible, readable without images, and always include a plain-text alternative. Provider credentials live in server configuration only.

SMS remains excluded, as Section 1.1 states. Carrier e-mail-to-SMS gateways must never be used as a substitute.

## 13. Logical data model

This is a logical contract, not a final SQL schema. Physical design must preserve these entities, relationships, group isolation, versioning, and invariants.

### 13.1 Identity and tenant

| Entity                 | Required concepts                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User profile           | Supabase auth identifier, display and personal names, globally unique verified account e-mail reference, accepted Terms/Privacy versions with server timestamps, account state, timestamps                                        |
| Group                  | Identifier, name, time zone, optional course/pro/contact details, onboarding state, timestamps                                                                                                                                    |
| Membership             | Group, user, role, status, dates, dues-paid, current quota reference, current handicap reference, initial quota value, use-initial-quota state and provenance, invitation reference; at most one active membership per user in v1 |
| Member golfer profile  | Membership, spouse names, tee preference, other golfer settings                                                                                                                                                                   |
| Member contact/privacy | Membership, secondary e-mail, phones, address, per-field contact visibility, address-listing permission                                                                                                                           |
| Invitation             | Group, membership or invited e-mail, role, token digest, expiry, status, inviter                                                                                                                                                  |

### 13.2 Golf configuration

| Entity                | Required concepts                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Handicap record       | Membership, value, Handicap ID, source (`manual` or `import`), as-of time                                                                                    |
| Group settings        | Group, quota method, history length, precision, rounding rule, participation merit amount, standings reset date, guest permission, updated-by and updated-at |
| Adjustment band       | Group, lower and upper bounds with inclusivity, adjustment; a complete non-overlapping set                                                                   |
| Placement merit row   | Group, rank, merit points; ordered and unique by rank                                                                                                        |
| Quota record          | Membership, value, source type, source rounds or seed data, the rule values used, effective time, override actor and reason                                  |
| Initial history entry | Membership, ordered point value, source metadata                                                                                                             |

### 13.3 Rounds

| Entity              | Required concepts                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Round               | Group, start instant with inherited group time zone, description, free-text venue and URL, public and private notes, RSVP deadline, state, published and completed times, current result reference |
| Round rule snapshot | Round, the actual quota, merit, and precision values in force at publication, selected format, enabled final-total fields                                                                          |
| Participant         | Round, optional membership, guest flag and profile, current RSVP state, format-required quota and optional handicap snapshots with source, optional tee snapshot, eligibility state                |
| RSVP event          | Participant, previous and new state, actor, source, server time, reason                                                                                                                            |
| Score revision      | Participant, input fields, record version, author, source, device operation ID, server time, supersession state                                                                                    |
| Score component     | Gross score, net score, points, manual merit, generated participation merit, generated placement merit                                                                                             |
| Result              | Round, rule values used, score revisions, ranks, ties and winners, generated effects, status, publication time; superseded on recompletion and retained for audit                                  |
| Participant result  | Result, participant, official inputs and outputs, rank, tie and winner flags                                                                                                                       |

### 13.4 Operations

| Entity                  | Required concepts                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit event             | Group, actor or system, action, target, safe revision references, source, correlation ID, reason, timestamp                                             |
| Outbox job              | Event type, aggregate reference and version, idempotency key, state, attempts, next attempt, safe error                                                 |
| Import job              | Group, CSV source fingerprint, state, counts, row results, actor, timestamps                                                                            |
| Notification preference | Membership, category, enabled channels                                                                                                                  |
| Push device             | User, Expo push token, platform, last-seen time, active state                                                                                           |
| Notification delivery   | Event reference, recipient, channel, provider message identifier, state, attempts, failure reason, timestamps; unique per event, recipient, and channel |
| E-mail suppression      | Normalized address, reason (`bounce` or `complaint`), first and last occurrence                                                                         |

### 13.5 Data rules

- Use immutable identifiers; names and e-mails are not record keys.
- Use exact numeric database types for quota, points, handicap, merit, and adjustments.
- Store timestamps in UTC and snapshot the group's applicable IANA time-zone identifier on each round.
- Normalize e-mail for matching while retaining the user-facing value where needed.
- Enforce the e-mail model in Section 4.1: account e-mail is globally unique, an invited address cannot duplicate an existing member in the group, and one user holds at most one active membership.
- Deactivate rather than delete tenant records with history; never cascade-delete results when a profile is removed.
- Keep manual and generated score and merit components separate, and keep participation and placement distinguishable within the generated part.
- Use unique constraints for client operation IDs and other idempotency keys.
- Tenant joins must validate matching group ownership.

## 14. Realtime and offline

Authorized clients subscribe only to the minimum projection for round state, RSVP counts and the current user's response, participant score and result updates, and the live leaderboard.

- A successful mutation response is the first confirmation to its author. Realtime is fan-out, not the only acknowledgement.
- Every realtime record carries an aggregate and version identifier so clients can ignore duplicates and detect gaps.
- After reconnect or a detected gap, the client refetches the authoritative snapshot before applying later events.
- RLS and server authorization ensure a subscription cannot observe another group.
- Clients do not trust event arrival order across independent aggregates.
- Presence and typing indicators are not required.
- Realtime failure degrades to refresh and poll recovery with visible stale state, never data loss.

Mobile offline queue:

- Only score changes for an already cached authorized live round may queue offline.
- RSVP made offline stays a Not sent local draft and is never auto-submitted.
- Guest creation and administrative actions are online-only.
- Queue items include user, group, aggregate, base version, operation ID, payload, and creation time.
- The queue is protected using platform capabilities and purged on account or access revocation.
- Retry uses bounded backoff and distinguishes retryable network and service errors from validation, permission, stale-version, and locked-round failures, which need the user.

## 15. Service behavior and errors

Every protected mutation:

1. authenticates the person or verified system actor;
2. resolves the group and role from the authenticated membership rather than from client input;
3. authorizes the exact action and target;
4. validates input and current aggregate state;
5. checks expected version and idempotency where required;
6. runs business rules in Next.js server code against PostgreSQL source data;
7. commits the state change, audit record, and outbox/realtime-visible state consistently;
8. returns confirmed state and version plus any explicit side effects or warnings.

Exact route names and JSON fields belong in an implementation API contract derived from this specification and must not be inferred from the legacy ASP.NET requests.

Clients must be able to distinguish and present: authentication required or session expired; forbidden or role changed; resource unavailable; field and business validation failure; stale-version rejection; round or state locked; rate limited; transient network or service failure; and unexpected server error with a support correlation identifier. Errors use safe user-facing copy, retain field associations, and never leak cross-group resource existence, secrets, stack traces, SQL, or provider payloads.

Reads and projections: member, mobile, and member web reads return privacy- and role-filtered projections, not raw tenant rows. Live leaderboard, official results, standings, and dashboard counts derive from authoritative stored state and identified versions. Pagination uses stable ordering, and large datasets are never loaded wholesale into a client. Cache keys include tenant, authorization-sensitive scope, and data version so a role change or deactivation leaves no protected cached content accessible.

## 16. Security and privacy

### 16.1 Tenant isolation

- Every tenant-owned table and query is scoped to a group.
- Supabase RLS policies are deny-by-default and tested for member, coordinator, administrator, unauthenticated, revoked, and cross-group cases.
- Next.js server authorization validates membership and role independently of client navigation.
- Storage object paths and access policies are tenant-scoped; private assets use signed or authorized access.
- Realtime subscriptions enforce the same access model as reads.
- Automated tests attempt cross-group reads, mutations, subscriptions, and guessed identifiers.

### 16.2 Authentication and sessions

- Use Supabase Auth password, invitation, and recovery capabilities.
- Passwords require at least 12 characters. Passphrases are allowed; custom composition rules and forced rotation are prohibited. Enable provider breach-password protection where supported.
- Access tokens are short-lived and refresh tokens rotate. Membership or role revocation blocks the next request and refresh immediately.
- The last active administrator cannot leave, be deactivated, or be demoted. Transfer requires an accepted replacement administrator, explicit confirmation, and one atomic audit event.
- Role changes and account recovery generate audit events.
- Session and reset tokens never appear in logs or analytics.
- App-link and e-mail sign-in links are single-purpose, single-use, time-bounded, and safe against replay. A link establishes a session; it never authorizes an action on its own.

### 16.3 Application security

- Validate all input server-side and encode output by context.
- Protect web mutations from CSRF according to the chosen Next.js authentication pattern.
- Rate-limit sign-in, recovery, invitation, e-mail sign-in link requests, and sensitive mutations.
- Validate outbound URLs and prevent server-side request forgery and unsafe schemes.
- Use restrictive CORS and security headers.
- Keep dependencies current and scan them in CI.
- Never log passwords, tokens, push tokens, or unnecessary personal data.

### 16.4 Privacy

- Collect only the data approved product behavior requires. V1 stores no guest contact data at all.
- Directory visibility defaults to private for contact and address fields, enforced in server projections.
- Notification addresses and push tokens are used only for the events in Section 12.1. They are never sold, shared, or used for marketing, and Apple and Google privacy declarations must reflect exactly that.
- Profile → Privacy lets an authenticated user request data access or account deletion. Submission requires recent authentication and routes to the named privacy owner, who handles it through the support process; v1 does not build a request-tracking workflow inside the product. Requests target a 30-day response.
- Active account and profile data is retained while the account or membership is active. After an approved deletion request, direct identifiers are removed or anonymized within 30 days unless a documented legal hold applies.
- Official sporting results and quota history are retained indefinitely in pseudonymized form so group history stays valid. Audit records are retained long-term. Expired invitations are removed after 30 days and notification delivery records after 90.
- English is the initial product language. Dates, numbers, and time zones use locale-aware display.
- Application data is hosted in the selected Supabase US region.
- Legal and privacy owner approval of the Terms and Privacy Policy is a production release prerequisite, not an implementation decision.

### 16.5 Audit integrity

- Application users cannot edit or delete audit events.
- Audit before/after data is sufficient for investigation without copying unnecessary secrets or personal data.
- Correlation identifiers connect a user action, the database change, and the resulting server work.
- Server time is the clock source; client time is supplemental metadata only.

## 17. Non-functional requirements

### 17.1 Performance

- Normal authenticated reads and mutations should complete within 500 ms at p95.
- A confirmed score mutation should acknowledge within one second at p95.
- A confirmed leaderboard change should reach other connected clients within two seconds at p95.
- Primary screens should show useful cached or skeleton content within 2.5 seconds on a representative device and network.
- Search and filter actions on ordinary group-size lists should respond within one second.
- CSV imports run asynchronously from the browser request and expose progress and state.

Design for roughly 100 active groups, up to 500 members per group, about 20 rounds per group per month, and a few dozen simultaneous live rounds. Growth beyond that triggers measurement and a scaling review, not speculative introduction of Redis, a broker, or microservices.

### 17.2 Availability and resilience

- Score and RSVP writes use transactional consistency.
- Retried mutations, imports, and completions are idempotent.
- The system recovers from realtime disconnect through an authoritative snapshot refresh.
- Mobile pending score operations survive process termination and device restart.
- A notification provider outage delays messages but never blocks the business action that generated them, and queued sends resume when the provider recovers.
- The scheduled reminder job is safe to run late, twice, or after downtime: it derives what to send from current state and its once-per-condition record, so a missed run catches up without duplicating.
- Supabase managed backups are enabled with point-in-time recovery, and the restore procedure is tested before production launch.
- Every production deployment has a documented and tested rollback or safe roll-forward procedure, including database compatibility handling.

### 17.3 Time, locale, and numbers

- Store instants in UTC alongside the applicable IANA time zone.
- Display round times in the snapshotted group time zone and clarify it when the device time zone differs.
- Date-only policies such as the reset date have an explicit group-time-zone boundary.
- User-facing strings are centralized for future localization.
- Locale-aware display never changes server calculation or storage.
- Exact numeric arithmetic and rounding are shared through server rule code and contract tests.

### 17.4 Compatibility

Mobile supports the Expo-approved iOS and Android versions recorded for each release. The admin portal and member web view support current stable Safari, Chrome, Edge, and Firefox on desktop and mobile.

### 17.5 Observability

Capture privacy-safe request and error rate and latency by operation category, authentication and invitation failures, authorization denial anomalies, realtime connection and leaderboard freshness, mobile queue depth and permanent failures, completion and reopen failures, CSV import job state, and database and storage capacity and backup health. Alerts route to an approved operational owner. User-facing failures expose a correlation identifier support can find without accessing prohibited data.

Notification delivery is monitored specifically, because a silent failure here looks like member apathy rather than a defect: track outbox depth and age, send failures and retries by channel, e-mail bounce and complaint rates against the sending domain's reputation, invalid push token rates, and whether the scheduled reminder job ran. Alert when the outbox stops draining or bounce rates rise.

## 18. Testing and acceptance

### 18.1 Automated testing

**Unit tests** cover plus/minus, net and gross ranking and ties; all three quota methods with eligible-round filtering, partial and zero history, bootstrap deactivation, precision, numeric boundaries, and half-away-from-zero rounding; the Method C chain including recomputation after a reopen; adjustment band validation; participation and placement merit apply and reverse, including ties receiving equal placement points and competition rank numbering; the standings reset-date boundary; notification eligibility, deduplication, and quiet-hours deferral; role and state transition policies; guest exclusion from quota, merit, and standings; and idempotency and operation ordering.

**Integration tests** cover Supabase Auth identity and membership flows; session expiry and revocation; last-administrator transfer; RLS across every role and cross-group attack case; Next.js mutations with transaction, audit, and outbox behavior; notification queueing, provider failure and retry, bounce suppression, and push token retirement; the scheduled reminder job including a missed run and a duplicate run; Realtime authorization and reconnect recovery; storage upload, access, and removal; CSV import validate, apply, and retry; and runtime configuration and application identifier validation.

**End-to-end tests** run the same behavioral suite on iOS and Android for sign in, RSVP, guest, score, offline and reconnect and stale-version rejection, leaderboard, results, and profile. The web suite covers onboarding, members, the round lifecycle, live operations, rules, activity, and the three member web view screens including RSVP from a browser. Suites assert that advanced-format, hole-by-hole, message-composer, and SMS routes and controls do not exist, and that the member web view exposes no scoring or administrative route. Accessibility testing combines automation with keyboard, VoiceOver, TalkBack, zoom, contrast, dynamic type, and reduced-motion verification. At least one real-device poor-connectivity test covers queued scoring plus a server-side rejection.

### 18.2 Acceptance scenarios

1. **Group and administrator creation** — person-specific admin access, group isolation, and an onboarding checklist, with no shared password anywhere.
2. **Inviting existing and new users** — the membership attaches to exactly one identity, an invitee who signs in with a different address still resolves correctly, a second membership for the same identity is refused, and invitation and acceptance states are visible.
3. **Member seed history and quota configuration** — up to 20 seed totals validate, each quota method produces the exact approved example values at the configured precision, and settings apply prospectively.
4. **Round publication** — the draft stays private, and publishing snapshots rules and participants, opens RSVP, and notifies each participant exactly once even when Publish is repeated.
5. **RSVP from iOS and Android** — identical result, timestamp, audit entry, and realtime admin counts. An offline RSVP stays a labeled draft, never appears confirmed, revalidates on reconnect, and explains deadline or eligibility rejection.
6. **Guest participation** — the guest is created atomically as Playing with an RSVP event, is round-scoped, can be withdrawn only through the sponsor or coordinator workflow, has no self-RSVP or self-scoring route, appears in round results, and is absent from membership and standings totals.
7. **Online score entry** — the server calculates plus/minus, audits the revision, and updates mobile and admin within the latency target.
8. **Offline score entry** — pending state survives app restart, syncs exactly once, and never appears official before server confirmation.
9. **Concurrent score edits** — a stale edit is rejected rather than silently overwriting, the scorer sees the current server value, and re-entry is audited.
10. **Completion** — missing required inputs and unsynced scores block completion; a valid completion locks scoring, applies participation and placement merit, publishes the official result, notifies participants, and updates history, standings, and quota.
11. **Reopen and recompletion** — a reason and audit entry are required, generated merit reverses while manual merit survives, Official state withdraws everywhere, affected quota values recompute, and recompletion republishes and re-notifies.
12. **Playing changed to Not Playing after scoring** — explicit confirmation invalidates the current score projection, preserves revisions, updates the leaderboard, and prevents silent restoration.
13. **Results viewing** — Individual Net sorts by plus/minus and Gross by points, ties are explicit, historical snapshots stay stable, merit shows its participation, placement, and manual parts, and a Gross result without a quota omits or marks quota and plus/minus Not applicable rather than showing zero.
14. **Score-field authority** — member, sponsor, coordinator, and administrator attempts are accepted or rejected per Section 11.3, and every role is rejected when mutating a disabled field, with no UI-based privilege leakage.
15. **Manual scoring transition** — Published to Live opens exactly once through an authorized confirmed action with an audit event, and nothing transitions a round automatically.
16. **Forgotten round** — a round left Live past its start is flagged as action-required on the dashboard and produces exactly one coordinator reminder, and no round state changes as a result.
17. **Notification delivery and preferences** — each event reaches its audience once per enabled channel, disabling an optional category stops it, mandatory categories cannot be disabled, a declined push permission still yields e-mail, a bounced address is suppressed and surfaced, and quiet hours defer optional push without deferring a cancellation.
18. **Member without the app** — an e-mail link signs the member in to the member web view, where they can RSVP and read results and standings, and no scoring or administrative route is reachable.
19. **Account e-mail** — a verified account e-mail change moves sign-in and notification delivery together without creating a second identity, and invitation matching and uniqueness behave as specified.
20. **Tenant isolation** — attempts to read, mutate, or subscribe to another group fail without leaking existence, and a deep link to another group's round resolves to permission denied.
21. **V1 scope boundary** — only Individual Net and Gross final-total workflows exist; advanced formats, hole-by-hole entry, free-text messaging, billing, SMS, and group-switching endpoints and controls are absent.
22. **Accessibility** — core mobile, admin, and member web flows pass the approved keyboard and assistive-technology checklist.
