import "server-only";

import { z } from "zod";

import type {
  GroupActivityItem,
  GroupRoleRow,
  GroupRolesActivityProjection,
  GroupRolesActivityQuery,
  SafeAuditSummary,
} from "../../domain/group-roles-activity";
import { MutationError } from "../mutations/result";

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

type RpcClient = Readonly<{
  rpc: (
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ) => PromiseLike<Readonly<{ data: unknown; error: SupabaseRpcError | null }>>;
}>;

export type GroupRolesActivityDataDependencies = Readonly<{
  createClient: () => RpcClient | Promise<RpcClient>;
}>;

const defaultDependencies: GroupRolesActivityDataDependencies = {
  createClient: async () => {
    const { createSupabaseServiceClient } =
      await import("../supabase/service-client");
    return createSupabaseServiceClient();
  },
};

const timestampSchema = z.string().datetime({ offset: true });
const uuidSchema = z.uuid();
const nullableUuidSchema = uuidSchema.nullable();
const safeSummarySchema = z
  .object({
    kind: z.enum([
      "member",
      "invitation",
      "handicap",
      "group",
      "import",
      "security",
      "profile",
      "unknown",
    ]),
    summary_available: z.boolean(),
    membership_id: nullableUuidSchema,
    invitation_id: nullableUuidSchema,
    import_job_id: nullableUuidSchema,
    group_version: z.number().int().nullable(),
    membership_version: z.number().int().nullable(),
    profile_version: z.number().int().nullable(),
    contact_version: z.number().int().nullable(),
    version: z.number().int().nullable(),
    status: z.string().nullable(),
    role: z.enum(["member", "coordinator", "administrator"]).nullable(),
    dues_paid: z.boolean().nullable(),
    accepted_at: timestampSchema.nullable(),
    expires_at: timestampSchema.nullable(),
    email_matches: z.boolean().nullable(),
    inactivated_at: timestampSchema.nullable(),
    handicap_record_id: nullableUuidSchema,
    handicap_id: z.string().nullable(),
    handicap: z.string().nullable(),
    source: z.string().nullable(),
    as_of: z.iso.date().nullable(),
    created_at: timestampSchema.nullable(),
    quota: z.string().nullable(),
    projection_version: z.number().int().nullable(),
    settings_version: z.number().int().nullable(),
    projection_ready: z.boolean().nullable(),
    total_rows: z.number().int().nullable(),
    valid_rows: z.number().int().nullable(),
    invalid_rows: z.number().int().nullable(),
    skipped_rows: z.number().int().nullable(),
    applied_rows: z.number().int().nullable(),
    revision: z.number().int().nullable(),
    cancelled_notification_count: z.number().int().nullable(),
    email_present: z.boolean().nullable(),
    email_verified: z.boolean().nullable(),
    complete: z.boolean().nullable(),
    previous_membership_id: nullableUuidSchema,
    replacement_membership_id: nullableUuidSchema,
    band_count: z.number().int().nullable(),
    state: z.string().nullable(),
    changed_fields: z.array(z.string()).nullable(),
  })
  .strict();

const roleSchema = z
  .object({
    membership_id: uuidSchema,
    first_name: z.string(),
    last_name: z.string(),
    role: z.enum(["coordinator", "administrator"]),
    status: z.enum(["pending", "active", "inactive"]),
    invitation_state: z
      .enum(["pending", "accepted", "revoked", "expired"])
      .nullable(),
    invitation_issued_at: timestampSchema.nullable(),
    invitation_expires_at: timestampSchema.nullable(),
    invitation_accepted_at: timestampSchema.nullable(),
    invitation_revoked_at: timestampSchema.nullable(),
    membership_version: z.number().int().positive(),
  })
  .strict();

const actorSchema = z
  .object({
    membership_id: uuidSchema,
    display_name: z.string(),
    role: z.enum(["member", "coordinator", "administrator"]),
  })
  .strict();

const targetSchema = z
  .object({
    type: z.string().min(1),
    id: nullableUuidSchema,
    version: z.number().int().nullable(),
  })
  .strict();

const activitySchema = z
  .object({
    event_id: uuidSchema,
    group_id: uuidSchema,
    actor: actorSchema.nullable(),
    action: z.string().min(1),
    target: targetSchema.nullable(),
    occurred_at: timestampSchema,
    source: z.string().min(1),
    correlation_id: uuidSchema,
    reason: z.string().nullable(),
    before: safeSummarySchema.nullable(),
    after: safeSummarySchema.nullable(),
  })
  .strict();

const envelopeSchema = z
  .object({
    group: z
      .object({
        group_id: uuidSchema,
        name: z.string(),
        time_zone: z.string(),
        version: z.number().int().positive(),
      })
      .strict(),
    roles: z.array(roleSchema),
    activity: z
      .object({
        items: z.array(activitySchema),
        next_cursor: z
          .object({
            occurred_at: timestampSchema,
            event_id: uuidSchema,
          })
          .strict()
          .nullable(),
        has_more: z.boolean(),
      })
      .strict(),
  })
  .strict();

function mapError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

function mapSummary(
  summary: z.infer<typeof safeSummarySchema>,
): SafeAuditSummary {
  return {
    kind: summary.kind,
    summaryAvailable: summary.summary_available,
    membershipId: summary.membership_id,
    invitationId: summary.invitation_id,
    importJobId: summary.import_job_id,
    groupVersion: summary.group_version,
    membershipVersion: summary.membership_version,
    profileVersion: summary.profile_version,
    contactVersion: summary.contact_version,
    version: summary.version,
    status: summary.status,
    role: summary.role,
    duesPaid: summary.dues_paid,
    acceptedAt: summary.accepted_at,
    expiresAt: summary.expires_at,
    emailMatches: summary.email_matches,
    inactivatedAt: summary.inactivated_at,
    handicapRecordId: summary.handicap_record_id,
    handicapId: summary.handicap_id,
    handicap: summary.handicap,
    source: summary.source,
    asOf: summary.as_of,
    createdAt: summary.created_at,
    quota: summary.quota,
    projectionVersion: summary.projection_version,
    settingsVersion: summary.settings_version,
    projectionReady: summary.projection_ready,
    totalRows: summary.total_rows,
    validRows: summary.valid_rows,
    invalidRows: summary.invalid_rows,
    skippedRows: summary.skipped_rows,
    appliedRows: summary.applied_rows,
    revision: summary.revision,
    cancelledNotificationCount: summary.cancelled_notification_count,
    emailPresent: summary.email_present,
    emailVerified: summary.email_verified,
    complete: summary.complete,
    previousMembershipId: summary.previous_membership_id,
    replacementMembershipId: summary.replacement_membership_id,
    bandCount: summary.band_count,
    state: summary.state,
    changedFields: summary.changed_fields,
  };
}

function mapActivity(row: z.infer<typeof activitySchema>): GroupActivityItem {
  return {
    eventId: row.event_id,
    groupId: row.group_id,
    actor: row.actor
      ? {
          membershipId: row.actor.membership_id,
          displayName: row.actor.display_name,
          role: row.actor.role,
        }
      : null,
    action: row.action,
    target: row.target
      ? {
          type: row.target.type,
          id: row.target.id,
          version: row.target.version,
        }
      : null,
    occurredAt: row.occurred_at,
    source: row.source,
    correlationId: row.correlation_id,
    reason: row.reason,
    before: row.before ? mapSummary(row.before) : null,
    after: row.after ? mapSummary(row.after) : null,
  };
}

export async function executeGroupRolesActivity(
  actorUserId: string,
  query: GroupRolesActivityQuery,
  overrides?: Partial<GroupRolesActivityDataDependencies>,
): Promise<GroupRolesActivityProjection> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const client = await dependencies.createClient();
  const result = await client.rpc("resolve_group_roles_activity", {
    p_actor_user_id: actorUserId,
    p_target_type: query.targetType ?? null,
    p_target_id: query.targetId ?? null,
    p_activity_limit: query.limit,
    p_activity_before_occurred_at: query.before?.occurredAt ?? null,
    p_activity_before_id: query.before?.eventId ?? null,
  });
  if (result.error) throw mapError(result.error);
  const parsed = envelopeSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }

  return {
    group: {
      groupId: parsed.data.group.group_id,
      name: parsed.data.group.name,
      timeZone: parsed.data.group.time_zone,
      version: parsed.data.group.version,
    },
    roles: parsed.data.roles.map((role): GroupRoleRow => ({
      membershipId: role.membership_id,
      firstName: role.first_name,
      lastName: role.last_name,
      role: role.role,
      status: role.status,
      invitationState: role.invitation_state,
      invitationIssuedAt: role.invitation_issued_at,
      invitationExpiresAt: role.invitation_expires_at,
      invitationAcceptedAt: role.invitation_accepted_at,
      invitationRevokedAt: role.invitation_revoked_at,
      membershipVersion: role.membership_version,
    })),
    activity: {
      items: parsed.data.activity.items.map(mapActivity),
      nextCursor: parsed.data.activity.next_cursor
        ? {
            occurredAt: parsed.data.activity.next_cursor.occurred_at,
            eventId: parsed.data.activity.next_cursor.event_id,
          }
        : null,
      hasMore: parsed.data.activity.has_more,
    },
  };
}
