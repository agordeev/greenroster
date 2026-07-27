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
      className="member-detail-sections"
      aria-labelledby="member-detail-sections-title"
    >
      <div className="member-detail-heading">
        <p className="ledger-kicker">Member record</p>
        <h2 id="member-detail-sections-title">History and projections</h2>
        <p>
          Read-only account, invitation, delivery, quota, handicap, and activity
          history for this membership.
        </p>
      </div>

      <DetailSection title="Account" id="member-detail-account">
        <dl className="member-detail-definition-list">
          <Definition label="Account e-mail">
            {projection.accountEmail ?? "No authenticated account is linked."}
          </Definition>
        </dl>
      </DetailSection>

      <DetailSection title="Invitation history" id="member-detail-invitations">
        {projection.invitations.length === 0 ? (
          <EmptyState>No invitation history is available.</EmptyState>
        ) : (
          <>
            {hasPendingInvitation(projection.invitations) ? (
              <p className="member-detail-inline-link">
                <Link href="/portal/invitations">
                  Manage pending invitations
                </Link>
              </p>
            ) : null}
            <ol className="member-detail-event-list">
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

      <DetailSection
        title="Notification delivery history"
        id="member-detail-deliveries"
      >
        {projection.deliveries.length === 0 ? (
          <EmptyState>
            No notification delivery history is available.
          </EmptyState>
        ) : (
          <ol className="member-detail-event-list">
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

      <DetailSection title="Quota projection" id="member-detail-quota">
        <dl className="member-detail-definition-list">
          <Definition label="Current quota">
            {projection.quota.projectedQuota ?? "Not projected"}
          </Definition>
          <Definition label="Readiness">
            {projection.quota.projectionReady ? "Ready" : "Needs more history"}
          </Definition>
          <Definition label="Provenance">
            {formatQuotaProvenance(projection.quota.projectionSource)}
          </Definition>
          <Definition label="Effective">
            {projection.quota.projectionEffectiveAt ? (
              <Timestamp
                value={projection.quota.projectionEffectiveAt}
                timeZone={timeZone}
              />
            ) : (
              "Not established"
            )}
          </Definition>
          <Definition label="Projection version">
            {String(projection.quota.projectionVersion)}
          </Definition>
        </dl>

        <h4 className="member-detail-subheading">Quota history</h4>
        {projection.quota.history.length === 0 ? (
          <EmptyState>No quota changes are recorded.</EmptyState>
        ) : (
          <ol className="member-detail-event-list">
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
          <AdministratorQuotaDetails
            details={administratorQuota}
            timeZone={timeZone}
          />
        ) : projection.actorRole === "coordinator" ? (
          <p className="member-detail-restricted-note">
            Administrator-only quota inputs are not shown for coordinator
            access.
          </p>
        ) : (
          <EmptyState>Administrator quota inputs are unavailable.</EmptyState>
        )}
      </DetailSection>

      <DetailSection title="Handicap" id="member-detail-handicap">
        {currentHandicap ? (
          <>
            <dl className="member-detail-definition-list">
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
            <h3 className="member-detail-subheading">Handicap history</h3>
            <ol className="member-detail-event-list">
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
          <EmptyState>No handicap history is available.</EmptyState>
        )}
      </DetailSection>

      <DetailSection title="Member activity" id="member-detail-activity">
        {projection.activity.length === 0 ? (
          <EmptyState>No member activity is available.</EmptyState>
        ) : (
          <ol className="member-detail-event-list">
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
    <section className="member-detail-section" aria-labelledby={id}>
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
  return <p className="member-detail-empty">{children}</p>;
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
      <article className="member-detail-event-card">
        <h4>{formatInvitationStatus(invitation.status)}</h4>
        <dl className="member-detail-definition-list">
          <Definition label="Invited address">
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
          <Definition label="Version">{String(invitation.version)}</Definition>
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
      <article className="member-detail-event-card">
        <h4>{formatMemberDetailDeliveryState(delivery)}</h4>
        <dl className="member-detail-definition-list">
          <Definition label="Event">
            {formatEventType(delivery.eventType)}
          </Definition>
          <Definition label="Recipient">{delivery.recipientAddress}</Definition>
          <Definition label="Channel">{delivery.channel}</Definition>
          <Definition label="Attempts">{String(delivery.attempts)}</Definition>
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
            <Definition label="Failure reason">
              {delivery.failureReason}
            </Definition>
          ) : null}
          {delivery.suppressionReason ? (
            <Definition label="Suppression reason">
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
      <article className="member-detail-event-card">
        <h4>{handicap.handicap}</h4>
        <dl className="member-detail-definition-list">
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
      <article className="member-detail-event-card">
        <h4>
          {entry.projectedQuota === null
            ? "Quota not projected"
            : `Quota ${entry.projectedQuota}`}
        </h4>
        <dl className="member-detail-definition-list">
          <Definition label="Readiness">
            {entry.projectionReady ? "Ready" : "Needs more history"}
          </Definition>
          <Definition label="Provenance">
            {formatQuotaProvenance(entry.projectionSource)}
          </Definition>
          <Definition label="Changed">
            <Timestamp value={entry.occurredAt} timeZone={timeZone} />
          </Definition>
          <Definition label="Projection version">
            {String(entry.projectionVersion)}
          </Definition>
          <Definition label="Settings version">
            {String(entry.settingsVersion)}
          </Definition>
          <Definition label="Source">{entry.source}</Definition>
          {entry.reason ? (
            <Definition label="Reason">{entry.reason}</Definition>
          ) : null}
          {showAdministratorDetails && entry.administratorDetails ? (
            <Definition label="Administrator inputs">
              Initial quota: {entry.administratorDetails.initialQuota ?? "none"}
              ;{" "}
              {entry.administratorDetails.usesInitialQuota
                ? "initial quota in use"
                : "initial quota not in use"}
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
      <article className="member-detail-event-card">
        <h4>{formatEventType(activity.action)}</h4>
        <dl className="member-detail-definition-list">
          <Definition label="Source">{activity.source}</Definition>
          <Definition label="Occurred">
            <Timestamp value={activity.occurredAt} timeZone={timeZone} />
          </Definition>
          {activity.reason ? (
            <Definition label="Reason">{activity.reason}</Definition>
          ) : null}
          {activity.targetVersion !== null ? (
            <Definition label="Target version">
              {String(activity.targetVersion)}
            </Definition>
          ) : null}
        </dl>
      </article>
    </li>
  );
}

function AdministratorQuotaDetails({
  details,
  timeZone,
}: Readonly<{
  details: NonNullable<MemberDetailProjection["quota"]["administratorDetails"]>;
  timeZone?: string;
}>) {
  return (
    <div className="member-detail-admin-quota">
      <h4>Administrator quota inputs</h4>
      <dl className="member-detail-definition-list">
        <Definition label="Initial quota">
          {details.initialQuota ?? "Not configured"}
        </Definition>
        <Definition label="Initial quota use">
          {details.initialQuota === null
            ? "Not configured"
            : details.usesInitialQuota
              ? "In use"
              : "Not in use"}
        </Definition>
        <Definition label="Initial quota provenance">
          {details.initialQuotaProvenance ?? "Not recorded"}
        </Definition>
        <Definition label="Settings method">
          {details.settingsMethod
            ? formatQuotaMethod(details.settingsMethod)
            : "Not configured"}
        </Definition>
        <Definition label="History length">
          {details.settingsHistoryLength === null
            ? "Not configured"
            : String(details.settingsHistoryLength)}
        </Definition>
        <Definition label="Precision">
          {details.settingsPrecision === null
            ? "Not configured"
            : `${details.settingsPrecision} decimal place${details.settingsPrecision === 1 ? "" : "s"}`}
        </Definition>
        <Definition label="Rounding rule">
          {details.settingsRoundingRule ?? "Not configured"}
        </Definition>
        <Definition label="Settings version">
          {String(details.settingsVersion)}
        </Definition>
      </dl>
      {details.seedTotals.length === 0 ? (
        <p className="member-detail-empty">No seed totals are recorded.</p>
      ) : (
        <>
          <h4>Ordered seed totals</h4>
          <ol className="member-detail-seed-list">
            {details.seedTotals.map((seed) => (
              <li key={seed.position}>
                <span>Seed {seed.position}</span>
                <strong>{seed.pointTotal}</strong>
              </li>
            ))}
          </ol>
        </>
      )}
      {timeZone ? (
        <p className="member-detail-time-zone">Group time zone: {timeZone}</p>
      ) : null}
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
      : "Failed permanently";
  }
  if (state === "suppressed") {
    return delivery.suppressionReason
      ? `Suppressed — ${formatSuppressionReason(delivery.suppressionReason)}`
      : "Suppressed";
  }
  if (state === "retryable") return "Retryable failure";
  if (state === "cancelled") return "Cancelled";
  if (state === "queued") return "Queued";
  if (state === "sending") return "Sending";
  return "Sent";
}

function formatSuppressionReason(
  reason: NonNullable<MemberDetailDelivery["suppressionReason"]>,
) {
  return reason === "bounce" ? "Hard bounce" : "Complaint";
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
  if (kind === "initial_quota") return "Initial quota";
  if (kind === "seed_history") return "Seed history";
  if (kind === "official_history") return "Official history";
  if (kind === "not_ready") return "Not ready";
  return "Not recorded";
}

function formatEventType(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
