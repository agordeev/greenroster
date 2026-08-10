# GolfDogFight parity and GreenRoster gap analysis

Date: August 10, 2026  
Status: product review; this document does not silently change the v1 scope

## Executive conclusion

GreenRoster implements much of the secure round loop—members, quotas, rounds,
RSVP, scoring, realtime leaderboard, completion, results, standings, and
transactional notifications—but it is not yet a GolfDogFight replacement.

The most serious gap is the first-run account path. GolfDogFight lets a new
group organizer select **Get Started** and create a group through a public
signup/trial wizard. GreenRoster's root route sends an unauthenticated visitor
to sign-in, the sign-in screen has no registration link, and the initial local
administrator must currently be provisioned in Supabase Studio. Account
creation exists only inside an invitation handoff for an already-created
member. A new organizer therefore cannot start the product without operator
intervention.

The second problem is scope drift. The legacy product reference describes
shared group access, subscriptions, group communication, news, videos,
round messages, skins, team formats, hole-level scorecards, reports, and a
clubhouse scoreboard. GreenRoster's current master spec deliberately excludes
most of those capabilities from v1. That is a valid security/roadmap choice,
but it is not feature parity and must be treated as an explicit product
decision rather than an accidental omission.

## Evidence and limits

The comparison used:

1. The live public GolfDogFight site, including its login page and public
   signup wizard, visited on August 10, 2026.
2. GolfDogFight's public feature and FAQ copy, which describes member and
   round management, quota methods, formats, communication, mobile use,
   trials, subscriptions, and unlimited members/rounds.
3. GreenRoster's local web app at `http://localhost:3000`, including the
   unauthenticated sign-in flow and route inventory.
4. GreenRoster's authoritative v1 spec, progress ledger, legacy product
   reference, and future-scope document.

No GolfDogFight account was created and no external data was changed. Its
authenticated member/coordinator screens therefore remain to be verified with
an authorized test account. The rows below distinguish public/live evidence
from behavior documented in the repository's legacy reference.

Sources:

- [GolfDogFight public product page](https://www.golfdogfight.com/)
- [GolfDogFight login](https://www.golfdogfight.com/Login.aspx)
- [GolfDogFight signup wizard](https://www.golfdogfight.com/webforms/dogfightclub.aspx?cmd=signup)
- [GreenRoster master spec](./master-spec.md)
- [GreenRoster legacy product reference](./GreenRoster-system-explained.md)
- [GreenRoster future scope](./future-scope.md)
- [GreenRoster progress ledger](./progress.md)

## Major gaps

Priority meanings:

- **P0** — blocks a new group or breaks the core replacement promise.
- **P1** — important product parity or adoption gap; should follow the core
  loop unless explicitly rejected.
- **P2** — valuable parity or scale capability that can follow the first
  release.

| Priority | Capability                                                        | GolfDogFight behavior                                                                                                                                                                                                          | GreenRoster status                                                                                                                                                                                                                                                                                                                                       | Consequence / decision                                                                                                                                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**   | Public organizer signup and group bootstrap                       | **Get Started** opens a multi-step wizard for account login, group information, pro information, administrator information, terms, and enrollment. The public site advertises a free 30-day trial.                             | `/` redirects to sign-in. The sign-in page says “GreenRoster never uses a shared group password” and exposes only sign-in and recovery. There is no public `/sign-up`; account creation is reachable only from `/invitations/accept/register`. Local first-admin setup requires direct Supabase Auth provisioning before `/portal` can create the group. | A new group cannot self-serve. Add an organizer signup path, or explicitly document an operator-provisioned launch model. The secure version should create the Auth identity, group, and administrator membership atomically after e-mail verification and legal acceptance.                                                                             |
| **P0**   | Access model compatible with the legacy group                     | GolfDogFight's login accepts a **Group ID or User ID** and password. A group login lets members view group information; an individual login is used for personal profile and RSVP actions.                                     | GreenRoster intentionally removes shared group credentials and uses one verified person-specific identity tied to one membership.                                                                                                                                                                                                                        | This is a deliberate security improvement, but it changes the product's entry and viewing model. Decide whether legacy group-login users must be supported, or provide a clearly documented replacement such as a public/read-only group view plus individual member accounts. Do not call the products parity-equivalent while this remains unresolved. |
| **P0**   | Complete guest lifecycle                                          | GolfDogFight supports round-scoped guests; members may add guests when the group allows it, and coordinators can always add them. Guest scoring participates in the round and legacy docs include guest quota/handicap fields. | Guest reads, counts, permission settings, and sponsored boundaries exist. Guest creation, withdrawal, and sponsored scoring are still blocked pending lifecycle, provenance, revision, and result-snapshot decisions.                                                                                                                                    | The stated core loop cannot be completed for a common dogfight use case. Close the Phase 04 contract and acceptance scenarios before declaring the core product complete.                                                                                                                                                                                |
| **P0**   | Advanced dogfight formats and scoring                             | The legacy surface documents Individual Net/Gross, two- and four-person teams, Require Entry, Track Skins, best-ball, and scramble/non-points rounds.                                                                          | v1 deliberately excludes teams, skins, Require Entry, best ball, scramble, and hole-by-hole scoring. Current scoring is the server-authoritative points/score/plus-minus/merit path.                                                                                                                                                                     | If GreenRoster is intended to replace GolfDogFight rather than only its simplified points loop, these must be promoted from future scope with rules, snapshots, ranking, UI, and test contracts.                                                                                                                                                         |
| **P1**   | Trial, subscriptions, and member entitlements                     | GolfDogFight advertises a 30-day group trial, then annual per-member subscriptions; the admin view tracks active/inactive/expired or soon-to-expire members and can purchase subscriptions.                                    | Billing and entitlement enforcement are explicitly deferred; no Stripe product, checkout, trial state, expired-member gating, or billing portal exists.                                                                                                                                                                                                  | There is no commercial lifecycle and no way to enforce the legacy member activation model. Decide the commercial model, then implement server-authoritative Stripe state and entitlement gates.                                                                                                                                                          |
| **P1**   | Group communication and SMS                                       | GolfDogFight supports group e-mail and text messaging, round invitation links/actions, and last-minute changes or cancellations to the group.                                                                                  | GreenRoster implements fixed transactional e-mail and push. Bulk/free-text messaging is deferred and SMS is explicitly excluded.                                                                                                                                                                                                                         | Coordinators cannot send the operational “everyone needs to know” messages that are central to the legacy workflow. Add a consented communication product or explicitly accept the narrower transactional-only product.                                                                                                                                  |
| **P1**   | News, videos, and member community                                | GolfDogFight exposes dated news, a video area, a round message board, and private contact with the coordinator/pro.                                                                                                            | GreenRoster has no news/media management, round message board, in-app inbox, or private messaging in v1; all are in future scope.                                                                                                                                                                                                                        | The member home is a round/results surface, not the group clubhouse/community surface. This is a large adoption and retention gap for groups that use the legacy app between rounds.                                                                                                                                                                     |
| **P1**   | Hole-level virtual scorecard and personal golf stats              | GolfDogFight documents a virtual scorecard for any golf round, including strokes, putts, fairways hit, greens hit, sand saves, hole comments, and shareable scorecard links.                                                   | GreenRoster stores and presents round quota, score, points, plus/minus, merit, official results, quota history, and standings. It does not provide a hole-by-hole scorecard, golf-stat tracking, or scorecard sharing.                                                                                                                                   | Members can run the points game but cannot use GreenRoster as their general golf-round record. Decide whether that broader personal scorecard is part of the replacement promise.                                                                                                                                                                        |
| **P1**   | Club/pro information, branding, promotions, and clubhouse display | GolfDogFight captures course/pro/shop information, supports e-mail header/footer assets and sponsor banners, and advertises a real-time scrolling scoreboard suitable for a clubhouse TV or kiosk/tablet.                      | GreenRoster has group identity/time-zone and rules surfaces, but no pro/shop surface, branding slots, sponsor promotions, public scoreboard, or kiosk display. These are explicitly deferred.                                                                                                                                                            | The product loses the course/pro operational and “19th hole” experience. Promote the scoreboard and group-content work if that is part of the intended market.                                                                                                                                                                                           |
| **P1**   | Reports, printing, and exports                                    | The legacy reference lists member/contact reports, quota and round history, participant lists, points worksheets, team lists, standings, and a score-pad PDF.                                                                  | Generated reports, print/PDF output, and administrator exports are explicitly deferred. Browser print is the only v1 fallback.                                                                                                                                                                                                                           | Coordinators lose the paper/kiosk workflows used at the course. Add server-generated, tenant-safe reports after the format model is settled.                                                                                                                                                                                                             |
| **P1**   | Full mobile/no-install member parity                              | GolfDogFight is web-based, advertises a responsive mobile site, and supports a tablet/kiosk workflow without installing software.                                                                                              | GreenRoster has a native Expo golfer app plus a small member web view. The member web view intentionally supports only next-round RSVP, results, and standings; it does not score, manage guests, edit profiles, or show the directory.                                                                                                                  | A member who will not install the native app has materially less functionality than a GolfDogFight member. Either expand the member web view or make the native app requirement explicit in onboarding and product positioning.                                                                                                                          |
| **P1**   | Legacy-data migration and cutover                                 | GolfDogFight is the incumbent system whose historical members, quotas, rounds, and results are the reason a replacement must be useful on day one.                                                                             | Legacy-data migration and production cutover are future scope. The hosted Supabase migrations are applied, but no import/cutover rehearsal is complete.                                                                                                                                                                                                  | A group cannot move without re-entering its roster and history. Define an import contract, validation/preview, quota-history mapping, and rollback plan before launch.                                                                                                                                                                                   |
| **P2**   | External handicap/provider integration                            | GolfDogFight's documented model stores Handicap ID and handicap values manually.                                                                                                                                               | GHIN and other external integrations are deliberately deferred.                                                                                                                                                                                                                                                                                          | Not a verified GolfDogFight parity gap, but it is a future integration decision if handicap synchronization is expected.                                                                                                                                                                                                                                 |
| **P2**   | Multi-group identity                                              | GolfDogFight's public materials emphasize one group login model; its full cross-group behavior was not verified.                                                                                                               | GreenRoster intentionally limits one identity to one membership in v1.                                                                                                                                                                                                                                                                                   | Do not expand this without a product decision; it affects active-group selection, preferences, RLS, and notification routing.                                                                                                                                                                                                                            |

## What is already present or stronger in GreenRoster

The comparison is not one-sided. GreenRoster already has a stronger security and
reliability foundation than the public GolfDogFight materials demonstrate:

- person-specific Supabase Auth sessions instead of shared credentials;
- server-resolved membership and role, strict tenant isolation, and RLS;
- invitation state, auditability, idempotent mutations, and delivery records;
- versioned published rounds and immutable score revisions;
- realtime live projections, native offline score queueing, stale-value handling,
  and server-confirmed receipts;
- completion/reopen semantics, immutable official results, quota history, and
  standings projections;
- transactional e-mail/push delivery health, retry boundaries, privacy
  requests, and release-hardening checks.

Those strengths do not replace the missing product surfaces. They make the
missing signup and expanded workflows safer to implement, but they do not make
them available to users today.

## Recommended reprioritization

### 1. Restore a real first-run path (P0)

Add a public organizer entry point from both the landing page and sign-in:

1. Organizer enters e-mail/password and accepts the current legal documents.
2. Supabase Auth verifies the e-mail without exposing account-enumeration state.
3. Organizer supplies group name, time zone, and the initial administrator
   contact/profile fields.
4. The server atomically creates the group and administrator membership.
5. The portal continues to the existing onboarding checklist.
6. The invitation path remains separate for members and never creates an
   unscoped member account.

The flow needs rate limits, neutral duplicate-account errors, recovery-safe
redirects, an abandoned-signup cleanup policy, and an explicit trial/entitlement
decision if billing is retained.

### 2. Decide what “replacement” means (P0)

There are two coherent products, and the code/spec currently mix them:

- **Secure core v1:** person-specific accounts, invitation-only membership,
  transactional notifications, one points format, and no legacy community or
  commercial surfaces.
- **GolfDogFight replacement:** public organizer signup, legacy-compatible
  onboarding, guests, formats/skins, broader scorecards, communication/content,
  reports, billing, and migration.

The second option is substantially larger. It should be approved as a scope
change rather than smuggled into Phase 07 under the label of parity.

### 3. Close the core loop before adding polish (P0)

Complete the blocked guest lifecycle and define the RSVP/reminder contracts
already recorded in `docs/progress.md`. A product that cannot create, withdraw,
and score a permitted guest is not yet a complete dogfight loop.

### 4. Promote the highest-value parity surfaces (P1)

If the replacement target is confirmed, the next vertical slices should be:

1. round formats and skins;
2. billing/trial/entitlements;
3. group communication, news, and round messages;
4. hole-level scorecard and personal stats;
5. scoreboard/branding and operational reports;
6. legacy-data import and cutover.

Each slice needs its own server contract, tenant/RLS rules, UI, notifications,
tests, and migration evidence. The current `future-scope.md` text is a useful
requirements archive, not implementation authorization.

## Release implications

Even the current secure core is not hosted for users yet: the progress ledger
records that the connected Vercel project has no deployment/domain and that
hosted rollback/restore, provider recovery, legal/store evidence, and final
cross-platform evidence remain open. The signup gap should therefore be fixed
before a public launch, not after users encounter the dead end.
