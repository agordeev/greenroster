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
  return state ? invitationLabels[state] : "No invitation sent yet";
}

const activityActionLabels = new Map<string, string>([
  ["group.bootstrap", "Group created"],
  ["group.organizer_signup", "Group created"],
  ["group.profile_updated", "Group details updated"],
  ["group.quota_rules_configured", "Quota rules changed"],
  ["group.branding_saved", "Group branding saved"],
  ["group.branding_removed", "Group branding removed"],
  ["group.news_saved", "Group news saved"],
  ["group.media_saved", "Group video saved"],
  ["group.guest_permission_updated", "Guest setting changed"],
  ["membership.invitation_issued", "Invitation sent"],
  ["membership.invitation_regenerated", "Invitation sent again"],
  ["membership.invitation_revoked", "Invitation cancelled"],
  ["membership.invitation_accepted", "Invitation accepted"],
  ["membership.invitation_address_corrected", "Invitation e-mail corrected"],
  ["membership.role_changed", "Role changed"],
  ["membership.administrator_transferred", "Administrator role transferred"],
  ["membership.quota_bootstrap_configured", "Starting quota set"],
  ["member.created", "Member added"],
  ["member.updated", "Member details updated"],
  ["member.status_changed", "Member status changed"],
  ["member.handicap_changed", "Handicap changed"],
  ["member.self_profile_updated", "Member updated their profile"],
  ["member.private_contact_viewed", "Contact details viewed"],
  ["member.notification_preference_changed", "Notification settings changed"],
  ["member.push_device_registered", "Phone registered for notifications"],
  ["member.push_device_retired", "Phone removed from notifications"],
  ["account.email_changed", "E-mail address changed"],
  ["round.published", "Round published"],
  ["round.details_changed", "Round details changed"],
  ["round.cancelled", "Round cancelled"],
  ["round.completed", "Round completed"],
  ["round.reopened", "Round reopened"],
  ["round.scoring_opened", "Scoring opened"],
  ["round.participant_rsvp_changed", "RSVP changed"],
  ["round.score_updated", "Score updated"],
  ["round.hole_score_updated", "Hole score updated"],
  ["round.announcement_posted", "Announcement posted"],
  ["round.guest_created", "Guest added"],
  ["round.guest_updated", "Guest details updated"],
  ["round.guest_withdrawn", "Guest removed"],
  ["round.draft_created", "Round draft created"],
  ["round.draft_updated", "Round draft updated"],
  ["round.draft_score_fields_updated", "Score options updated"],
  ["member_csv_import.uploaded", "Member import uploaded"],
  ["member_csv_import.validated", "Member import checked"],
  ["member_csv_import.apply_requested", "Member import started"],
  ["member_csv_import.completed", "Member import completed"],
  ["round.message_posted", "Message posted"],
  ["round.message_removed", "Message removed"],
]);

const activityKindLabels: Readonly<Record<SafeAuditSummary["kind"], string>> = {
  member: "Member",
  invitation: "Invitation",
  handicap: "Handicap",
  group: "Group",
  import: "Import",
  security: "Security",
  profile: "Profile",
  unknown: "Activity",
};

const handicapSourceLabels = new Map<string, string>([
  ["manual", "entered by hand"],
  ["import", "imported"],
]);

export function formatActivityAction(action: string): string {
  const known = activityActionLabels.get(action);
  if (known) return known;
  const words = action
    .split(/[._-]+/u)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
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
  if (summary.state) parts.push(`Stage: ${summary.state.replaceAll("_", " ")}`);
  if (summary.handicap) {
    const source = summary.source
      ? (handicapSourceLabels.get(summary.source) ??
        summary.source.replaceAll("_", " "))
      : null;
    const provenance = [source, summary.asOf].filter(Boolean).join(" · ");
    parts.push(
      `Handicap: ${summary.handicap}${provenance ? ` (${provenance})` : ""}`,
    );
  }
  if (summary.quota) parts.push(`Quota: ${summary.quota}`);
  if (summary.complete !== null)
    parts.push(summary.complete ? "Complete" : "Incomplete");
  if (summary.appliedRows !== null)
    parts.push(`Rows applied: ${summary.appliedRows}`);
  if (summary.changedFields?.length) {
    parts.push(
      `Changed: ${summary.changedFields.map((field) => field.replaceAll("_", " ")).join(", ")}`,
    );
  }
  return parts.length > 0
    ? parts.join(" · ")
    : activityKindLabels[summary.kind];
}
