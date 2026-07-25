# Phase 07 — Release hardening

## Goal

Prove the complete v1 loop is secure, accessible, resilient, observable, and ready for controlled release.

## Deliverables

- Run the complete behavioral suite on iOS and Android and the full web suite on supported browsers.
- Complete quiet-hours deferral, retry and backoff, provider-outage recovery, and notification delivery monitoring on top of the preferences and channels earlier phases delivered.
- Verify all transactional e-mail and push events against their required audiences and channels, including that a provider outage delays messages without blocking the business action or losing it.
- Verify the sending domain's SPF, DKIM, and DMARC configuration and that optional-category e-mail carries a working path to preferences.
- Complete keyboard, VoiceOver, TalkBack, zoom, contrast, dynamic type, and reduced-motion checks.
- Exercise realtime reconnect, offline scoring, stale rejection, and at least one real-device poor-connectivity scenario.
- Complete privacy-safe metrics, operational dashboards, and alerts on top of the correlation identifiers established in Phase 01.
- Verify the scheduled reminder job is safe after a missed run, a late run, and a duplicate run.
- Measure the specified latency targets and fix material regressions without adding speculative infrastructure.
- Verify security headers, CORS, CSRF protection, rate limits, dependency scanning, RLS, storage, and deep-link authorization.
- Configure the single hosted environment and verify application identifiers and provider secrets.
- Test backup restoration and a database-compatible deployment rollback or safe roll-forward.
- Verify the in-app account deletion and data access path, retention behavior, and that store privacy declarations match what notifications actually use contact data for.
- Verify Terms and Privacy approval and store-submission privacy declarations before production release.

This phase hardens completed behavior; it does not introduce billing, messaging, branding, GHIN, advanced formats, SMS, multi-group membership, or other future scope.

## Exit criteria

- All 22 acceptance scenarios pass with recorded automated or manual evidence.
- Cross-group read, mutation, subscription, storage, cache, and deep-link attacks fail without leaking existence.
- Required notifications survive retry and provider downtime without duplication or business-action loss.
- Core flows pass the approved accessibility checklist on both mobile platforms and web.
- Observability can trace a user-visible failure by correlation identifier without exposing prohibited data.
- Restore and deployment recovery procedures have been executed successfully before launch.
- No deferred endpoint or control is present in the release build.

## Master-spec coverage

- Sections 7.12 and 8.14 — Mobile and web accessibility and resilience
- Sections 12.2–12.4 — Delivery rules, reminder resilience, and channel configuration
- Sections 14–17 — Realtime, service behavior, security, privacy, and non-functional requirements
- Section 18 — Testing and acceptance
- Acceptance scenarios 20, 21, and 22
- Acceptance scenario 17 closes here
- Final regression of acceptance scenarios 1–22
