# GreenRoster v1 implementation phases

These phases turn the core product loop into an ordered delivery plan:

`Invitation → RSVP → scoring → leaderboard → completion → results → quota and standings`

[`master-spec.md`](../master-spec.md) remains authoritative for product behavior and acceptance. [`tech-stack.md`](../tech-stack.md) remains authoritative for technology. [`future-scope.md`](../future-scope.md) is reference material only and creates no v1 work.

Live implementation status, evidence, and the next action are tracked in [`progress.md`](../progress.md). Agents update that ledger as slices begin, complete, or become blocked.

## Phases

| Phase                                                                     | Outcome                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [00 — Foundation](./00-foundation.md)                                     | A runnable repository with local development and CI                |
| [01 — Identity and group isolation](./01-identity-and-group-isolation.md) | Secure authentication, tenancy, roles, and group onboarding        |
| [02 — Member onboarding](./02-member-onboarding.md)                       | Members can be invited, accepted, managed, and configured          |
| [03 — Round setup and publication](./03-round-setup-and-publication.md)   | A coordinator can create and publish a round exactly once          |
| [04 — RSVP and guests](./04-rsvp-and-guests.md)                           | Members can respond and add eligible round-scoped guests           |
| [05 — Live round](./05-live-round.md)                                     | Authorized scoring drives a realtime leaderboard                   |
| [06 — Completion and standings](./06-completion-and-standings.md)         | Rounds produce stable results, quotas, history, and standings      |
| [07 — Release hardening](./07-release-hardening.md)                       | The full v1 loop is secure, accessible, observable, and releasable |

## Cross-cutting requirements

Five parts of the specification are not phases because they apply to every slice from the first one. They are listed here once instead of being repeated in eight files, and they are review criteria in every phase:

| Requirement                 | Master-spec | Obligation                                                                                                                                                                                                            |
| --------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared screen states        | 2.4         | Every data screen implements loading, first-use empty, filtered-empty, error with retry, permission-denied, stale/offline where applicable, success confirmation, unsaved-change protection, and disabled/busy states |
| Domain invariants           | 5.2         | No slice may violate an invariant, and each one gains a test the first time a slice can break it                                                                                                                      |
| Logical data model          | 13          | Schema work conforms to the stated entities, relationships, and data rules; exact numeric types, UTC storage, and idempotency keys are not revisited later                                                            |
| Service pipeline and errors | 15          | Every protected mutation follows the same authenticate, resolve, authorize, validate, version, execute, commit-with-audit sequence, and returns errors from the defined taxonomy                                      |
| Accessibility               | 7.12, 8.14  | Each screen is built keyboard- and screen-reader-operable, with state never conveyed by color alone. Phase 07 verifies this across the product; it cannot repair a product that ignored it                            |

## Surfaces that grow across phases

Three surfaces are assembled incrementally. Building them fully in the phase that first touches them would mean building controls for data that does not exist yet, so each phase adds only the parts its own feature needs:

| Surface               | Growth                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admin dashboard (8.3) | Membership counts in Phase 02, round cards in Phase 03, live-round and action-required exceptions in Phase 05, standings and results summary in Phase 06                                   |
| Mobile Home (7.4)     | Shell and empty states in Phase 01, next round and RSVP in Phase 04, live-round card and action-required items in Phase 05, recent result and quota summary in Phase 06                    |
| Group settings (8.11) | Quota method, precision, Method C bands, and initial-quota behavior in Phase 02, guest permission in Phase 04, participation and placement merit plus the standings reset date in Phase 06 |

## Notification ownership

Each event in Section 12.1 belongs to the phase that owns the business action generating it, so no event is left without a sender:

| Event                                                   | Phase |
| ------------------------------------------------------- | ----- |
| Membership invitation, and its delivery failure         | 02    |
| Role granted or revoked                                 | 02    |
| Round published, round details changed, round cancelled | 03    |
| RSVP reminder                                           | 04    |
| Scoring opened                                          | 05    |
| Round awaiting completion                               | 05    |
| Results published                                       | 06    |

Phase 02 introduces the outbox, delivery records, and e-mail suppression for invitation e-mail. Phase 04 introduces push device registration and member notification preferences. Phase 07 completes quiet hours, retry and provider-outage behavior, and delivery monitoring.

## Working loop

Within each phase, complete one acceptance scenario or similarly small vertical slice at a time:

1. Cite the relevant master-spec sections and define the expected evidence.
2. Implement the smallest end-to-end slice, including data, server behavior, authorization, and affected UI.
3. Run formatting, type-checking, focused tests, integration tests, and affected builds.
4. Review the cross-cutting requirements above, plus idempotency and v1 scope boundaries, wherever the slice touches them.
5. Commit only when the slice is green. Close the phase only when every exit criterion is proven.

Business rules stay server-authoritative. Clients never become alternate rule engines, and deferred features are not introduced while completing a phase.
