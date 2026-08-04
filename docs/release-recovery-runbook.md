# GreenRoster release and recovery runbook

This runbook is the operator checklist for the single hosted GreenRoster
environment. It does not authorize a production change by itself. Record the
ticket, operator, UTC timestamps, correlation IDs, and links to provider or
host evidence for every execution.

## Privacy request

1. Confirm the request came through the protected privacy page after a normal
   sign-in. Do not process a request from a password-recovery session.
2. The named privacy owner verifies the request, checks for a legal hold, and
   records approval and the requested data-access or deletion scope in the
   support ticket.
3. If the subject is the last active administrator of any group, transfer the
   administrator role first with the administrator-transfer workflow. Do not
   bypass `privacy_last_active_administrator`.
4. Generate two fresh UUIDs: one correlation ID for the operation trace and one
   opaque operation ID for the idempotency receipt. Invoke the service-only
   `public.anonymize_account_for_privacy` RPC with the approved reason.
5. Verify the returned counts and the redacted audit receipt. Check that the
   identity has no routable e-mail, password, Auth identity, session, refresh
   token, recovery session, provider flow state, or external handicap ID; queued
   delivery work must be cancelled and historical delivery rows must be
   redacted.
6. If the operator loses the response, retry with the same operation ID. A
   successful retry returns the original receipt and must not append a second
   privacy operation. Never retry with a new operation ID unless the first
   transaction definitively rolled back.
7. For data-access requests, use the approved privacy-owner support procedure
   and its access-controlled export location. Do not attach raw contact data to
   application logs, audit rows, or provider tickets.

## Retention job

- Confirm the deployed Vercel cron secret is present and matches the protected
  `/api/jobs/privacy/retention` route.
- Run the job only through the bearer-protected route. Confirm a successful
  response and record the run timestamp and aggregate result in the operations
  log; the route must not expose recipient addresses or provider payloads.
- Verify that naturally expired pending invitations have their linked delivery
  and outbox work cancelled and scrubbed before deletion. Terminal notification
  history is eligible only after the configured 90-day retention window.
- A failed run is retried by the scheduler or operator after the underlying
  error is corrected. Do not widen the deletion cutoff to compensate for a
  missed run.

## Backup restoration

1. Before release, confirm Supabase managed backups and point-in-time recovery
   are enabled for the hosted project; record the provider evidence URL and
   retention setting.
2. Restore a timestamped copy into an isolated recovery project, never over the
   live project. Restrict access to the recovery operators and keep provider
   secrets disabled there.
3. Apply the repository migrations to the recovery copy and run the pinned
   database test suite (`pnpm exec supabase test db --local` against a local
   clone, plus the approved hosted recovery checks). Compare migration version,
   row counts, tenant boundaries, and the latest audit correlation IDs.
4. Record restore duration, verification results, and any data-loss window. A
   restore is not complete until cross-group reads and service-only mutation
   boundaries have been checked.

## Deployment rollback or safe roll-forward

- Release database changes before application code only when every migration is
  additive and compatible with the previous application. Never run an ad-hoc
  down migration against production.
- If the new application fails while the schema remains compatible, roll the
  Vercel deployment back and keep the database at the forward-compatible
  version. Pause destructive jobs until the compatible application is serving.
- If a migration cannot be made backward-compatible, stop the release and use
  the approved backup-restore plan with the incident owner; do not accept writes
  in two database versions.
- After recovery, run the smoke checks, notification drain authorization check,
  privacy-retention authorization check, and the relevant pgTAP acceptance set.
  Record the deployed commit, migration version, rollback or restore timestamp,
  and final health evidence.

## Evidence record

Each launch or recovery ticket must include:

- operator and approving owner;
- hosted project and deployment identifiers;
- migration version before and after;
- correlation and opaque operation IDs for privacy actions;
- backup/PITR and restore evidence;
- provider outage, notification drain, and cron results;
- cross-group/RLS, storage, deep-link, accessibility, and store/legal evidence;
- unresolved risks with an explicit owner and due date.
