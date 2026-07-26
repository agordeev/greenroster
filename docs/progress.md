# GreenRoster implementation progress

Last updated: July 26, 2026

This is the live implementation ledger. [`master-spec.md`](./master-spec.md) defines the product, and [`phases/README.md`](./phases/README.md) defines the delivery order.

## Current focus

- **Phase:** 02 — Member onboarding
- **Active slice:** Resend delivery worker and provider feedback
- **Status:** In progress
- **Next action:** Add the idempotent Resend invitation worker with claim/retry state transitions, accessible HTML/plain-text templates, and authenticated bounce/complaint webhook suppression, then verify provider-independent failure and replay paths.
- **Blockers:** Phase 01 remains blocked on Vercel Git access, installed universal/app-link verification, and approved Terms/Privacy contents with canonical versions. These external inputs do not block the current Phase 02 notification-provider foundation.

## Phase status

| Phase                                                                            | Status      | Evidence or next step                                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [00 — Foundation](./phases/00-foundation.md)                                     | Complete    | Commit `cf76835`; clean CI sequence, PG17 reset/77 pgTAP, browser, iOS, and Android runtime checks pass                                                                                                  |
| [01 — Identity and group isolation](./phases/01-identity-and-group-isolation.md) | Blocked     | Commits through `a9247a3`; all local code/security gates pass, while installed public links and approved legal versions require the external inputs listed above                                         |
| [02 — Member onboarding](./phases/02-member-onboarding.md)                       | In progress | Commits through `7822a3d` add quota/member foundations plus atomic single-use invitation issuance, durable outbox/delivery/suppression records, and startup config validation; provider delivery is next |
| [03 — Round setup and publication](./phases/03-round-setup-and-publication.md)   | Not started | Begins after Phase 02 exit criteria pass                                                                                                                                                                 |
| [04 — RSVP and guests](./phases/04-rsvp-and-guests.md)                           | Not started | Begins after Phase 03 exit criteria pass                                                                                                                                                                 |
| [05 — Live round](./phases/05-live-round.md)                                     | Not started | Begins after Phase 04 exit criteria pass                                                                                                                                                                 |
| [06 — Completion and standings](./phases/06-completion-and-standings.md)         | Not started | Begins after Phase 05 exit criteria pass                                                                                                                                                                 |
| [07 — Release hardening](./phases/07-release-hardening.md)                       | Not started | Begins after Phase 06 exit criteria pass                                                                                                                                                                 |

## Recent activity

| Date          | Work                                    | Result   | Evidence                                                                                                                                                                                  |
| ------------- | --------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| July 26, 2026 | Invitation and e-mail outbox foundation | Complete | Commit `7822a3d`; clean PG17 reset, 595 pgTAP, schema lint, 192 unit tests/full builds, startup config validation, token secrecy/idempotency/tenant checks, and clean review              |
| July 26, 2026 | Pending member profile/contact creation | Complete | Commit `061f42f`; clean PG17 reset, 545 pgTAP, 173 unit tests/full builds, private defaults, actor-derived tenant, normalization/idempotency/audit checks, and clean review               |
| July 26, 2026 | Member quota and seed-history boundary  | Complete | Commit `ebb3c15`; clean PG17 reset, 484 pgTAP, 155 unit tests/full builds, exact A/B/C projection provenance, tenant/admin/idempotency/audit checks, and clean review                     |
| July 26, 2026 | Administrator quota settings editor     | Complete | Commits `99b2eb4`/`ba84948`; verified A/C saves and reload, gap blocking, matched-band preview, dirty-loss/a11y guards, 139 tests/full builds, and clean review                           |
| July 26, 2026 | Quota rules and settings foundation     | Complete | Commit `6a808c3`; ordered tenant RLS/RPC migration, exact A/B/C engine, 435 pgTAP/124 unit tests, advisors/lint/full builds/browser smoke, and clean review                               |
| July 26, 2026 | GitHub and Vercel deployment bootstrap  | Blocked  | Published clean `main` to `agordeev/greenroster`; created `andrey-gordeevs-projects/greenroster`; Vercel Git connection is denied until its GitHub application receives repository access |
| July 26, 2026 | Phase 01 external-input re-audit        | Blocked  | Loopback HTTP emits no installed-link entitlements/filters; zero Apple signing identities/team, Android release is debug-signed, legal routes await owner approval; review concurs        |
| July 26, 2026 | Atomic password-recovery finalization   | Complete | Commit `a9247a3`; exact claim command and Auth hash change consume/audit atomically; 395 pgTAP/111 unit tests, clean schema lint, full builds, two live GoTrue paths, and review pass     |
| July 26, 2026 | Tenant isolation and correlation proof  | Complete | Commit `7777bef`; role/state RPC denials and zero Realtime publication pass 347 pgTAP; real local Auth/browser action correlation resolves to exactly one audit row; review clean         |
| July 26, 2026 | Audited administrator role transfer     | Complete | Commit `c4c0e00`; server-derived tenant/role, group-version check, atomic audit, direct-write and RPC retry concurrency pass 338 pgTAP, 110 tests, full web gates, and review             |
| July 26, 2026 | Mobile first-run profile and legal gate | Complete | Commit `13d6bc6`; clean reset/302 pgTAP, 102 unit tests, schema lint, frozen install, lint/typecheck, web/all-platform builds, browser flow, and independent review pass                  |
| July 26, 2026 | Mobile link destination preservation    | Complete | Commit `031494d`; strict allowlist and consume-once resume, 92 tests/full builds/frozen install, generated associations, iOS cold link, browser, and review pass                          |
| July 26, 2026 | Native password recovery and audit      | Complete | Commit `37a7b52`; 262 pgTAP/79 unit tests, lint/typecheck/full builds, live email reset/replay/isolation proof, iOS UI, and focused security review pass                                  |
| July 26, 2026 | Mobile sign-in and recovery request     | Complete | Commit `badbb6c`; standalone Auth boundary, safe sign-in/recovery/sign-out, 62 tests/full builds, frozen install, 390px browser flow, iOS 18 cold launch, and clean review                |
| July 26, 2026 | Mobile secure Auth session foundation   | Complete | Commit `b4400c4`; PKCE, encrypted chunked persistence, durable recovery gating, exact callback, 50 tests/full builds, iOS cold launch, Mailpit redirect, and review pass                  |
| July 26, 2026 | Mobile member destination shell         | Complete | Commit `cf49ff8`; four honest destinations pass responsive browser semantics, iOS build/run visual verification, all-platform Expo export, full checks, and review                        |
| July 26, 2026 | Authoritative onboarding checklist      | Complete | Commit `9a7d71d`; clean PG17 reset and 217 pgTAP; 39 unit tests/full builds; live stored membership changes checklist from 1/4 to 2/4                                                     |
| July 26, 2026 | Authorized responsive portal shell      | Complete | Commit `4e11113`; admin/member/first-run states, support/legal routes, 1280/768 layouts, 600-character group wrap, full checks and 36 tests pass                                          |
| July 26, 2026 | Safe protected-route return locations   | Complete | Commit `250a542`; allowlisted parameter-free portal path survives sign-in; tampered external/query paths fall back safely; focused tests and browser flow pass                            |
| July 26, 2026 | Web Auth, recovery, and admin first run | Complete | Commit `2c641ae`; clean PG17 reset and 204 pgTAP; full `pnpm check`; browser verifies recovery-only sessions, replacement sign-in, and first-run access                                   |
| July 25, 2026 | Verified-session bootstrap boundary     | Complete | Commit `8831e83`; exact-pinned Supabase SSR client, actor-bound server action, safe errors/correlation, live Auth/RPC and browser proxy checks pass                                       |
| July 25, 2026 | Identity and group database contract    | Complete | Commit `59f76fb`; PostgreSQL reset and 170 total pgTAP assertions pass atomic bootstrap/rollback, tenant isolation, revocation, audit, and last-admin invariants                          |
| July 25, 2026 | Phase 00 exit gate                      | Complete | Commit `cf76835`; clean committed tree passes frozen install, full checks/builds, Supabase start/reset/seed, and all 77 pgTAP assertions; reviews are clean                               |
| July 25, 2026 | Cross-target local runtime verification | Complete | Full Supabase stack starts; agent-browser is clean; native iOS and Android builds install, launch, render the Home/Explore UI, and show no crash-level errors                             |
| July 25, 2026 | Local Supabase verification             | Complete | PostgreSQL 17 reset applies migrations and the deterministic synthetic seed; all 77 pgTAP assertions pass; schema lint reports no errors                                                  |
| July 25, 2026 | Foundation database contracts           | Complete | Commit `b26fd21`; exact numeric, UTC, immutable-ID, idempotency, and fixture contracts are covered by PostgreSQL 17 migrations and 77 pgTAP assertions                                    |
| July 25, 2026 | Web development startup                 | Complete | Agent-browser loads `http://localhost:3000`, finds meaningful content and interactive elements, and reports no error overlay or captured console errors                                   |
| July 25, 2026 | Fail-fast runtime configuration         | Complete | Eight focused tests pass; web startup exits nonzero with a named missing variable; mobile root import rejects missing or copied-placeholder public config                                 |
| July 25, 2026 | Local Supabase Docker runtime bootstrap | Blocked  | Docker 28.5.1 is running and the host reaches Docker Hub; `supabase start` and a direct small `docker pull` both stall through Docker Desktop's internal proxy                            |
| July 25, 2026 | Initial repository and app workspace    | Complete | `pnpm check` and `pnpm install --frozen-lockfile --offline` pass; Next.js production build and Expo iOS, Android, and web exports pass                                                    |
| July 25, 2026 | Environment architecture                | Complete | Master spec, tech stack, and phase docs now define one application environment and local Docker runtime                                                                                   |
| July 25, 2026 | Delivery planning                       | Complete | Eight phase documents and this ledger created under `docs/`                                                                                                                               |

## Agent update rules

1. Before implementation, set the current phase, active slice, status, next action, and blockers.
2. Use only `Not started`, `In progress`, `Blocked`, or `Complete` for status.
3. Mark a phase Complete only after every exit criterion in its phase document has evidence.
4. After each slice, update the phase row and add one concise Recent activity entry with verification commands, results, and a commit reference when available.
5. If blocked, write `Blocked: <requirement>. Need: <specific missing input>.` and do not claim the affected slice or phase is complete.
6. Keep this ledger factual and current; implementation details belong in code, tests, or the relevant phase document.
