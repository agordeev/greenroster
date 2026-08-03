# GreenRoster implementation progress

Last updated: August 4, 2026

The [master spec](./master-spec.md) and [phase documents](./phases/README.md) contain detailed requirements and evidence. This file tracks only current state and recent milestones.

## Current focus

- **Phase:** 05 — Live round
- **Active slice:** Mobile live scoring: actor-derived round discovery, server-confirmed scorecard/leaderboard state, durable native queue, Realtime recovery, and portal score entry.
- **Status:** In progress
- **Next:** Implement the atomic Playing-to-Not Playing workflow and once-per-condition forgotten-round reminder, then verify the Phase 05 exit criteria.
- **Blockers:**
  - The global Homebrew Supabase CLI rejects this repository's older config keys; use the pinned project CLI (`pnpm exec supabase`, v2.109.1) for local reset and pgTAP verification. Docker is healthy and the pinned reset/test path is green.
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
| [05 — Live round](./phases/05-live-round.md) | In progress | Published → Live, immutable revisions, current projection, actor-derived mobile round/read/write boundaries, native offline queue, Realtime recovery, stale current-value handling, server-confirmed mobile scorecard/leaderboard, and portal score entry are complete in commits `716e7b0`, `4a9aa87`, and `2db88cd`. Fresh local verification: pgTAP 46 files/1,779 tests, Vitest 99 files/580 tests, web lint/typecheck/build, mobile typecheck/lint/export, Prettier, diff checks, and auth-gated browser smoke checks. Remaining: atomic Playing → Not Playing and forgotten-round reminder/action-required flow. |
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
| August 4, 2026 | Phase 05 live score read projection | Commit `4a9aa87`; service-only tenant-authorized read RPC, authenticated projection policy/Realtime publication, strict web adapter, and coordinator portal live scorecard distinguish missing from confirmed zero and expose only server-confirmed values. The later pinned local reset and full pgTAP run now cover this migration as part of 46 files/1,779 passing tests. |
| August 4, 2026 | Phase 05 mobile live scoring surfaces | Commit `2db88cd`; actor-derived mobile round discovery and score boundaries, strict mobile API/state adapters, native encrypted FIFO queue with idempotent replay and sign-out warning, Realtime duplicate/gap/reconnect recovery, cold offline snapshot restoration, deterministic confirmed leaderboard ordering, stale current-value UI, upcoming/completed affordance corrections, and portal score entry with retry-stable mutation fingerprints. Fresh local pgTAP 46/1,779, Vitest 99/580, web build, mobile export, lint/typecheck, formatting, and browser smoke checks pass. |

Older implementation logs are intentionally omitted; use the linked phase documents and git history for detail.

## Agent update rules

1. Before implementation, set the current phase, active slice, status, next action, and blockers.
2. Use only `Not started`, `In progress`, `Blocked`, or `Complete` for status.
3. Mark a phase Complete only after every exit criterion in its phase document has evidence.
4. After each slice, add one concise Recent milestones entry with verification results and a commit reference when available.
5. If blocked, write `Blocked: <requirement>. Need: <specific missing input>.` Do not claim the affected slice or phase is complete.
6. Keep implementation details in code, tests, or the relevant phase document.
