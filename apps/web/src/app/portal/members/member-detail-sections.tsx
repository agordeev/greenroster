import Link from "next/link";

import type {
  MemberDetailActivity,
  MemberDetailDelivery,
  MemberDetailHandicap,
  MemberDetailInvitation,
  MemberDetailProjection,
  MemberDetailQuotaHistory,
} from "@/lib/memberships/member-detail";

export type MemberDetailSectionsProps = Readonly<{
  projection: MemberDetailProjection;
  timeZone?: string;
}>;

/**
 * Render the read-only portions of a member detail view.
 *
 * The projection is already authorized and tenant-scoped by the server. This
 * component intentionally does not derive missing history or expose any
 * mutation controls; pending-invitation management remains in its own route.
 */
export function MemberDetailSections({
  projection,
  timeZone,
}: MemberDetailSectionsProps) {
  const currentHandicap = currentMemberHandicap(projection.handicaps);
  const administratorQuota =
    projection.actorRole === "administrator"
      ? projection.quota.administratorDetails
      : null;

  return (
    <section
      className="mt-8 grid max-w-184 gap-8"
      aria-labelledby="member-detail-sections-title"
    >
      <h2 className="sr-only" id="member-detail-sections-title">
        History
      </h2>

      <DetailSection title="Account" id="member-detail-account">
        <dl
          className="mx-0 mt-4 mb-0 grid grid-cols-2 gap-y-[0.8rem] gap-x-4 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:leading-[1.45] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase"
          data-slot="member-detail-definition-list"
        >
          <Definition label="Account e-mail">
            {projection.accountEmail ??
              "This member hasn't created an account yet."}
          </Definition>
        </dl>
      </DetailSection>

      <DetailSection title="Invitations" id="member-detail-invitations">
        {projection.invitations.length === 0 ? (
          <EmptyState>No invitations for this member yet.</EmptyState>
        ) : (
          <>
            {hasPendingInvitation(projection.invitations) ? (
              <p className="py-[0.8rem] px-4 border-l-[0.25rem] bg-card [&_a]:text-primary [&_a]:font-bold [&_a]:underline-offset-[0.2em]">
                <Link href="/portal/invitations">
                  Manage pending invitations
                </Link>
              </p>
            ) : null}
            <ol className="mx-0 mt-4 mb-0 p-0 gap-3 grid list-none">
              {projection.invitations.map((invitation) => (
                <InvitationRecord
                  key={invitation.invitationId}
                  invitation={invitation}
                  timeZone={timeZone}
                />
              ))}
            </ol>
          </>
        )}
      </DetailSection>

      <DetailSection title="Notifications" id="member-detail-deliveries">
        {projection.deliveries.length === 0 ? (
          <EmptyState>No notifications for this member yet.</EmptyState>
        ) : (
          <ol className="mx-0 mt-4 mb-0 p-0 gap-3 grid list-none">
            {projection.deliveries.map((delivery) => (
              <DeliveryRecord
                key={delivery.deliveryId}
                delivery={delivery}
                timeZone={timeZone}
              />
            ))}
          </ol>
        )}
      </DetailSection>

      <DetailSection title="Quota" id="member-detail-quota">
        <dl
          className="mx-0 mt-4 mb-0 grid grid-cols-2 gap-y-[0.8rem] gap-x-4 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:leading-[1.45] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase"
          data-slot="member-detail-definition-list"
        >
          <Definition label="Current quota">
            {projection.quota.projectedQuota ?? "Not available yet"}
          </Definition>
          <Definition label="Readiness">
            {projection.quota.projectionReady ? "Ready" : "Needs more history"}
          </Definition>
          <Definition label="Based on">
            {formatQuotaProvenance(projection.quota.projectionSource)}
          </Definition>
          <Definition label="In effect since">
            {projection.quota.projectionEffectiveAt ? (
              <Timestamp
                value={projection.quota.projectionEffectiveAt}
                timeZone={timeZone}
              />
            ) : (
              "Not set yet"
            )}
          </Definition>
        </dl>

        <h4 className="mx-0 mt-[0.35rem] mb-0 font-semibold">Quota history</h4>
        {projection.quota.history.length === 0 ? (
          <EmptyState>No quota changes yet.</EmptyState>
        ) : (
          <ol className="mx-0 mt-4 mb-0 p-0 gap-3 grid list-none">
            {projection.quota.history.map((entry) => (
              <QuotaHistoryRecord
                key={entry.eventId}
                entry={entry}
                showAdministratorDetails={
                  projection.actorRole === "administrator"
                }
                timeZone={timeZone}
              />
            ))}
          </ol>
        )}

        {administratorQuota ? (
          <AdministratorQuotaDetails details={administratorQuota} />
        ) : projection.actorRole === "coordinator" ? (
          <p className="py-[0.8rem] px-4 border-l-[0.25rem] bg-card">
            Only administrators can see how this quota was set up.
          </p>
        ) : (
          <EmptyState>We couldn&apos;t load the quota setup.</EmptyState>
        )}
      </DetailSection>

      <DetailSection title="Handicap" id="member-detail-handicap">
        {currentHandicap ? (
          <>
            <dl
              className="mx-0 mt-4 mb-0 grid grid-cols-2 gap-y-[0.8rem] gap-x-4 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:leading-[1.45] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase"
              data-slot="member-detail-definition-list"
            >
              <Definition label="Current handicap">
                {currentHandicap.handicap}
              </Definition>
              <Definition label="Source">
                {formatHandicapSource(currentHandicap.source)}
              </Definition>
              <Definition label="As of">
                <Timestamp
                  value={currentHandicap.asOf}
                  timeZone={timeZone}
                  dateOnly
                />
              </Definition>
            </dl>
            <h3 className="mx-0 mt-[0.35rem] mb-0 font-semibold">
              Handicap history
            </h3>
            <ol className="mx-0 mt-4 mb-0 p-0 gap-3 grid list-none">
              {projection.handicaps.map((handicap) => (
                <HandicapRecord
                  key={handicap.recordId}
                  handicap={handicap}
                  timeZone={timeZone}
                />
              ))}
            </ol>
          </>
        ) : (
          <EmptyState>No handicap history yet.</EmptyState>
        )}
      </DetailSection>

      <DetailSection title="Member activity" id="member-detail-activity">
        {projection.activity.length === 0 ? (
          <EmptyState>No activity yet.</EmptyState>
        ) : (
          <ol className="mx-0 mt-4 mb-0 p-0 gap-3 grid list-none">
            {projection.activity.map((activity) => (
              <ActivityRecord
                key={activity.eventId}
                activity={activity}
                timeZone={timeZone}
              />
            ))}
          </ol>
        )}
      </DetailSection>
    </section>
  );
}

function DetailSection({
  children,
  id,
  title,
}: Readonly<{
  children: React.ReactNode;
  id: string;
  title: string;
}>) {
  return (
    <section
      className="border-t pt-6 first-of-type:border-t-0 first-of-type:pt-0 [&_h3]:m-0 [&_h3]:font-semibold [&_h3]:text-[1.125rem] [&_h4]:mx-0 [&_h4]:mt-[0.35rem] [&_h4]:mb-0 [&_h4]:[font-family:var(--font-sans)] [&_h4]:text-[0.875rem] [&_h4]:font-bold"
      aria-labelledby={id}
    >
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

function Definition({
  children,
  label,
}: Readonly<{ children: React.ReactNode; label: string }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function EmptyState({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p className="py-[0.8rem] px-4 border-l-[0.25rem] bg-card">{children}</p>
  );
}

function Timestamp({
  dateOnly = false,
  timeZone,
  value,
}: Readonly<{
  dateOnly?: boolean;
  timeZone?: string;
  value: string;
}>) {
  return (
    <time dateTime={value}>
      {dateOnly
        ? formatMemberDetailDate(value, timeZone)
        : formatMemberDetailTimestamp(value, timeZone)}
    </time>
  );
}

function InvitationRecord({
  invitation,
  timeZone,
}: Readonly<{ invitation: MemberDetailInvitation; timeZone?: string }>) {
  return (
    <li>
      <article className="rounded-lg border p-4 [&_h4]:mt-0!">
        <h4>{formatInvitationStatus(invitation.status)}</h4>
        <dl
          className="mx-0 mt-4 mb-0 grid grid-cols-2 gap-y-[0.8rem] gap-x-4 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:leading-[1.45] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase"
          data-slot="member-detail-definition-list"
        >
          <Definition label="Invited e-mail">
            {invitation.invitedEmail}
          </Definition>
          <Definition label="Role">{formatRole(invitation.role)}</Definition>
          <Definition label="Issued">
            <Timestamp value={invitation.issuedAt} timeZone={timeZone} />
          </Definition>
          <Definition label="Expires">
            <Timestamp value={invitation.expiresAt} timeZone={timeZone} />
          </Definition>
          {invitation.acceptedAt ? (
            <Definition label="Accepted">
              <Timestamp value={invitation.acceptedAt} timeZone={timeZone} />
            </Definition>
          ) : null}
          {invitation.revokedAt ? (
            <Definition label="Revoked">
              <Timestamp value={invitation.revokedAt} timeZone={timeZone} />
            </Definition>
          ) : null}
          {invitation.expiredAt ? (
            <Definition label="Expired">
              <Timestamp value={invitation.expiredAt} timeZone={timeZone} />
            </Definition>
          ) : null}
        </dl>
      </article>
    </li>
  );
}

function DeliveryRecord({
  delivery,
  timeZone,
}: Readonly<{ delivery: MemberDetailDelivery; timeZone?: string }>) {
  return (
    <li>
      <article className="rounded-lg border p-4 [&_h4]:mt-0!">
        <h4>{formatMemberDetailDeliveryState(delivery)}</h4>
        <dl
          className="mx-0 mt-4 mb-0 grid grid-cols-2 gap-y-[0.8rem] gap-x-4 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:leading-[1.45] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase"
          data-slot="member-detail-definition-list"
        >
          <Definition label="Event">
            {formatEventType(delivery.eventType)}
          </Definition>
          <Definition label="Recipient">{delivery.recipientAddress}</Definition>
          <Definition label="Channel">{delivery.channel}</Definition>
          <Definition label="Created">
            <Timestamp value={delivery.createdAt} timeZone={timeZone} />
          </Definition>
          <Definition label="Updated">
            <Timestamp value={delivery.updatedAt} timeZone={timeZone} />
          </Definition>
          {delivery.sentAt ? (
            <Definition label="Sent">
              <Timestamp value={delivery.sentAt} timeZone={timeZone} />
            </Definition>
          ) : null}
          {delivery.failureReason ? (
            <Definition label="Why it failed">
              {delivery.failureReason}
            </Definition>
          ) : null}
          {delivery.suppressionReason ? (
            <Definition label="Why not sent">
              {formatSuppressionReason(delivery.suppressionReason)}
            </Definition>
          ) : null}
        </dl>
      </article>
    </li>
  );
}

function HandicapRecord({
  handicap,
  timeZone,
}: Readonly<{ handicap: MemberDetailHandicap; timeZone?: string }>) {
  return (
    <li>
      <article className="rounded-lg border p-4 [&_h4]:mt-0!">
        <h4>{handicap.handicap}</h4>
        <dl
          className="mx-0 mt-4 mb-0 grid grid-cols-2 gap-y-[0.8rem] gap-x-4 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:leading-[1.45] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase"
          data-slot="member-detail-definition-list"
        >
          <Definition label="Source">
            {formatHandicapSource(handicap.source)}
          </Definition>
          <Definition label="As of">
            <Timestamp value={handicap.asOf} timeZone={timeZone} dateOnly />
          </Definition>
          <Definition label="Recorded">
            <Timestamp value={handicap.createdAt} timeZone={timeZone} />
          </Definition>
          {handicap.handicapId ? (
            <Definition label="Handicap ID">{handicap.handicapId}</Definition>
          ) : null}
        </dl>
      </article>
    </li>
  );
}

function QuotaHistoryRecord({
  entry,
  showAdministratorDetails,
  timeZone,
}: Readonly<{
  entry: MemberDetailQuotaHistory;
  showAdministratorDetails: boolean;
  timeZone?: string;
}>) {
  return (
    <li>
      <article className="rounded-lg border p-4 [&_h4]:mt-0!">
        <h4>
          {entry.projectedQuota === null
            ? "Quota not available yet"
            : `Quota ${entry.projectedQuota}`}
        </h4>
        <dl
          className="mx-0 mt-4 mb-0 grid grid-cols-2 gap-y-[0.8rem] gap-x-4 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:leading-[1.45] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase"
          data-slot="member-detail-definition-list"
        >
          <Definition label="Readiness">
            {entry.projectionReady ? "Ready" : "Needs more history"}
          </Definition>
          <Definition label="Based on">
            {formatQuotaProvenance(entry.projectionSource)}
          </Definition>
          <Definition label="Changed">
            <Timestamp value={entry.occurredAt} timeZone={timeZone} />
          </Definition>
          <Definition label="Source">{entry.source}</Definition>
          {entry.reason ? (
            <Definition label="Reason">{entry.reason}</Definition>
          ) : null}
          {showAdministratorDetails && entry.administratorDetails ? (
            <Definition label="Quota setup">
              Starting quota:{" "}
              {entry.administratorDetails.initialQuota ?? "none"};{" "}
              {entry.administratorDetails.usesInitialQuota
                ? "starting quota in use"
                : "starting quota not in use"}
              ; {entry.administratorDetails.seedTotals.length} seed total
              {entry.administratorDetails.seedTotals.length === 1 ? "" : "s"}
            </Definition>
          ) : null}
        </dl>
      </article>
    </li>
  );
}

function ActivityRecord({
  activity,
  timeZone,
}: Readonly<{ activity: MemberDetailActivity; timeZone?: string }>) {
  return (
    <li>
      <article className="rounded-lg border p-4 [&_h4]:mt-0!">
        <h4>{formatEventType(activity.action)}</h4>
        <dl
          className="mx-0 mt-4 mb-0 grid grid-cols-2 gap-y-[0.8rem] gap-x-4 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:leading-[1.45] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase"
          data-slot="member-detail-definition-list"
        >
          <Definition label="Source">{activity.source}</Definition>
          <Definition label="Occurred">
            <Timestamp value={activity.occurredAt} timeZone={timeZone} />
          </Definition>
          {activity.reason ? (
            <Definition label="Reason">{activity.reason}</Definition>
          ) : null}
        </dl>
      </article>
    </li>
  );
}

function AdministratorQuotaDetails({
  details,
}: Readonly<{
  details: NonNullable<MemberDetailProjection["quota"]["administratorDetails"]>;
}>) {
  return (
    <div className="mt-5 pt-5 border-t border-t-border/50 [&_h4+[data-slot=member-detail-definition-list]]:mt-3!">
      <h4>Quota setup</h4>
      <dl
        className="mx-0 mt-4 mb-0 grid grid-cols-2 gap-y-[0.8rem] gap-x-4 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:leading-[1.45] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:font-mono [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase"
        data-slot="member-detail-definition-list"
      >
        <Definition label="Starting quota">
          {details.initialQuota ?? "Not set"}
        </Definition>
        <Definition label="Starting quota use">
          {details.initialQuota === null
            ? "Not set"
            : details.usesInitialQuota
              ? "In use"
              : "Not in use"}
        </Definition>
        <Definition label="Starting quota source">
          {details.initialQuotaProvenance ?? "Not set yet"}
        </Definition>
        <Definition label="Calculation method">
          {details.settingsMethod
            ? formatQuotaMethod(details.settingsMethod)
            : "Not set"}
        </Definition>
        <Definition label="History length">
          {details.settingsHistoryLength === null
            ? "Not set"
            : String(details.settingsHistoryLength)}
        </Definition>
        <Definition label="Precision">
          {details.settingsPrecision === null
            ? "Not set"
            : `${details.settingsPrecision} decimal place${details.settingsPrecision === 1 ? "" : "s"}`}
        </Definition>
        <Definition label="Rounding rule">
          {details.settingsRoundingRule ?? "Not set"}
        </Definition>
      </dl>
      {details.seedTotals.length === 0 ? (
        <p className="py-[0.8rem] px-4 border-l-[0.25rem] bg-card">
          No seed totals yet.
        </p>
      ) : (
        <>
          <h4>Seed totals, oldest first</h4>
          <ol className="mx-0 mt-4 mb-0 p-0 gap-2 grid list-none [counter-reset:member-detail-seed] [&_li]:py-[0.65rem] [&_li]:px-[0.8rem] [&_li]:gap-4 [&_li]:border [&_li]:border-border/50 [&_li]:flex [&_li]:items-baseline [&_li]:justify-between [&_li]:[counter-increment:member-detail-seed] [&_li_span::before]:[content:counter(member-detail-seed)_'._'] [&_li_span::before]:text-muted-foreground [&_strong]:text-primary [&_strong]:font-semibold">
            {details.seedTotals.map((seed) => (
              <li key={seed.position}>
                <span>Seed {seed.position}</span>
                <strong>{seed.pointTotal}</strong>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

export function currentMemberHandicap(
  handicaps: readonly MemberDetailHandicap[],
): MemberDetailHandicap | null {
  return handicaps[0] ?? null;
}

export function shouldRenderAdministratorQuota(
  projection: Pick<MemberDetailProjection, "actorRole" | "quota">,
) {
  return (
    projection.actorRole === "administrator" &&
    projection.quota.administratorDetails !== null
  );
}

export function hasPendingInvitation(
  invitations: readonly MemberDetailInvitation[],
): boolean {
  return invitations.some((invitation) => invitation.status === "pending");
}

export function formatMemberDetailTimestamp(value: string, timeZone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  const resolvedTimeZone = timeZone?.trim() || "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: resolvedTimeZone,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(date);
  }
}

export function formatMemberDetailDate(value: string, timeZone?: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  // An as-of value is a calendar date, not an instant. Keep it stable across
  // group time zones so a west-coast viewer never sees the prior day.
  void timeZone;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatInvitationStatus(status: MemberDetailInvitation["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function formatMemberDetailDeliveryState(
  delivery: MemberDetailDelivery,
) {
  const state = delivery.state;
  if (state === "failed_permanent") {
    return delivery.failureReason
      ? `Failed — ${delivery.failureReason}`
      : "Failed";
  }
  if (state === "suppressed") {
    return delivery.suppressionReason
      ? `Not sent — ${formatSuppressionReason(delivery.suppressionReason)}`
      : "Not sent";
  }
  if (state === "retryable") return "Failed — we&apos;ll try again";
  if (state === "cancelled") return "Cancelled";
  if (state === "queued") return "Queued";
  if (state === "sending") return "Sending";
  return "Sent";
}

function formatSuppressionReason(
  reason: NonNullable<MemberDetailDelivery["suppressionReason"]>,
) {
  return reason === "bounce" ? "Bounced" : "Complaint";
}

function formatHandicapSource(source: MemberDetailHandicap["source"]) {
  return source === "manual" ? "Manual" : "CSV import";
}

function formatRole(role: MemberDetailInvitation["role"]) {
  return role === "administrator"
    ? "Administrator"
    : role === "coordinator"
      ? "Coordinator"
      : "Member";
}

function formatQuotaMethod(
  method: NonNullable<
    MemberDetailProjection["quota"]["administratorDetails"]
  >["settingsMethod"],
) {
  if (method === "moving_average") return "Moving average";
  if (method === "best_10_of_20") return "Best 10 of 20";
  return "Previous plus/minus";
}

function formatQuotaProvenance(source: Readonly<Record<string, unknown>>) {
  const kind = typeof source.kind === "string" ? source.kind : null;
  if (kind === "initial_quota") return "Starting quota";
  if (kind === "seed_history") return "Seed history";
  if (kind === "official_history") return "From official results";
  if (kind === "not_ready") return "Not ready";
  return "Not set yet";
}

function formatEventType(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
