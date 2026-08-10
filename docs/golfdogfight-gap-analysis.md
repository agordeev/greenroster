# GolfDogFight parity and GreenRoster gap analysis

Date: August 10, 2026  
Status: product review and implementation ledger; parity is not complete

## Executive conclusion

GreenRoster now has a secure organizer signup/bootstrap path, the core round
loop, a server-authoritative guest lifecycle, commercial billing foundations,
clubhouse content, messaging and coordinator contact history, hole-level
scorecards and personal stats, branding/kiosk scoreboard support, CSV/PDF
reports, member-web round detail, and a tenant-safe legacy-import staging and
mapping boundary. It is still not a complete GolfDogFight replacement.

The largest remaining gaps are the legacy shared group-login model, executable
rules for advanced formats, SMS/GHIN integrations, and production legacy-data
cutover. These are explicit product or external-state gaps, not hidden v1
omissions.

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

| Priority | Capability                                                        | GolfDogFight behavior                                                                                                                                                                                                          | GreenRoster status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Consequence / decision                                                                                                                                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**   | Public organizer signup and group bootstrap                       | **Get Started** opens a multi-step wizard for account login, group information, pro information, administrator information, terms, and enrollment. The public site advertises a free 30-day trial.                             | **Implemented locally:** `/sign-up` collects organizer credentials and legal acceptance, the verified callback uses a signed handoff, and `bootstrap_organizer` atomically creates the group and administrator membership. The form is intentionally withheld until deployment-owned Terms/Privacy versions exist in `app.current_legal_documents`; the page now explains that gate and links directly to the legal notices instead of appearing to omit signup. Hosted/legal verification remains a release gate.                                                                                                                    | Keep organizer signup separate from member invitation signup. Seed only approved legal versions, then verify the hosted callback, rate limits, legal versions, and abandoned-signup cleanup before launch.                                                                                                                                               |
| **P0**   | Access model compatible with the legacy group                     | GolfDogFight's login accepts a **Group ID or User ID** and password. A group login lets members view group information; an individual login is used for personal profile and RSVP actions.                                     | GreenRoster intentionally removes shared group credentials and uses one verified person-specific identity tied to one membership.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | This is a deliberate security improvement, but it changes the product's entry and viewing model. Decide whether legacy group-login users must be supported, or provide a clearly documented replacement such as a public/read-only group view plus individual member accounts. Do not call the products parity-equivalent while this remains unresolved. |
| **P0**   | Complete guest lifecycle                                          | GolfDogFight supports round-scoped guests; members may add guests when the group allows it, and coordinators can always add them. Guest scoring participates in the round and legacy docs include guest quota/handicap fields. | **Implemented in source:** server-authoritative create/edit/withdraw and sponsored scoring contracts, deadline/round-state checks, audit/idempotency, and coordinator controls. The native member guest surface remains available through the approved mobile contract; the fixed member web v1 remains RSVP/profile/read-only. Clean local reset/full pgTAP evidence is green; hosted migration evidence remains pending.                                                                                                                                                                                     | Keep guest names, snapshots, score invalidation, and official-result behavior server-owned. Decide separately whether no-install members may manage guests before expanding the fixed member web scope.                                                                                                                                                  |
| **P0**   | Advanced dogfight formats and scoring                             | The legacy surface documents Individual Net/Gross, two- and four-person teams, Require Entry, Track Skins, best-ball, and scramble/non-points rounds.                                                                          | v1 deliberately excludes teams, skins, Require Entry, best ball, scramble, and hole-by-hole scoring. Current scoring is the server-authoritative points/score/plus-minus/merit path, and a database guardrail test keeps the executable `round_format` enum limited to `individual_net` and `individual_gross`.                                                                                                                                                                                                                                                                                                                                                                                                                           | If GreenRoster is intended to replace GolfDogFight rather than only its simplified points loop, these must be promoted from future scope with rules, snapshots, ranking, UI, and test contracts.                                                                                                                                                         |
| **P1**   | Trial, subscriptions, and member entitlements                     | GolfDogFight advertises a 30-day group trial, then annual per-member subscriptions; the admin view tracks active/inactive/expired or soon-to-expire members and can purchase subscriptions.                                    | **Implemented locally:** billing accounts, trial/migration grace, Stripe checkout and customer-portal boundaries, verified ordered webhook reconciliation, invoice history, admin entitlement adjustments, member entitlement enforcement, and audit/idempotency are covered by migration 20260810075834 and 25 pgTAP assertions. Hosted Stripe secrets/product configuration remain release gates.                                                                                                                                                                                                            | Apply the migration in the hosted project, configure the Stripe product/price/webhook secret, and confirm the final payer/seat policy before production billing.                                                                                                                                                                                         |
| **P1**   | Group communication and SMS                                       | GolfDogFight supports group e-mail and text messaging, round invitation links/actions, and last-minute changes or cancellations to the group.                                                                                  | Round announcements now support a 300-character coordinator/admin post, tenant-scoped inbox fan-out, read receipts, and mobile/web delivery. The coordinator-contact path now exposes authenticated contact history on native mobile as well. Bulk/free-text e-mail, audience builders, and SMS remain absent; SMS remains explicitly excluded.                                                                                                                                                                                                                                                                                                                                                                 | Decide whether fixed announcements and coordinator contact are enough for launch. A later composer needs consent, audience preview, rate limits, provider policy, and delivery history.                                                                                                                                                                                          |
| **P1**   | News, videos, and member community                                | GolfDogFight exposes dated news, a video area, a round message board, and private contact with the coordinator/pro.                                                                                                            | **Implemented locally:** tenant-scoped dated news/media, round messages, coordinator contact, mobile/web surfaces, audit/idempotency, and force-RLS policies are covered by migration 20260810080031 and 14 pgTAP assertions. A full video host/provider and bulk audience composer are still outside scope.                                                                                                                                                                                                                                                                                                   | Hosted migration and provider/storage configuration remain release gates; keep bulk e-mail/SMS separate from round conversation.                                                                                                                                                                                                                         |
| **P1**   | Hole-level virtual scorecard and personal golf stats              | GolfDogFight documents a virtual scorecard for any golf round, including strokes, putts, fairways hit, greens hit, sand saves, hole comments, and shareable scorecard links.                                                   | **Implemented locally:** an 18-hole personal scorecard, append-only revisions, server-authoritative conflict/idempotency handling, member/admin reads, and personal golf-stat totals are covered by migration 20260810075933 and 23 pgTAP assertions. CSV/PDF reports are authenticated and role-scoped; the public token surface is limited to the kiosk scoreboard.                                                                                                                                                                                                                                          | Hosted migration and browser/device evidence remain; course/par conversion and shareable personal scorecard links are intentionally not invented.                                                                                                                                                                                                        |
| **P1**   | Club/pro information, branding, promotions, and clubhouse display | GolfDogFight captures course/pro/shop information, supports e-mail header/footer assets and sponsor banners, and advertises a real-time scrolling scoreboard suitable for a clubhouse TV or kiosk/tablet.                      | **Partially implemented locally:** tenant-scoped scoreboard branding, token-scoped public rendering, kiosk refresh mode, and portal controls for private Storage upload, server-derived MIME/size, alt/decorative state, click-through, and footer order are covered by migrations 20260810080031 and 20260810120000. Public scoreboard reads issue short-lived signed URLs from the private tenant-prefixed bucket, and the portal previews the selected file before upload. Pro/shop fields, sponsor campaign scheduling, e-mail header/footer controls, and last-connection telemetry remain unimplemented. | Hosted storage policies and final kiosk/browser evidence remain release gates. Keep sponsor campaigns, pro/shop schema, and additional e-mail assets out of scope until their contracts are approved.                                                                                                                                                    |
| **P1**   | Reports, printing, and exports                                    | The legacy reference lists member/contact reports, quota and round history, participant lists, points worksheets, team lists, standings, and a score-pad PDF.                                                                  | **Implemented locally:** tenant-safe CSV and dependency-free PDF report downloads cover members, standings, results, and score-pad output with authenticated role checks, metadata, no-store responses, and audit events. Team worksheets and legacy-specific report layouts remain out of scope with the advanced formats.                                                                                                                                                                                                                                                                                    | Hosted/browser PDF rendering evidence remains; add team worksheets only with executable team rules.                                                                                                                                                                                                                                                      |
| **P1**   | Full mobile/no-install member parity                              | GolfDogFight is web-based, advertises a responsive mobile site, and supports a tablet/kiosk workflow without installing software.                                                                                              | **Improved locally:** member web now includes round detail, RSVP state, read-only round-day handoff messaging, round messages, clubhouse summaries, results/standings, and operational reports; native mobile includes guest/round-day scoring and hole scorecards. No-install member web is intentionally read-only apart from RSVP, exactly as the master spec requires.                                                                                                                                                                                                                                     | Keep score entry and guest management in the native app. Hosted magic-link callback, app-link fallback, and final device/store evidence remain release gates; do not expand the fixed member web into a second scoring surface.                                                                                                                          |
| **P1**   | Legacy-data migration and cutover                                 | GolfDogFight is the incumbent system whose historical members, quotas, rounds, and results are the reason a replacement must be useful on day one.                                                                             | **Staging and review foundation implemented locally:** the profiled CSV upload validates source/target fields and strips sensitive headers/values, fingerprinted jobs are exposed through authenticated upload and safe projection routes, mapping decisions have a strict stale-version/idempotency boundary, and the successor migration scopes crosswalk uniqueness and all create/get/set joins by `import_job_id` (`20260810150000_legacy_import_crosswalk_job_scope`). Production cutover remains blocked because no authorized GolfDogFight export/schema or migration owner/window is present.                                                                                                                                                                                                                                                         | Blocked: legacy import cutover. Need: authorized profiled exports/schema, approved identity matching and reconciliation policy, warning-acknowledgement semantics, and cutover/rollback owner and window.                                                                                                                                                                                   |
| **P2**   | External handicap/provider integration                            | GolfDogFight's documented model stores Handicap ID and handicap values manually.                                                                                                                                               | GHIN and other external integrations are deliberately deferred.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Not a verified GolfDogFight parity gap, but it is a future integration decision if handicap synchronization is expected.                                                                                                                                                                                                                                 |
| **P2**   | Multi-group identity                                              | GolfDogFight's public materials emphasize one group login model; its full cross-group behavior was not verified.                                                                                                               | GreenRoster intentionally limits one identity to one membership in v1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Do not expand this without a product decision; it affects active-group selection, preferences, RLS, and notification routing.                                                                                                                                                                                                                            |

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

### 1. Verify the completed first-run and parity paths (P0/P1)

Organizer signup/bootstrap, the coordinator/native round guest lifecycle,
billing, clubhouse content, scorecards, reports, and member-web round detail
are implemented in the repository. The release gate now needs hosted
migration/provider verification, the approved legal/rate-limit evidence, and
fresh browser/device evidence for the approved surfaces. The invitation path
remains separate and never creates an unscoped member account.

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

### 3. Close the remaining core-loop contracts (P0)

Guest create, withdraw, and sponsored scoring now have server contracts. The
remaining core release decisions are reminder timing/delivery and the explicit
no-install scoring choice. A product that cannot let a member score on the web
still has a material parity gap even when the native scoring path is complete.

### 4. Promote the remaining highest-value parity surfaces (P1)

The next vertical slices, if the replacement target is confirmed, are:

1. approve executable rules for formats, skins, teams, Require Entry, and
   course/par conversion;
2. provide the authorized legacy exports and mapping/cutover decisions;
3. decide whether no-install members may score/manage guests in the browser;
4. configure hosted Stripe, storage, Resend, and deployment environments;
5. add only the remaining approved provider or campaign surfaces (GHIN, SMS,
   sponsor scheduling, or a full video host).

Each slice needs its own server contract, tenant/RLS rules, UI, notifications,
tests, and migration evidence. The current `future-scope.md` text is a useful
requirements archive, not implementation authorization.

## Release implications

Even the current secure core is not ready for unrestricted public launch: the
progress ledger records unresolved Vercel deployment/domain, hosted Stripe,
rollback/restore, provider recovery, legal/store, and final device evidence.
The signup dead end is fixed in source, but hosted verification must precede
launch.
