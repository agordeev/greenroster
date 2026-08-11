# GreenRoster manual acceptance checklist

Use this checklist against a deployed preview first, then repeat the same
checks against production after the rollback window is approved. Use synthetic
accounts and groups only.

## Test setup

Create:

- Group A with one administrator, one coordinator, two members, and one member
  who can sponsor a guest.
- Group B with one administrator and one member.
- A second browser profile or private window for each person.
- One iOS or Android build and one desktop browser.
- A disposable mailbox for each account. Keep the Auth redirect, OTP expiry,
  rate-limit, Resend, Expo, and Stripe sandbox settings visible to the tester.

Record the deployment URL, build commit, account e-mail aliases, group names,
operation IDs, and screenshots for every pass or failure. Never paste service
role keys, raw tokens, passwords, or magic-link fragments into the evidence.

## Core acceptance flow

| Scenario                        | Action                                                                                                                                           | Expected result                                                                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Organizer signup             | Open `/sign-up` before legal documents are configured. Then configure approved Terms and Privacy versions and repeat.                            | Before approval, you see the Terms and Privacy links and no account form. After approval, you can create one organizer account, verify the e-mail, finish the group setup, and retry the callback without creating a second group. |
| 2. Invitation                   | Invite a member from Group A, accept in a separate browser, then retry the same invite.                                                          | You join Group A once; the second use is rejected without exposing another group.                                                                                                                                                  |
| 3. Draft and publication        | Create a draft, inspect it as a member, publish it, and repeat Publish.                                                                          | Members cannot see the draft. Publication creates one participant set, one snapshot, and one notification set. Repeating Publish is idempotent.                                                                                    |
| 4. Round edits/cancellation     | Change an allowed published detail, announce it, then cancel with a reason.                                                                      | The impact summary is explicit, history remains readable, cancelled rounds reject RSVP and scoring, and the required notification is created once.                                                                                 |
| 5. RSVP                         | Respond Playing and Not Playing from mobile and member web, including a stale retry and a declined push permission.                              | Both clients show the same server state, timestamp, source, and counts. A stale or duplicate request never overwrites the newer response.                                                                                          |
| 6. Guest lifecycle              | Add, edit, score, and withdraw a sponsored guest. Repeat with a coordinator, an inactive sponsor, and a Group B user.                            | Sponsor/coordinator rules are enforced; withdrawn history is retained; foreign and inactive actors receive a neutral denial.                                                                                                       |
| 7. Open scoring                 | Open a published round as coordinator, then try as a member.                                                                                     | Only the authorized coordinator/admin action opens scoring and the Playing participants receive the scoring event.                                                                                                                 |
| 8. Live score                   | Enter a score as the participant and correct it as coordinator.                                                                                  | The server computes plus/minus and ranking; the live view updates without accepting client-authored totals.                                                                                                                        |
| 9. Offline/stale score          | Queue a mobile score offline, restart the app, then submit a stale revision.                                                                     | The queue survives restart, the server confirms once, and stale edits show the current value instead of overwriting it.                                                                                                            |
| 10. Completion                  | Complete a ready round, then attempt completion with a missing score or unsynced queue.                                                          | Readiness blocks incomplete input. A successful completion locks scores and publishes one official result.                                                                                                                         |
| 11. Reopen/recomplete           | Reopen, change a score, and complete again.                                                                                                      | Generated quota/merit effects reverse and recompute; manual merit remains; prior results and revisions remain inspectable.                                                                                                         |
| 12. Playing-to-Not Playing      | Remove a participant after scoring opens.                                                                                                        | The mutation is authorized, audited, and invalidates only the participant's score as specified.                                                                                                                                    |
| 13. Results/standings           | Compare mobile, admin, and member-web results and standings.                                                                                     | Rankings, ties, names, quota history, and guest exclusion match across all three views.                                                                                                                                            |
| 14. Coordinator correction      | Correct another Playing participant's score with a reason; attempt the same from a member.                                                       | The coordinator action is audited and accepted; the member action is denied.                                                                                                                                                       |
| 15. Realtime recovery           | Disconnect the browser during a score update, reconnect, and refresh.                                                                            | The client recovers from a server snapshot and visibly distinguishes stale/offline data.                                                                                                                                           |
| 16. Forgotten live round        | Leave a Live round past the approved reminder threshold.                                                                                         | One reminder appears with the missing-score count and remains actionable until completion or cancellation.                                                                                                                         |
| 17. Notifications/inbox         | Publish, announce, cancel, and publish results with e-mail, push, and optional preferences varied.                                               | Mandatory channels remain enabled; optional channels follow preferences; inbox receipts and retries are idempotent.                                                                                                                |
| 18. Results magic link          | Open the results e-mail link in a new browser, inspect the fragment, submit the callback, reuse it, and wait past expiry.                        | The exact result destination opens after a normal session; the fragment is not sent in the callback request; reuse and expiry are denied and rotation is required.                                                                 |
| 19. Member import               | Upload a small approved member CSV, inspect exceptions, retry with the same operation, and try a foreign group.                                  | The upload is tenant-scoped, sensitive headers are rejected/redacted, retries converge, and foreign access is denied.                                                                                                              |
| 20. Tenant/deep-link boundary   | Replace every Group A URL/round/member/token with Group B identifiers and try expired scoreboard/magic-link values.                              | No protected data or existence signal crosses groups; expired and malformed values return the neutral error state.                                                                                                                 |
| 21. Deferred-scope boundary     | Search the portal, mobile app, and public RPC routes for teams, skins, scramble, Require Entry, SMS, GHIN, and active-group switching.           | No controls or public endpoints imply these deferred capabilities.                                                                                                                                                                 |
| 22. Accessibility/public routes | At desktop and 375×812, open `/sign-in`, `/privacy`, `/terms`, and signed-out protected routes. Use keyboard Tab/Enter and a screen reader pass. | Public content is readable, the skip link reaches the main content, labels and focus order are usable, and protected routes redirect without leaking data.                                                                         |

## Approved parity expansion checks

Run these after the core flow succeeds:

1. **Announcements and clubhouse:** publish dated news/media, post a round
   message, send coordinator contact, read the inbox, and verify read receipts
   from both groups. Inactive or disabled users must lose access on the next
   request.
2. **Scoreboard and branding:** issue a short-lived scoreboard token, open the
   anonymous URL, revoke it, let it expire, and verify only public group/round
   identity and public scores are shown. Upload, replace, and remove a valid
   image; verify the private tenant-prefixed Storage path and signed URL.
3. **Hole scorecard and reports:** enter strokes, putts, fairways, greens, sand
   saves, and comments for several holes; revise one with a stale version;
   compare personal statistics and download the authorized CSV/PDF reports.
4. **Billing:** in Stripe sandbox, exercise checkout, portal, webhook replay,
   entitlement expiry, and member/admin visibility. Do not run this against a
   live price or customer until the payer and seat policy is approved.
5. **Legacy import:** use a synthetic CSV and approved profile only. Verify
   profile-aware replay, cursor pagination, crosswalk scoping, mismatched
   operation rejection, and the 4 MiB upload limit. Do not perform production
   cutover without an authorized GolfDogFight export and rollback owner.

## Evidence and stop conditions

For each scenario, save the deployment URL, timestamp, account role, group,
operation/correlation ID, expected result, observed result, and a screenshot or
sanitized response. Stop the run immediately if you see cross-group data,
service-role credentials in a browser request, a score accepted before server
confirmation, a duplicate notification, or a private Storage object exposed
without a signed URL.
