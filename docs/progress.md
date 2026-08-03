# GreenRoster implementation progress

Last updated: August 4, 2026

The [master spec](./master-spec.md) and [phase documents](./phases/README.md) contain detailed requirements and evidence. This file tracks only current state and recent milestones.

## Current focus

- **Phase:** 05 — Live round
- **Active slice:** Authoritative live score reads: tenant-safe roster/projection data, capability exposure, and portal scoreboard wiring.
- **Status:** In progress
- **Next:** Add authenticated actor-derived mobile read/write wrappers, then build the offline queue and Realtime recovery state.
- **Blockers:**
  - Local PostgreSQL verification is blocked: `supabase db reset` cannot reach the Docker daemon from this session. Need: local Docker daemon access for the reset and pgTAP run.
  - Phase 01 needs external re-verification of installed public links and approved legal-content exit evidence.
  - Phase 03 material format, roster, guest, and scoring edits need versioned rule/participant history plus guest/scoring/recipient semantics. The bulk-update allow-list and optional group-profile fields are still unspecified.
  - Phase 04 sponsored guest creation/withdrawal needs the guest-capable participant/revision/score model. Provider delivery, reminders, and deep links remain open.

## Phase status

| Phase | Status | Current state |
| --- | --- | --- |
| [00 — Foundation](./phases/00-foundation.md) | Complete | Foundation, local runtime, and 77 pgTAP assertions verified. Commit `cf76835`. |
| [01 — Identity and group isolation](./phases/01-identity-and-group-isolation.md) | Blocked | Local code/security gates pass; production link and legal-content evidence is still required. |
| [02 — Member onboarding](./phases/02-member-onboarding.md) | Complete | Invitations, membership state, privacy, quota, idempotency, and delivery-failure paths are covered. Commit `93e8308`. |
| [03 — Round setup and publication](./phases/03-round-setup-and-publication.md) | In progress | Drafts, publication, round detail, RSVP/cancellation, and supported Published detail edits are complete; material edits and member UX await later models. |
| [04 — RSVP and guests](./phases/04-rsvp-and-guests.md) | In progress | Member Next round/RSVP, guest permission, notification preferences/devices, and the native notification surface are complete; provider delivery and guest creation remain. |
| [05 — Live round](./phases/05-live-round.md) | In progress | Published → Live transition is complete. Commits `716e7b0` and `4a9aa87` add immutable revisions, current projection, draft field capabilities copied into format-aware snapshots, role/field authority (including portal/member separation), exact replay, stale responses with current values, plus/minus calculation, sponsor guest scoring, and an authoritative live read projection with portal scoreboard wiring. Focused web read tests 5/5, full Vitest 92 files/555 tests, web lint, Prettier, and diff checks pass; local pgTAP verification awaits Docker access. |
| [06 — Completion and standings](./phases/06-completion-and-standings.md) | Not started | Begins after Phase 05 exit criteria pass. |
| [07 — Release hardening](./phases/07-release-hardening.md) | Not started | Begins after Phase 06 exit criteria pass. |

## Recent milestones

| Date | Milestone | Evidence |
| --- | --- | --- |
| August 3, 2026 | Phase 05 Published → Live transition | Commits `902d10e`, `e7c50dc`; focused scoring/cancellation tests and full PostgreSQL, Vitest, build, and browser checks pass. |
| August 3, 2026 | Phase 04 push registration and permission UX | Commit `c5ccbc8`; mobile/config tests, full checks, Expo exports, and responsive browser checks pass. |
| August 3, 2026 | Phase 04 notification preferences and devices | Commit `1c9e0be`; preference/device RPCs, tenant and identity checks, retries, audit, and full verification pass. |
| August 3, 2026 | Phase 04 member Next round and RSVP | Commit `e6a7855`; member projection, RSVP receipt/idempotency, focused database tests, and 390px browser proof pass. |
| August 3, 2026 | Phase 03 publication and detail boundaries | Commits `2dfda55`, `2a3c774`, `c432058`, `0dc885e`, `10f399e`; Draft, publication, detail, RSVP/cancellation, and supported Published-edit contracts pass their documented checks. |
| August 4, 2026 | Phase 05 score/revision contract | Commit `716e7b0`; focused web tests 13/13 and full Vitest 91 files/550 tests pass. The migration and focused pgTAP cover immutable revisions, current projection, server-derived plus/minus/ranking, exact replay, stale current-value details, portal/member separation, draft capability snapshots, role/field authority, and sponsor guest scoring. PostgreSQL execution is blocked by local Docker daemon access. |
| August 4, 2026 | Phase 05 live score read projection | Commit `4a9aa87`; service-only tenant-authorized read RPC, authenticated projection policy/Realtime publication, strict web adapter, and coordinator portal live scorecard distinguish missing from confirmed zero and expose only server-confirmed values. Focused read tests 5/5, full Vitest 92 files/555 tests, web lint, Prettier, and diff checks pass. pgTAP remains blocked by local Docker daemon access. |

Older implementation logs are intentionally omitted; use the linked phase documents and git history for detail.

## Agent update rules

1. Before implementation, set the current phase, active slice, status, next action, and blockers.
2. Use only `Not started`, `In progress`, `Blocked`, or `Complete` for status.
3. Mark a phase Complete only after every exit criterion in its phase document has evidence.
4. After each slice, add one concise Recent milestones entry with verification results and a commit reference when available.
5. If blocked, write `Blocked: <requirement>. Need: <specific missing input>.` Do not claim the affected slice or phase is complete.
6. Keep implementation details in code, tests, or the relevant phase document.
