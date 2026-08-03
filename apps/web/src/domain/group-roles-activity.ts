export type PortalRole = "member" | "coordinator" | "administrator";
export type MembershipStatus = "pending" | "active" | "inactive";
export type InvitationState = "pending" | "accepted" | "revoked" | "expired";

export type GroupRolesActivityCursor = Readonly<{
  occurredAt: string;
  eventId: string;
}>;

export type GroupRolesActivityQuery = Readonly<{
  targetType?: string;
  targetId?: string;
  filterError?: GroupRolesActivityFilterError;
  limit: number;
  before?: GroupRolesActivityCursor;
}>;

export type GroupRolesActivityFilterError =
  | "target_type_required"
  | "target_type_invalid"
  | "target_id_required"
  | "target_id_invalid";

export const groupRolesActivityDefaultLimit = 50;
export const groupRolesActivityMaximumLimit = 100;

export type SafeAuditSummary = Readonly<{
  kind:
    | "member"
    | "invitation"
    | "handicap"
    | "group"
    | "import"
    | "security"
    | "profile"
    | "unknown";
  summaryAvailable: boolean;
  membershipId: string | null;
  invitationId: string | null;
  importJobId: string | null;
  groupVersion: number | null;
  membershipVersion: number | null;
  profileVersion: number | null;
  contactVersion: number | null;
  version: number | null;
  status: string | null;
  role: PortalRole | null;
  duesPaid: boolean | null;
  acceptedAt: string | null;
  expiresAt: string | null;
  emailMatches: boolean | null;
  inactivatedAt: string | null;
  handicapRecordId: string | null;
  handicapId: string | null;
  handicap: string | null;
  source: string | null;
  asOf: string | null;
  createdAt: string | null;
  quota: string | null;
  projectionVersion: number | null;
  settingsVersion: number | null;
  projectionReady: boolean | null;
  totalRows: number | null;
  validRows: number | null;
  invalidRows: number | null;
  skippedRows: number | null;
  appliedRows: number | null;
  revision: number | null;
  cancelledNotificationCount: number | null;
  emailPresent: boolean | null;
  emailVerified: boolean | null;
  complete: boolean | null;
  previousMembershipId: string | null;
  replacementMembershipId: string | null;
  bandCount: number | null;
  state: string | null;
  changedFields: readonly string[] | null;
}>;

export type GroupRoleRow = Readonly<{
  membershipId: string;
  firstName: string;
  lastName: string;
  role: Exclude<PortalRole, "member">;
  status: MembershipStatus;
  invitationState: InvitationState | null;
  invitationIssuedAt: string | null;
  invitationExpiresAt: string | null;
  invitationAcceptedAt: string | null;
  invitationRevokedAt: string | null;
  membershipVersion: number;
}>;

export type GroupActivityItem = Readonly<{
  eventId: string;
  groupId: string;
  actor: Readonly<{
    membershipId: string;
    displayName: string;
    role: PortalRole;
  }> | null;
  action: string;
  target: Readonly<{
    type: string;
    id: string | null;
    version: number | null;
  }> | null;
  occurredAt: string;
  source: string;
  correlationId: string;
  reason: string | null;
  before: SafeAuditSummary | null;
  after: SafeAuditSummary | null;
}>;

export type GroupRolesActivityProjection = Readonly<{
  group: Readonly<{
    groupId: string;
    name: string;
    timeZone: string;
    version: number;
  }>;
  roles: readonly GroupRoleRow[];
  activity: Readonly<{
    items: readonly GroupActivityItem[];
    nextCursor: GroupRolesActivityCursor | null;
    hasMore: boolean;
  }>;
}>;

type SearchParamValue = string | string[] | undefined;

function oneSearchParam(value: SearchParamValue): string | undefined {
  if (typeof value === "string") return value;
  return Array.isArray(value) && value.length === 1 ? value[0] : undefined;
}

function isOffsetTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) && Number.isFinite(Date.parse(value))
  );
}

export function parseGroupRolesActivityQuery(
  searchParams: Readonly<Record<string, SearchParamValue>>,
): GroupRolesActivityQuery {
  const targetTypeProvided = searchParams.target_type !== undefined;
  const targetIdProvided = searchParams.target_id !== undefined;
  const targetTypeValue = oneSearchParam(searchParams.target_type);
  const targetIdValue = oneSearchParam(searchParams.target_id);
  const beforeOccurredAt = oneSearchParam(searchParams.before_occurred_at);
  const beforeEventId = oneSearchParam(searchParams.before_event_id);
  const parsedLimit = Number(oneSearchParam(searchParams.limit));
  const limit = Number.isInteger(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), groupRolesActivityMaximumLimit)
    : groupRolesActivityDefaultLimit;

  let targetType: string | undefined;
  let targetId: string | undefined;
  let filterError: GroupRolesActivityFilterError | undefined;
  const targetTypeIsSupported =
    targetTypeValue === "membership" || targetTypeValue === "round";
  const targetIdIsUuid =
    targetIdValue !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      targetIdValue,
    );

  const clearFilterRequested = targetTypeValue === "" && targetIdValue === "";
  if ((targetTypeProvided || targetIdProvided) && !clearFilterRequested) {
    if (!targetTypeValue) filterError = "target_type_required";
    else if (!targetTypeIsSupported) filterError = "target_type_invalid";
    else if (!targetIdValue) filterError = "target_id_required";
    else if (!targetIdIsUuid) filterError = "target_id_invalid";
    else {
      targetType = targetTypeValue;
      targetId = targetIdValue;
    }
  }
  const before =
    beforeOccurredAt &&
    isOffsetTimestamp(beforeOccurredAt) &&
    beforeEventId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      beforeEventId,
    )
      ? { occurredAt: beforeOccurredAt, eventId: beforeEventId }
      : undefined;

  return {
    ...(targetType && targetId ? { targetType, targetId } : {}),
    ...(filterError ? { filterError } : {}),
    limit,
    ...(before ? { before } : {}),
  };
}

export function groupRolesActivityQueryParams(
  query: GroupRolesActivityQuery,
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.targetType && query.targetId) {
    params.set("target_type", query.targetType);
    params.set("target_id", query.targetId);
  }
  if (query.limit !== groupRolesActivityDefaultLimit)
    params.set("limit", String(query.limit));
  if (query.before) {
    params.set("before_occurred_at", query.before.occurredAt);
    params.set("before_event_id", query.before.eventId);
  }
  return params;
}

const roleLabels: Readonly<Record<PortalRole, string>> = {
  member: "Member",
  coordinator: "Coordinator",
  administrator: "Administrator",
};

const invitationLabels: Readonly<Record<InvitationState, string>> = {
  pending: "Invitation pending",
  accepted: "Invitation accepted",
  revoked: "Invitation revoked",
  expired: "Invitation expired",
};

export function formatPortalRole(role: PortalRole): string {
  return roleLabels[role];
}

export function formatInvitationState(state: InvitationState | null): string {
  return state ? invitationLabels[state] : "No invitation record";
}

export function formatActivityAction(action: string): string {
  return action
    .split(/[._-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatActivitySummary(
  summary: SafeAuditSummary | null,
): string | null {
  if (!summary || !summary.summaryAvailable) return null;
  const parts: string[] = [];
  if (summary.status) parts.push(`Status: ${summary.status}`);
  if (summary.role) parts.push(`Role: ${formatPortalRole(summary.role)}`);
  if (summary.duesPaid !== null)
    parts.push(`Dues: ${summary.duesPaid ? "paid" : "unpaid"}`);
  if (summary.state) parts.push(`State: ${summary.state}`);
  if (summary.handicap) {
    const provenance = [summary.source, summary.asOf]
      .filter(Boolean)
      .join(" · ");
    parts.push(
      `Handicap: ${summary.handicap}${provenance ? ` (${provenance})` : ""}`,
    );
  }
  if (summary.quota) parts.push(`Quota: ${summary.quota}`);
  if (summary.complete !== null)
    parts.push(summary.complete ? "Complete" : "Incomplete");
  if (summary.appliedRows !== null)
    parts.push(`Applied rows: ${summary.appliedRows}`);
  if (summary.membershipVersion !== null)
    parts.push(`Membership v${summary.membershipVersion}`);
  if (summary.profileVersion !== null)
    parts.push(`Profile v${summary.profileVersion}`);
  if (summary.contactVersion !== null)
    parts.push(`Contact v${summary.contactVersion}`);
  if (summary.version !== null) parts.push(`Version v${summary.version}`);
  if (summary.projectionVersion !== null)
    parts.push(`Projection v${summary.projectionVersion}`);
  if (summary.settingsVersion !== null)
    parts.push(`Settings v${summary.settingsVersion}`);
  if (summary.changedFields?.length) {
    parts.push(`Changed: ${summary.changedFields.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : summary.kind;
}
