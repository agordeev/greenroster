# GreenRoster implementation progress

Last updated: July 25, 2026

This is the live implementation ledger. [`master-spec.md`](./master-spec.md) defines the product, and [`phases/README.md`](./phases/README.md) defines the delivery order.

## Current focus

- **Phase:** 01 — Identity and group isolation
- **Active slice:** Request-bound server identity context and shared mutation pipeline
- **Status:** In progress
- **Next action:** Bind verified Supabase sessions to the server-only group bootstrap, establish the shared error/correlation pipeline, and prove a caller cannot create access for another identity.
- **Blockers:** None.

## Phase status

| Phase                                                                            | Status      | Evidence or next step                                                                                               |
| -------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| [00 — Foundation](./phases/00-foundation.md)                                     | Complete    | Commit `cf76835`; clean CI sequence, PG17 reset/77 pgTAP, browser, iOS, and Android runtime checks pass             |
| [01 — Identity and group isolation](./phases/01-identity-and-group-isolation.md) | In progress | Commit `59f76fb`; identity/group bootstrap, RLS boundaries, append-only audit, and 93 focused pgTAP assertions pass |
| [02 — Member onboarding](./phases/02-member-onboarding.md)                       | Not started | Begins after Phase 01 exit criteria pass                                                                            |
| [03 — Round setup and publication](./phases/03-round-setup-and-publication.md)   | Not started | Begins after Phase 02 exit criteria pass                                                                            |
| [04 — RSVP and guests](./phases/04-rsvp-and-guests.md)                           | Not started | Begins after Phase 03 exit criteria pass                                                                            |
| [05 — Live round](./phases/05-live-round.md)                                     | Not started | Begins after Phase 04 exit criteria pass                                                                            |
| [06 — Completion and standings](./phases/06-completion-and-standings.md)         | Not started | Begins after Phase 05 exit criteria pass                                                                            |
| [07 — Release hardening](./phases/07-release-hardening.md)                       | Not started | Begins after Phase 06 exit criteria pass                                                                            |

## Recent activity

| Date          | Work                                    | Result   | Evidence                                                                                                                                                         |
| ------------- | --------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| July 25, 2026 | Identity and group database contract    | Complete | Commit `59f76fb`; PostgreSQL reset and 170 total pgTAP assertions pass atomic bootstrap/rollback, tenant isolation, revocation, audit, and last-admin invariants |
| July 25, 2026 | Phase 00 exit gate                      | Complete | Commit `cf76835`; clean committed tree passes frozen install, full checks/builds, Supabase start/reset/seed, and all 77 pgTAP assertions; reviews are clean      |
| July 25, 2026 | Cross-target local runtime verification | Complete | Full Supabase stack starts; agent-browser is clean; native iOS and Android builds install, launch, render the Home/Explore UI, and show no crash-level errors    |
| July 25, 2026 | Local Supabase verification             | Complete | PostgreSQL 17 reset applies migrations and the deterministic synthetic seed; all 77 pgTAP assertions pass; schema lint reports no errors                         |
| July 25, 2026 | Foundation database contracts           | Complete | Commit `b26fd21`; exact numeric, UTC, immutable-ID, idempotency, and fixture contracts are covered by PostgreSQL 17 migrations and 77 pgTAP assertions           |
| July 25, 2026 | Web development startup                 | Complete | Agent-browser loads `http://localhost:3000`, finds meaningful content and interactive elements, and reports no error overlay or captured console errors          |
| July 25, 2026 | Fail-fast runtime configuration         | Complete | Eight focused tests pass; web startup exits nonzero with a named missing variable; mobile root import rejects missing or copied-placeholder public config        |
| July 25, 2026 | Local Supabase Docker runtime bootstrap | Blocked  | Docker 28.5.1 is running and the host reaches Docker Hub; `supabase start` and a direct small `docker pull` both stall through Docker Desktop's internal proxy   |
| July 25, 2026 | Initial repository and app workspace    | Complete | `pnpm check` and `pnpm install --frozen-lockfile --offline` pass; Next.js production build and Expo iOS, Android, and web exports pass                           |
| July 25, 2026 | Environment architecture                | Complete | Master spec, tech stack, and phase docs now define one application environment and local Docker runtime                                                          |
| July 25, 2026 | Delivery planning                       | Complete | Eight phase documents and this ledger created under `docs/`                                                                                                      |

## Agent update rules

1. Before implementation, set the current phase, active slice, status, next action, and blockers.
2. Use only `Not started`, `In progress`, `Blocked`, or `Complete` for status.
3. Mark a phase Complete only after every exit criterion in its phase document has evidence.
4. After each slice, update the phase row and add one concise Recent activity entry with verification commands, results, and a commit reference when available.
5. If blocked, write `Blocked: <requirement>. Need: <specific missing input>.` and do not claim the affected slice or phase is complete.
6. Keep this ledger factual and current; implementation details belong in code, tests, or the relevant phase document.
