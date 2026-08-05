# Accessibility release checklist

Status: draft evidence template — owner approval and device evidence are still required.

This checklist is the release artifact for acceptance scenario 22. It is derived from [master-spec.md](./master-spec.md) sections 7.12, 8.14, 9, and 18.1, plus Phase 07. It adds no product behavior or conformance claim.

## Sign-off

| Field                          | Value                           |
| ------------------------------ | ------------------------------- |
| Product/release                | GreenRoster v1                  |
| Accessibility owner            | _Pending assignment_            |
| Product owner approval         | _Pending_                       |
| Web browser/device matrix      | _Pending_                       |
| iOS device/OS and VoiceOver    | _Pending_                       |
| Android device/OS and TalkBack | _Pending_                       |
| Evidence location              | _Pending links or artifact IDs_ |
| Open defects / disposition     | _Pending_                       |

The owner must record the tested browser, operating-system version, viewport or text-size setting, result, and evidence link for every row. “Not run” is not a passing result.

## Shared interaction checks

Run these checks on each listed core flow:

- Every interactive element has a meaningful name, value, state, and hint where applicable.
- Keyboard focus is visible, follows a logical order, and is never unexpectedly trapped. Web dialogs intentionally trap focus, announce their title, close with Escape where safe, and return focus to the invoking control; mobile modals use the platform's equivalent semantics.
- Headings and landmarks are ordered; a skip-to-main-content path is available on web.
- Validation, busy, success, permission-denied, stale/offline, and error-with-retry states are announced and are not conveyed by color alone.
- Text remains readable and controls remain operable at 200% web resize and the approved mobile text-size/Dynamic Type settings.
- Contrast is sufficient for text, controls, focus indicators, and status information; status is not color-only.
- Reduced-motion settings are respected; realtime rank updates do not steal focus or move an actively focused row.
- Touch targets meet the documented platform guidance where feasible: 44×44 points on iOS and 48×48 density-independent pixels on Android.

For mobile rows, mark hardware-keyboard navigation N/A when unavailable; still verify input order, first-invalid focus, assistive focus restoration, and touch targets.

## Core flow matrix

| Surface and flow                                                   | Keyboard / focus | Screen reader | Resize / text size | Contrast / status | Reduced motion | Result / evidence |
| ------------------------------------------------------------------ | ---------------- | ------------- | ------------------ | ----------------- | -------------- | ----------------- |
| Web sign-in, recovery, invitation, first-run, and legal acceptance | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| Web admin portal shell and dashboard                               | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| Web admin round setup, live operations, and leaderboard            | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| Web member Home / RSVP                                             | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| Web member Results                                                 | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| Web member Standings                                               | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| iOS sign-in, Home, and Profile                                     | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| iOS round detail / RSVP (guest rows only where enabled)            | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| iOS Live scoring, stale rejection, and offline state               | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| iOS live leaderboard and realtime update review                    | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| iOS Results and Standings                                          | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| Android sign-in, Home, and Profile                                 | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| Android round detail / RSVP (guest rows only where enabled)        | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| Android Live scoring, stale rejection, and offline state           | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| Android live leaderboard and realtime update review                | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |
| Android Results and Standings                                      | [ ]              | [ ]           | [ ]                | [ ]               | [ ]            | _Pending_         |

## Evidence notes

- Existing public web smoke evidence is recorded in `docs/progress.md`, but it is not a substitute for this device and assistive-technology sign-off.
- Fresh local browser smoke (August 5, 2026) observed `/sign-in`, `/privacy`, and `/terms` rendering meaningful content and labeled interactive controls without a Next.js error overlay. The public legal pages exposed a skip-to-main-content link and privacy/support links. At both the default desktop viewport and 375×812 CSS pixels, sign-in Tab order reached the e-mail field, password visibility control, password field, submit button, and recovery link. A signed-out `/account/privacy` request redirected to `/sign-in?next=%2Faccount%2Fprivacy`. This is observable web smoke evidence only; it does not satisfy owner, device, screen-reader, resize/text-size, contrast, reduced-motion, or mobile sign-off.
- Relevant implementation surfaces include `apps/web/src/app/portal/portal-shell.tsx`, `apps/web/src/app/portal/page.tsx`, `apps/web/src/app/member/{home,results,standings}/page.tsx`, and the mobile Home, live-round, standings, official-result, profile, auth, and tab-shell components.
- Automated tests can supplement, but cannot replace, VoiceOver/TalkBack, resize/text-size, contrast, and reduced-motion evidence.
