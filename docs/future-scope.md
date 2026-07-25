# GreenRoster future scope and archived reference

Date: July 25, 2026
Status: deferred planning material, not part of v1

This document preserves product knowledge for capabilities deliberately excluded from v1, plus reference material retained from the original master specification. [`master-spec.md`](./master-spec.md) is authoritative for v1.

Nothing in this document creates a v1 requirement, release gate, implementation dependency, or blocker, even where the retained wording uses normative language such as MUST. Every capability below requires a separately approved scope change before implementation. Where a section references an "OD-nn" open decision, see Section 12.

Deferred capability groups:

1. Billing, subscriptions, and entitlement enforcement (Stripe).
2. Communication beyond v1's transactional push and e-mail: an in-app inbox, free-text and bulk sending, templates, audience building, and per-group notification policy.
3. Round messaging and in-app messaging.
4. News, media, branding, and the clubhouse scoreboard.
5. External integrations, principally GHIN handicap synchronization.
6. Generated reports, print/PDF output, and administrator exports.
7. Legacy-data migration and production cutover.
8. Advanced game formats and hole-by-hole scoring.
9. Multi-group membership for a single identity.

Push notifications and transactional e-mail are **not** deferred. They are v1 capabilities specified in Section 12 of `master-spec.md`, and Expo Notifications and Resend are v1 technologies.

SMS is not deferred; it is affirmatively excluded. There is no authorized provider, and legacy carrier e-mail gateways must never be used as an SMS implementation. Any later SMS capability requires a new approved scope and technology decision.

## 1. Billing and entitlement

### 1.1 Billing workflow

1. Administrator opens Billing and sees current plan, trial/subscription state, billable seats or entitlements, next invoice/renewal, payment issues, and history.
2. Checkout and payment method changes occur through Stripe-hosted surfaces unless an approved design requires otherwise.
3. A verified Stripe webhook is processed idempotently and stored before entitlement changes.
4. The portal shows processing rather than falsely confirming payment before the webhook is reconciled.
5. Failed, delayed, duplicated, and out-of-order events are recoverable and visible to administrators.
6. Exact payer, seat-counting, renewal, proration, refund, tax, grace-period, and migration rules are governed by OD-18 through OD-21 and cannot be hard-coded before approval.

### 1.2 Billing portal

The administrator billing area MUST show:

- Stripe customer/subscription reference in support-safe form;
- plan and billing interval;
- trial start/end when applicable;
- subscription state;
- active/billable seat or entitlement count according to final policy;
- member-level entitlement/restriction state if the commercial model retains it;
- current period and next renewal/invoice;
- payment-action-required banner;
- invoice/receipt history through Stripe-supported links;
- Checkout/Customer Portal actions;
- webhook processing or reconciliation failures visible to authorized administrators.

Commercial values, including the legacy public statement of `$10 per permanent member per year`, MUST be configured in Stripe and displayed from normalized plan metadata; they MUST not be hard-coded in clients. The legacy 30-day group trial and expired/expiring-within-10-days views remain requirements subject to commercial confirmation OD-18.

If OD-18 retains member-level administrator purchase, Billing MUST also provide:

1. a filterable list of expired and expiring-within-10-days permanent members;
2. explicit selection and ineligible/excluded reasons;
3. pricing, seat/quantity, effective-date, tax/proration, and total impact preview from the approved Stripe model;
4. Stripe-hosted checkout/confirmation handoff;
5. Processing state until verified webhook reconciliation;
6. per-member success/failure/entitlement outcome and invoice/receipt link.

OD-18 may replace this legacy purchase shape with a group-seat subscription, but the resulting approved decision MUST update the parity matrix and migration/acceptance rules rather than silently remove the legacy workflow.

### 1.3 Stripe integration rules

- Use Stripe-hosted Checkout and Customer Portal where they satisfy the approved billing journey.
- Verify webhook signatures against the configured secret.
- Store and deduplicate every event by Stripe event ID.
- Process relevant events idempotently and tolerate retries/out-of-order delivery by retrieving/reconciling authoritative state when necessary.
- Never accept subscription state from client assertions.
- Do not store raw card data.
- Keep Stripe price/product/customer/subscription identifiers in server configuration/data, not mobile constants.
- Entitlement changes MUST reference the Stripe event or approved manual administrative source.
- Manual entitlement adjustments, if allowed, require reason, expiry, actor, and audit.
- Exact commercial rules remain governed by OD-18 through OD-21.

Verified Stripe events are normalized into PostgreSQL before application entitlement changes are exposed.

## 2. Deferred communication capabilities

Transactional push and e-mail are **in v1** — see Section 12 of `master-spec.md` for the authoritative event list, delivery rules, preferences, and provider requirements. What remains deferred is everything beyond fixed event-driven messages.

### 2.1 In-app notification inbox

V1 delivers push and e-mail but keeps no readable history inside the app, so a member who dismisses a notification relies on the round and results screens instead. A later inbox would add:

- a per-user list of invitations, round changes, live-round alerts, published results, and account notices, each deep-linking to an authorized destination and degrading safely when access was revoked;
- read/unread state synchronized across devices;
- deduplication of provider deliveries into a single inbox item.

### 2.2 Free-text and bulk communication

The legacy product's core communication tool was an administrator composing bulk e-mail and SMS. V1 deliberately replaces that with automatic transactional messages only. A later composer would need:

- audience selection by group, membership state, selected records, round, RSVP state, or role, with exact included and excluded counts and reasons shown before send;
- subject, body, preview, test-send to the acting administrator, scheduling, and an optional deep link;
- reusable templates and group-branded headers and footers, never image-only messages;
- explicit bulk-send confirmation and idempotency against duplicate sends;
- a sends history with per-recipient outcome;
- separation of transactional from marketing-style categories for consent and suppression, since the two carry different legal obligations.

### 2.3 Group notification policy

V1 fixes each event's audience and channels in code, with member-level preferences as the only variation. A later administrator policy surface would allow per-group control of audience and exclusions, allowed and default channels, mandatory versus member-configurable delivery, reminder scheduling, and template and deep-link destinations, with effective-dated versions and audit history. It must never permit a policy leaving a required transactional event with no viable channel.

Whether results and RSVP confirmations should reach the whole active group or only participants is OD-23; v1 answers it narrowly by notifying participants only.

### 2.4 Additional events

These belong to capabilities that are themselves deferred, and become relevant only alongside them: round-message posts, GHIN synchronization problems, billing and payment action-required notices, and RSVP-confirmation notifications to coordinators for groups that want them.

### 2.5 Richer delivery reporting

V1 stores per-recipient delivery state and monitors failure rates. Deferred refinements include distinguishing provider acceptance from confirmed provider delivery from unknown outcome across all channels, exposing that history to administrators in the portal, and opt-in locked-screen preview levels for content v1 keeps out of push payloads entirely.

## 3. Round messages and in-app messaging

The legacy board is round-scoped and limited to 300 characters. The baseline replacement MUST preserve that round conversation and add an in-app notification experience. The project description's broader phrase "in-app messaging" is not sufficiently specific to assume direct messages or group-wide chat; OD-39 must approve the complete conversation model before messaging scope is declared complete.

### 3.1 Mobile messaging

- Accessible round participants and group coordinators/admins can read the round conversation.
- Members can post up to 300 Unicode characters while the round conversation is open. The exact retention of the legacy limit can be changed only by a product decision.
- Each message MUST show author, role where relevant, server timestamp, and edited/deleted state.
- Coordinators/admins can remove a message for policy reasons. The content retention policy is OD-22; the audit record MUST remain.
- Users can delete their own message only under a confirmed policy. Editing, threads, reactions, attachments, mentions, and read receipts are not required by legacy parity and require explicit scope approval.
- The composer MUST show remaining characters, prevent over-limit submission, preserve an unsent draft locally, and announce validation to screen readers.
- Posting MUST be idempotent and reconcile a temporary local item with the confirmed server message.
- Notification preferences MUST allow round-message push control independently from critical round changes.
- Deleted/blocked content MUST disappear through realtime updates without leaving an actionable stale notification.

### 3.2 Web round messages

Round Operations MUST provide a Messages tab with message count/unread indication and the same authoritative conversation used by mobile.

- Loading, empty, retrieval error/retry, populated, posting, moderation, and permission-denied states are required.
- Each message shows author, role where useful, server timestamp, and removed state.
- The composer accepts plain text up to 300 Unicode characters, shows/announces remaining characters, preserves an unsent draft, prevents duplicate/busy submission, and reconciles the idempotent server result.
- Posted/removed messages update through realtime without moving keyboard focus unexpectedly.
- Coordinators/admins may remove a message with confirmation and reason. The message becomes a moderated tombstone under the future messaging policy; audit history remains.
- The tab MUST expose the effective notification policy and link authorized administrators to its configuration.
- Group-wide or direct-message surfaces, if approved under OD-39, require equivalent web management/moderation contracts and are not implied by this round tab.

### 3.3 Message safety

- Server validates the 300-character round-message limit, authorization, round state/policy, and rate limit.
- Plain text is the baseline. Rendered content MUST be escaped; arbitrary HTML is prohibited.
- Moderation actions require reason and audit.
- Abuse reporting/blocking requirements are OD-22 because no legacy behavior was exposed.
- Retention and legal discovery follow the privacy policy unless a future messaging scope approves a stricter policy.

### 3.4 Message and content lifecycle

- Round messages: Pending local → Posted → Deleted/Removed. Editing is out of baseline unless approved.
- News/media: Draft → Scheduled or Published → Archived.
- Notification delivery: Created → Queued → Provider accepted → Delivered when known, or Failed/Suppressed/Cancelled.

## 4. News, media, and content

### 4.1 Mobile content display

- Home/Group MUST show dated news and announcements with subject, body, author, and publish date.
- Retained video content MUST support a title, thumbnail, display window, default flag, and either a safely stored playable asset or an approved external link. Exact legacy video migration is OD-25.
- External URLs MUST be validated, opened with a safe user-visible handoff, and never execute arbitrary app code.

### 4.2 Web content administration

- Coordinators/admins can create, edit, schedule/publish, archive, and preview group news.
- News requires subject, body, author, publish/display dates, and state.
- A news item may send an e-mail/push announcement to active members only after audience preview and confirmation.
- Retained video management supports video or approved external URL, thumbnail, subject, display date, display duration/days, and default-video flag.
- Uploads MUST show progress, validate actual file type and size, use safe filenames/storage paths, and provide recoverable errors.
- Removing content from display MUST not break historical audit references.

## 5. Branding and clubhouse scoreboard

### 5.1 Branding slots

| Slot                             | Legacy-compatible target |   Count |
| -------------------------------- | -----------------------: | ------: |
| E-mail header                    |       Maximum 600×150 px |       1 |
| E-mail footer                    |       Maximum 600×150 px |       1 |
| E-mail footer click URL          |      Validated HTTPS URL |       1 |
| Scoreboard header                |      Maximum 1050×150 px |       1 |
| Scoreboard footer/sponsor banner |      Maximum 1280×175 px | Up to 3 |

The legacy e-mail screen contradicted itself with 500 KB and 512 KB limits. The replacement MUST define one server-enforced value and show the same value everywhere. Until changed by an approved design, use the stricter 500 KB for new e-mail assets and 1,024 KB for scoreboard assets. Valid migrated legacy GIF/JPEG/PNG/BMP assets MUST either remain renderable or be converted during migration; new upload MIME types MUST be security-reviewed and declared consistently.

- Provide upload progress, validation, preview, replace, remove, and save state for every slot.
- Provide a combined e-mail preview and television-scoreboard preview.
- Footer banners MUST be reorderable when more than one exists.
- Images MUST have an alt-text or decorative designation for web contexts.
- URLs MUST reject unsafe protocols.
- Footer click analytics, if retained, MUST show timestamp, campaign/asset, and privacy-safe aggregate context; the precise legacy history migration is OD-26.
- Branding changes MUST be versioned/audited and become visible without stale cache ambiguity.

### 5.2 Scoreboard administration

- Administrator can create/revoke a read-only scoreboard access link or configured authenticated display.
- The UI MUST show access status, current round, last connection, and Open/copy link.
- Publicly guessable group identifiers MUST not grant scoreboard access.
- The exact casting/authentication policy is OD-15.

### 5.3 Scoreboard surface

The scoreboard is a read-only Next.js presentation optimized for a 16:9 television/browser and driven by the same authoritative live/result projection as mobile and admin.

Content:

- group/round identity;
- round state and last server update;
- format and ranking criterion;
- player/team rank and tie state;
- player/team display name;
- quota, points, plus/minus, and format-relevant score values;
- skins/team outputs when confirmed;
- official marker for completed results;
- configured header and up to three footer/sponsor banners.

Behavior:

- Update confirmed live scores through Supabase Realtime with reconnect/snapshot recovery.
- Show a visible Stale/Reconnecting state when live data is not current.
- Support automatic page/row rotation for rosters that do not fit, while preserving a stable viewing interval and rank context.
- Avoid rapid animation; respect reduced motion where the display environment exposes it.
- Never show phone, e-mail, address, billing, or other member-private data.
- Use a revocable, unguessable read-only access grant or authenticated display policy.
- Allow administrator selection of active round when multiple rounds are live.
- Completed results remain available according to configured display/retention policy.
- Do not depend on a manual mobile-score import.
- Exact access, casting, sponsor rotation, incomplete-round visibility, and public exposure rules require OD-15.

## 6. External integrations

### 6.1 GHIN handicap integration

GHIN integration is a required new capability, but the audit did not confirm an existing GHIN connection or expose an API contract. Implementation begins only after the organization supplies authorized provider access, documentation, allowed data uses, rate limits, test credentials, and production approval.

Functional contract:

- Configure GHIN at group/integration level through server-held credentials or the provider's approved authorization model.
- Validate connection without exposing credentials.
- Match a membership using the provider-approved Handicap ID and identity fields.
- Support single-member refresh, selected-member refresh, and a confirmed scheduled/manual group sync policy.
- Preview matches, unmatched records, ambiguous matches, current versus incoming handicap, provider as-of date, and errors before a bulk first import.
- Store the accepted handicap as a new sourced record; do not overwrite historical participant snapshots.
- Show source `GHIN`, external as-of time, last sync time, and stale/error state in mobile and admin.
- Respect provider rate limits and retry guidance without duplicate writes.
- Provide reconciliation/report output for every sync.
- A manual edit after sync MUST be labeled Manual and MUST not be represented as current GHIN data.
- Failure or absent configuration MUST fail visibly. It MUST not fabricate a handicap, mark a manual import as GHIN, or silently skip requested synchronization.

No endpoint names, payload fields, webhook assumptions, or GHIN business rules are specified until the official contract is available.

### 6.2 Integrations administration

The Integrations page MUST list GHIN and every approved external provider with Configured/Not configured, Enabled/Disabled, Healthy/Stale/Error, and last successful activity.

For GHIN it MUST provide:

- provider-approved credential/authorization entry handled server-side;
- Test connection with safe success/error detail;
- Enable/disable confirmation and effect summary;
- manual and approved scheduled sync policy, last/next sync, and Sync now;
- recent sync jobs with counts, duration, status, safe errors, and downloadable reconciliation report;
- unmatched/ambiguous member queue with side-by-side identity evidence and explicit match/skip decisions;
- member-level incoming/current handicap, source/as-of time, accept/reject/retry where provider policy permits;
- configuration missing, expired authorization, rate-limit, provider outage, partial failure, and permission-denied states.

Secrets MUST never be returned after save. Disabling GHIN stops future sync but preserves previously sourced handicap records and provenance. No control may be shown as successfully connected without a real provider validation.

## 7. Reports and exports

Report and export concepts retained from the legacy product:

- member quota and round history;
- member list;
- member contact information for authorized roles;
- round participant list;
- round points worksheet;
- team list once team rules are confirmed;
- points-game score pad;
- CSV exports for members, rounds, results, and standings;
- print/PDF output for the operational reports selected under OD-24.

- Every report MUST identify group, generation time, filter/reporting window, group time zone, and whether it contains private data.
- The standings report MUST show the reset/effective date and exclude guests.
- Historical result reports MUST use round snapshots, not current member quota/handicap values.
- Exports MUST stream/paginate large datasets safely and record the actor and filter scope.
- A report with no data MUST still render an explanatory header/state rather than fail or produce misleading totals.

## 8. Advanced game formats and scoring

The following legacy capabilities require a separately approved future scope and complete executable rules:

- two-person and four-person teams;
- net and gross team scoring/aggregation;
- skins eligibility, hole/result input, tie/carryover, and payout/display rules;
- `Require Entry` semantics;
- best-ball, scramble, and other non-points formats;
- hole-by-hole scoring, point conversion, and course-data calculation.

They may be implemented only from approved rule definitions and executable examples. The product MUST not expose a selectable format that lacks a complete server calculator, validation contract, result projection, mobile entry UI, admin UI, and tests.

## 9. Legacy-data migration and cutover

### 9.1 Required discovery

Before building production migration, obtain and profile authorized exports/schema for:

- groups and group/course/pro/contact configuration;
- users, shared/individual credentials, administrators/coordinators;
- members, contacts, privacy, SMS consent/provider, statuses, dues, handicap, quota, initial history;
- rounds, formats, participants, guests, RSVP timestamps, scores, points, merit, skins/team data, completion state;
- quota/rule settings and adjustment tables;
- current standings and reproducible source history;
- round messages;
- news and uploaded videos/thumbnails;
- e-mail/scoreboard branding and click history;
- subscriptions, entitlements, invoices/processor references;
- reports/exports that encode business logic;
- external APIs, jobs, webhooks, and audit/support data.

No listed category may be omitted silently. If a source is unavailable or a field cannot be mapped, the migration report MUST mark it blocked with owner and decision.

### 9.2 Mapping rules

- Generate immutable new identifiers and preserve a legacy-key crosswalk.
- Convert shared access to person-specific invitations; do not import a shared group password as a new credential.
- Migrate password hashes only if Supabase supports the exact secure algorithm and a reviewed process; otherwise require password setup/recovery without exposing legacy passwords.
- Map each legacy member to a membership and identity candidate using approved deterministic matching, with human review for ambiguity.
- Preserve historical participant snapshots even when legacy current-member values differ.
- Preserve guest records as round-scoped participants.
- Separate manual and generated participation merit where reconstructable; flag ambiguous legacy totals.
- Preserve original timestamps and time-zone assumptions; unresolved time zones require an explicit mapping decision.
- Import current rules as version 1 with a documented effective/cutover interpretation.
- Recalculate only in an isolated reconciliation run; do not overwrite legacy official results merely because a new calculation differs.
- Convert/store brand/media assets through validated paths and record failures.
- Stripe/payment migration MUST follow provider-supported references and OD-20; never copy raw card data.

### 9.3 Migration process

1. Inventory and profile source data.
2. Approve mapping specification and anomaly handling.
3. Build an idempotent, restartable migration pipeline.
4. Run dry migrations against an isolated disposable database.
5. Reconcile record counts, monetary/entitlement counts, per-group totals, referential integrity, sample results, quota history, standings, and assets.
6. Produce group-level exception reports and obtain business sign-off.
7. Rehearse identity activation and communication suppression so testing does not send to real users.
8. Define cutover freeze/read-only window and final delta migration.
9. Run final validation and smoke tests.
10. Activate new authentication/communications deliberately.
11. Keep the legacy system read-only for the approved parallel/retention period.
12. Execute rollback only under the approved plan; do not accept writes in both systems without a reconciled dual-write design.

### 9.4 Reconciliation requirements

At minimum compare:

- groups, members by state/role, guests, and subscriptions;
- rounds by state/date and participant counts;
- result rows and plus/minus samples;
- merit totals and participation-point effects where identifiable;
- quota current values and source history;
- standings/rounds-played under reset dates;
- news/messages/media/assets;
- orphan/duplicate identity and participant references;
- invalid e-mail, Handicap ID, time-zone, and provider records.

Every discrepancy MUST be explained, corrected, or explicitly accepted by the product owner before production cutover.

## 10. Multi-group membership

V1 binds one Supabase identity to exactly one group membership. The service remains multi-tenant with strict isolation, but a golfer who plays with two groups signs up separately in each. This was a deliberate simplification: supporting one person across groups requires an active-group concept threaded through every request, a group switcher on both clients, group-scoped contact addresses with their own uniqueness and verification rules, cross-group deep-link handling, and per-group notification preferences — all to serve a minority case.

Reintroducing it later requires:

- an active-group selection that the server resolves and validates rather than trusting from the client, with every audit record naming the group acted in;
- a group switcher in the mobile header, the portal shell, and the role-denied state, which must never render one group's data under another group's heading;
- a group-scoped contact e-mail, unique within its group and defaulting to the account e-mail, with an unverified state when it differs, plus an administrator correction path;
- deep links and notification taps that resolve the target group, prompt a switch, and only then open the resource;
- notification preferences and delivery scoped per membership rather than per user, so one group's opt-out does not silence another;
- sign-out and revocation logic that purges cached data for the affected membership only;
- Order of Merit, quota, and standings that stay strictly per membership, with no cross-group aggregation implied anywhere in the UI.

Migration from the single-membership model must merge duplicate identities the same person created in different groups, which needs an approved identity-matching and consent design before any automatic merge.

## 11. Deferred data-model entities

### 11.1 Communication and content entities

| Entity                      | Required concepts                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Round message               | Round/group, author, body, server timestamp, moderation/deletion state                                                           |
| News item                   | Group, subject/body, author, draft/schedule/publish/archive state and display dates                                              |
| Media item                  | Group, subject, asset/link, thumbnail, display window, default flag, state                                                       |
| Notification inbox item     | Event, user, read time, deep-link data, authorization-safe summary                                                               |
| Communication campaign      | Group, audience definition/snapshot, content, channels, schedule/state, actor                                                    |
| Message template            | Group, category, subject/body content, branding references, version, actor                                                       |
| Notification policy version | Group, event category, resolved audience/channel rules, mandatory/configurable flags, effective state/time, actor/reason         |
| Marketing consent           | User/membership/channel, consent source/time, withdrawal reason and time, kept separate from v1's transactional suppression list |

Notification preference, push device, notification delivery, and e-mail suppression are **v1** entities defined in Section 13.4 of `master-spec.md` and are not repeated here.

### 11.2 Billing and asset entities

| Entity                               | Required concepts                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Billing customer/subscription mirror | Group or approved owner, Stripe IDs, plan, interval, quantity, status, period/trial times, last reconciled event     |
| Member entitlement                   | Membership, source, state, effective/expiry times, reason/reference                                                  |
| Stripe event                         | Provider event ID/type, signature-verification state, received/processed time, normalized outcome, retry/error state |
| Brand asset                          | Group, slot, storage reference, dimensions/type/size, alt/decorative state, order, active version                    |
| Scoreboard access                    | Group, token digest/auth mode, state, scope/current-round policy, created/revoked metadata                           |
| Integration connection               | Group/provider, configured/enabled state, credential reference, last validation/sync, safe error state               |
| Generated report                     | Group, report type, filters, storage reference/expiry, actor/timestamps, private-data flag                           |

Future external-provider records MUST keep provider IDs and sync provenance separate from user-visible values when that scope is approved. Future provider event IDs follow the same idempotency-key uniqueness rule as current-scope client operation IDs.

## 12. Open decisions for deferred scope

| ID    | Question                                                                                                                                                                      | Accountable owner                       | Applies to                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------- |
| OD-10 | Can guests read/post round messages?                                                                                                                                          | Product owner                           | Messaging implementation           |
| OD-15 | Define scoreboard URL/auth, casting, incomplete/live visibility, round selection, sponsor rotation, and retention.                                                            | Product owner + security lead           | Scoreboard implementation          |
| OD-18 | Confirm payer/owner, plan structure, billable unit, legacy `$10/member/year`, 30-day trial, and expiring-within-10-days behavior.                                             | Commercial owner + product owner        | Billing implementation             |
| OD-19 | Define renewals, proration, activation/deactivation effects, grace, failed payment, refund, tax, invoice, and receipt rules.                                                  | Commercial owner                        | Billing implementation             |
| OD-20 | Identify current processor and whether subscriptions/payment references can migrate without re-entry.                                                                         | Commercial owner + migration lead       | Migration design                   |
| OD-21 | Define exactly when entitlement blocks invite, activation, assignment, RSVP, scoring, or only new-member use after trial.                                                     | Commercial owner + product owner        | Entitlement implementation         |
| OD-22 | Define message edit/self-delete, moderation retention, abuse report/block, and notification rules.                                                                            | Product owner + legal/safety owner      | Messaging implementation           |
| OD-23 | Define configurable recipients per category beyond v1's fixed participant-only audiences, including whether results reach the whole active group.                             | Product owner                           | Notification-policy implementation |
| OD-24 | Identify operationally essential print/PDF reports and approve replacement layouts.                                                                                           | Product owner + operations owner        | Reports implementation             |
| OD-25 | Confirm uploaded-video usage, migration, formats/limits, and whether safe external links may replace hosting.                                                                 | Product owner                           | Media implementation               |
| OD-26 | Confirm whether legacy e-mail-footer click history must migrate and its privacy/retention policy.                                                                             | Product owner + legal/privacy owner     | Branding migration                 |
| OD-34 | Confirm legacy individual user-ID mapping/recovery and identity activation during migration.                                                                                  | Product owner + migration/security lead | Identity migration                 |
| OD-36 | Confirm whether club `Dues Paid` relates to platform subscription entitlement.                                                                                                | Commercial owner + product owner        | Member/billing implementation      |
| OD-38 | Identify existing APIs, exports, jobs, scoreboard endpoints, and third-party consumers requiring transition.                                                                  | Migration lead + legacy system owner    | Migration/cutover design           |
| OD-39 | Decide whether in-app messaging is round-only plus inbox or also group channels/direct messages; define audience, creation, unread, moderation, retention, and notifications. | Product owner + legal/safety owner      | Messaging information architecture |

## 13. Archived legacy parity matrix

| Legacy capability/evidence                          | Replacement disposition                                                                                                                                                               | Scope status                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Shared group login plus individual/admin passwords  | Replace with one Supabase identity and group-scoped role; the browser access it provided is preserved by the authenticated member web view; legacy-password migration is not included | Current core; migration future |
| Home: upcoming, recent, standings, news             | Mobile Home covers upcoming, recent, and standings; news is retained as future reference                                                                                              | Current core; news future      |
| Read-only member directory with quota/merit/history | Mobile directory and standings with server-enforced privacy                                                                                                                           | Current                        |
| Six-section member wizard                           | Responsive progressive admin form preserving current-scope confirmed fields                                                                                                           | Current                        |
| Search/alphabet, mass update, prints                | Admin filters and explicit bulk preview are current; print/report output is future                                                                                                    | Mixed                          |
| Handicap ID/import                                  | Manual/CSV handicap import is current; GHIN integration is future                                                                                                                     | Mixed                          |
| Bulk e-mail                                         | Transactional round and result e-mail is current scope; a free-text campaign workflow with audience selection and delivery history is future                                          | Mixed                          |
| Carrier-based bulk text/SMS                         | Explicitly omitted from v1; legacy gateway prohibited; later support requires a new scope/technology decision                                                                         | Excluded from v1               |
| Round creation general/format wizard                | Draft/review/publish workflow with participant preview                                                                                                                                | Current                        |
| P/N response and timestamp                          | Playing/Not Playing/no-response state with full event history                                                                                                                         | Current                        |
| Member and coordinator guest signup                 | Policy-controlled round-scoped guest workflow                                                                                                                                         | Current                        |
| Editable score/points/merit grid                    | Web operational grid plus mobile scorecard, versioned server mutations                                                                                                                | Current                        |
| Beta mobile score import                            | Replace with direct authoritative realtime synchronization and offline queue                                                                                                          | Current                        |
| Individual Net/Gross                                | Preserve verified formulas and explicit tied results                                                                                                                                  | Current                        |
| Team/skins/Require Entry/other formats              | Explicitly omitted from v1; later support requires complete approved rules and executable examples                                                                                    | Future scope                   |
| Complete checkbox/reopen                            | Reviewed state transition with readiness, audit, and reversible generated effects                                                                                                     | Current                        |
| Round message board, 300 characters                 | Mobile/admin realtime round messaging with moderation and preferences                                                                                                                 | Future scope                   |
| Recent/published result tables                      | Mobile/admin official result views are current; scoreboard projection is future                                                                                                       | Mixed                          |
| Three quota methods, rounding, seed history         | Server quota engine with exact tests                                                                                                                                                  | Current                        |
| Participation merit and reset date                  | Preserved, plus an optional placement table so merit no longer has to be typed in by hand                                                                                             | Current                        |
| News and videos                                     | Retain content management and mobile display subject to OD-25                                                                                                                         | Future scope                   |
| Annual member subscriptions/30-day trial            | Stripe group billing/entitlement architecture subject to commercial decisions                                                                                                         | Future scope                   |
| Printable member/round/standing reports             | Authorized PDF/print and CSV outputs subject to OD-24                                                                                                                                 | Future scope                   |
| E-mail/scoreboard images and click history          | Supabase-hosted versioned branding, previews, validated links, OD-26                                                                                                                  | Future scope                   |
| Scrolling/cast scoreboard                           | Realtime, stale-aware Next.js television presentation with revocable access                                                                                                           | Future scope                   |

## 14. Archived evidence traceability

### 14.1 Source documents

- [`tech-stack.md`](./tech-stack.md) — fixed implementation stack and architecture constraints.
- [`GreenRoster-system-explained.md`](./GreenRoster-system-explained.md) — legacy domain model, roles, fields, quota methods, lifecycle, communication, mobile intent, billing, reports, content, and explicit unknowns.
- [`GreenRoster product audit`](/Users/andrey/.codex/visualizations/2026/07/18/019f7541-7c9b-78f1-a60c-69832074582b/golfdogfight-audit/GolfDogFight-product-audit.md) — authenticated behavior, audit boundaries, replacement requirements, UX/technical risks, and client questions.

The audit copy of `GreenRoster-system-explained.md` is byte-identical to the repository copy. The evidence folder contains ten desktop-web screenshots and no native or mobile-web screenshots. The legacy mobile site could not be inspected because its TLS certificate failed validation. All mobile layouts and interaction patterns in the specification are therefore target requirements derived from documented workflows, not a reconstruction of unseen legacy screens.

### 14.2 Screenshot register

| Evidence                                                                                                                                                                | Confirmed contribution to the specification                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`01-admin-home.png`](/Users/andrey/.codex/visualizations/2026/07/18/019f7541-7c9b-78f1-a60c-69832074582b/golfdogfight-audit/01-admin-home.png)                         | Upcoming/Recent/Standings/News navigation and no-upcoming-round empty state                                                                                                  |
| [`02-members-empty.png`](/Users/andrey/.codex/visualizations/2026/07/18/019f7541-7c9b-78f1-a60c-69832074582b/golfdogfight-audit/02-members-empty.png)                   | Member directory filters, quota/merit/history columns, print actions, empty state                                                                                            |
| [`03-manage-members.png`](/Users/andrey/.codex/visualizations/2026/07/18/019f7541-7c9b-78f1-a60c-69832074582b/golfdogfight-audit/03-manage-members.png)                 | Member admin actions, search/filter, bulk communication/import, management columns                                                                                           |
| [`04-manage-rounds.png`](/Users/andrey/.codex/visualizations/2026/07/18/019f7541-7c9b-78f1-a60c-69832074582b/golfdogfight-audit/04-manage-rounds.png)                   | Round list/add action, participation counts, empty and clipped fixed-width state                                                                                             |
| [`05-round-format-form.png`](/Users/andrey/.codex/visualizations/2026/07/18/019f7541-7c9b-78f1-a60c-69832074582b/golfdogfight-audit/05-round-format-form.png)           | General/Format creation steps and Individual Net/Gross, Teams, Require Entry, Track Skins controls                                                                           |
| [`06-score-entry.png`](/Users/andrey/.codex/visualizations/2026/07/18/019f7541-7c9b-78f1-a60c-69832074582b/golfdogfight-audit/06-score-entry.png)                       | Roster actions, score fields, P/N, plus/minus examples, completion participation-point notice, and print actions; the unidentified red action is not a v1 parity requirement |
| [`07-round-messages.png`](/Users/andrey/.codex/visualizations/2026/07/18/019f7541-7c9b-78f1-a60c-69832074582b/golfdogfight-audit/07-round-messages.png)                 | Round-scoped message tab, empty state, composer, 300-character limit                                                                                                         |
| [`08-group-settings.png`](/Users/andrey/.codex/visualizations/2026/07/18/019f7541-7c9b-78f1-a60c-69832074582b/golfdogfight-audit/08-group-settings.png)                 | Quota methods/round count/rounding, participation points, reset date, guest/other-format settings, e-mail/scoreboard branding slots and legacy constraints                   |
| [`09-published-results.png`](/Users/andrey/.codex/visualizations/2026/07/18/019f7541-7c9b-78f1-a60c-69832074582b/golfdogfight-audit/09-published-results.png)           | Complete/read-only result state, result fields and descending Individual Net order                                                                                           |
| [`10-dashboard-recent-round.png`](/Users/andrey/.codex/visualizations/2026/07/18/019f7541-7c9b-78f1-a60c-69832074582b/golfdogfight-audit/10-dashboard-recent-round.png) | Recent-round summary, winner criterion, result drill-down                                                                                                                    |

No screenshot establishes native mobile layout, loading/error behavior, authentication UI, push, realtime synchronization, offline handling, GHIN, Stripe checkout, or exact hidden permissions.
