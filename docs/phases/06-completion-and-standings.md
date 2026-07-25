# Phase 06 — Completion and standings

## Goal

Turn a valid Live round into stable official results, updated quota history, and standings, with a safe correction path.

## Deliverables

- Implement completion readiness with blockers for missing required inputs, unsynced scores, absent snapshots, and nondeterministic rules.
- Calculate official Net or Gross rankings, competition ties, winners, and result snapshots on the server.
- Add the merit and standings group settings this phase consumes: the participation amount, the ordered rank-to-points placement table, and the standings reset date.
- Apply participation, placement, and manual merit as distinct components, with tied players each receiving the full placement amount for their shared rank.
- Update quota history and current quota using the configured method and exact rounding rules.
- Lock scoring, publish official results, update standings, and queue result notifications atomically.
- Implement audited Reopen and recompletion, including generated-merit reversal and quota recomputation.
- Preserve prior result and score revisions for investigation.
- Implement mobile and admin results, standings, personal history, and quota history views.
- Complete the member-web Results and Standings pages without adding scoring or administration routes.

Official results are never edited directly. Corrections go through Reopen, changed inputs, and recompletion.

## Exit criteria

- Completion is blocked whenever a required input or authoritative synchronization is missing.
- Completed scoring is locked and historical snapshots remain stable after later settings changes.
- Reopen reverses generated effects, preserves manual merit, withdraws official state, and recomputes affected quotas.
- Recompletion creates a new retained official result and sends each enabled result notification once.
- Guests appear in round results but never permanent history, quota, rounds played, or standings.
- Results show merit broken into its participation, placement, and manual parts rather than one opaque number.
- An empty placement table awards nothing, so a participation-only group behaves exactly as the legacy product did.
- Mobile, admin, and member web show the same official rankings and explicit ties.

## Master-spec coverage

- Section 6.6 — Completion, publication, and reopen
- Sections 7.4–7.5, 7.9, 8.9–8.12, and 9 — Home recent result, results, history, standings, and merit settings
- Sections 11.5–11.8 — Quota, merit, standings, and readiness rules
- Section 12.1 — Results-published event
- Acceptance scenarios 10, 11, and 13
- Acceptance scenario 18 closes here
