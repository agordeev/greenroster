import "server-only";

import { z } from "zod";

import type { MemberDetailProjection } from "./member-detail";
import { MutationError } from "../mutations/result";

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

type RpcClient = Readonly<{
  rpc: (
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ) => PromiseLike<Readonly<{ data: unknown; error: SupabaseRpcError | null }>>;
}>;

export type MemberDetailDataDependencies = Readonly<{
  createClient: () => RpcClient | Promise<RpcClient>;
}>;

const defaultDependencies: MemberDetailDataDependencies = {
  createClient: async () => {
    const { createSupabaseServiceClient } =
      await import("../supabase/service-client");
    return createSupabaseServiceClient();
  },
};

const decimalSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim());
const timestampSchema = z.string().datetime({ offset: true });

const invitationSchema = z
  .object({
    invitation_id: z.uuid(),
    invited_email: z.email(),
    role: z.enum(["member", "coordinator", "administrator"]),
    status: z.enum(["pending", "accepted", "revoked", "expired"]),
    issued_at: timestampSchema,
    expires_at: timestampSchema,
    accepted_at: timestampSchema.nullable(),
    revoked_at: timestampSchema.nullable(),
    expired_at: timestampSchema.nullable(),
    version: z.number().int().positive(),
  })
  .strict();

const deliverySchema = z
  .object({
    delivery_id: z.uuid(),
    event_type: z.string().min(1),
    recipient_address: z.email(),
    channel: z.literal("email"),
    state: z.enum([
      "queued",
      "sending",
      "sent",
      "retryable",
      "failed_permanent",
      "suppressed",
      "cancelled",
    ]),
    attempts: z.number().int().nonnegative(),
    failure_reason: z.string().nullable(),
    suppression_reason: z.enum(["bounce", "complaint"]).nullable(),
    sent_at: timestampSchema.nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict();

const quotaCurrentSchema = z
  .object({
    projection_version: z.number().int().nonnegative(),
    projection_ready: z.boolean(),
    projected_quota: decimalSchema.nullable(),
    projection_source: z.record(z.string(), z.unknown()),
    effective_at: timestampSchema.nullable(),
  })
  .strict();

const seedTotalSchema = z
  .object({
    position: z.number().int().min(1).max(20),
    point_total: decimalSchema,
  })
  .strict();

const quotaAdminSchema = z
  .object({
    initial_quota: decimalSchema.nullable(),
    uses_initial_quota: z.boolean(),
    initial_quota_provenance: z.string().nullable(),
    seed_totals: z.array(seedTotalSchema),
    settings: z
      .object({
        version: z.number().int().nonnegative(),
        method: z
          .enum(["moving_average", "best_10_of_20", "previous_plus_minus"])
          .nullable(),
        history_length: z.number().int().nullable(),
        precision: z
          .union([z.literal(0), z.literal(1), z.literal(2)])
          .nullable(),
        rounding_rule: z.literal("half_away_from_zero").nullable(),
        adjustment_bands: z.array(z.record(z.string(), z.unknown())),
      })
      .strict(),
  })
  .strict();

const quotaHistoryAdminSchema = z
  .object({
    initial_quota: decimalSchema.nullable(),
    uses_initial_quota: z.boolean(),
    initial_quota_provenance: z.string().nullable(),
    seed_totals: z.array(seedTotalSchema),
  })
  .strict();

const quotaHistorySchema = z
  .object({
    event_id: z.uuid(),
    projection_version: z.number().int().positive(),
    settings_version: z.number().int().nonnegative(),
    projection_ready: z.boolean(),
    projected_quota: decimalSchema.nullable(),
    projection_source: z.record(z.string(), z.unknown()),
    occurred_at: timestampSchema,
    reason: z.string().nullable(),
    source: z.string().min(1),
    admin: quotaHistoryAdminSchema.nullable(),
  })
  .strict();

const handicapSchema = z
  .object({
    id: z.uuid(),
    handicap_id: z.string().nullable(),
    value: decimalSchema,
    source: z.enum(["manual", "import"]),
    as_of: z.iso.date(),
    created_at: timestampSchema,
  })
  .strict();

const activitySchema = z
  .object({
    event_id: z.uuid(),
    action: z.string().min(1),
    source: z.string().min(1),
    reason: z.string().nullable(),
    target_version: z.number().int().nullable(),
    occurred_at: timestampSchema,
  })
  .strict();

const rowSchema = z
  .object({
    membership_id: z.uuid(),
    group_id: z.uuid(),
    actor_role: z.enum(["coordinator", "administrator"]),
    account_email: z.email().nullable(),
    invitations: z.array(invitationSchema),
    deliveries: z.array(deliverySchema),
    quota: z
      .object({
        current: quotaCurrentSchema,
        admin: quotaAdminSchema.nullable(),
        history: z.array(quotaHistorySchema),
      })
      .strict(),
    handicaps: z
      .object({
        current: handicapSchema.nullable(),
        all: z.array(handicapSchema),
      })
      .strict(),
    activity: z.array(activitySchema),
  })
  .strict();

function mapSeedTotals(seedTotals: z.infer<typeof seedTotalSchema>[]) {
  return seedTotals.map((seed) => ({
    position: seed.position,
    pointTotal: seed.point_total,
  }));
}

function mapError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

export async function executeGetMemberDetailProjection(
  actorUserId: string,
  membershipId: string,
  overrides?: Partial<MemberDetailDataDependencies>,
): Promise<MemberDetailProjection> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const client = await dependencies.createClient();
  const result = await client.rpc("get_member_detail_projection", {
    p_actor_user_id: actorUserId,
    p_membership_id: membershipId,
  });
  if (result.error) throw mapError(result.error);

  const parsed = z.array(rowSchema).length(1).safeParse(result.data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  const row = parsed.data[0];
  if (row.membership_id !== membershipId) {
    throw new MutationError("unexpected", {
      cause: new Error("Member detail target mismatch"),
    });
  }
  const administratorDataIsInvalid =
    row.actor_role === "coordinator"
      ? row.quota.admin !== null ||
        row.quota.history.some((entry) => entry.admin !== null)
      : row.quota.admin === null ||
        row.quota.history.some((entry) => entry.admin === null);
  if (administratorDataIsInvalid) {
    throw new MutationError("unexpected", {
      cause: new Error("Member detail role redaction is inconsistent"),
    });
  }
  const currentHandicap = row.handicaps.current;
  const firstHandicap = row.handicaps.all[0] ?? null;
  if (
    (currentHandicap === null) !== (firstHandicap === null) ||
    (currentHandicap !== null && currentHandicap.id !== firstHandicap?.id)
  ) {
    throw new MutationError("unexpected", {
      cause: new Error("Member handicap projection is inconsistent"),
    });
  }
  const admin = row.quota.admin;

  return {
    membershipId: row.membership_id,
    groupId: row.group_id,
    actorRole: row.actor_role,
    accountEmail: row.account_email,
    invitations: row.invitations.map((invitation) => ({
      invitationId: invitation.invitation_id,
      invitedEmail: invitation.invited_email,
      role: invitation.role,
      status: invitation.status,
      issuedAt: invitation.issued_at,
      expiresAt: invitation.expires_at,
      acceptedAt: invitation.accepted_at,
      revokedAt: invitation.revoked_at,
      expiredAt: invitation.expired_at,
      version: invitation.version,
    })),
    deliveries: row.deliveries.map((delivery) => ({
      deliveryId: delivery.delivery_id,
      eventType: delivery.event_type,
      recipientAddress: delivery.recipient_address,
      channel: delivery.channel,
      state: delivery.state,
      attempts: delivery.attempts,
      failureReason: delivery.failure_reason,
      suppressionReason: delivery.suppression_reason,
      sentAt: delivery.sent_at,
      createdAt: delivery.created_at,
      updatedAt: delivery.updated_at,
    })),
    quota: {
      projectionReady: row.quota.current.projection_ready,
      projectedQuota: row.quota.current.projected_quota,
      projectionSource: row.quota.current.projection_source,
      projectionEffectiveAt: row.quota.current.effective_at,
      projectionVersion: row.quota.current.projection_version,
      history: row.quota.history.map((entry) => ({
        eventId: entry.event_id,
        projectionVersion: entry.projection_version,
        settingsVersion: entry.settings_version,
        projectionReady: entry.projection_ready,
        projectedQuota: entry.projected_quota,
        projectionSource: entry.projection_source,
        occurredAt: entry.occurred_at,
        reason: entry.reason,
        source: entry.source,
        administratorDetails: entry.admin
          ? {
              initialQuota: entry.admin.initial_quota,
              usesInitialQuota: entry.admin.uses_initial_quota,
              initialQuotaProvenance: entry.admin.initial_quota_provenance,
              seedTotals: mapSeedTotals(entry.admin.seed_totals),
            }
          : null,
      })),
      administratorDetails: admin
        ? {
            initialQuota: admin.initial_quota,
            usesInitialQuota: admin.uses_initial_quota,
            initialQuotaProvenance: admin.initial_quota_provenance,
            seedTotals: mapSeedTotals(admin.seed_totals),
            settingsVersion: admin.settings.version,
            settingsMethod: admin.settings.method,
            settingsHistoryLength: admin.settings.history_length,
            settingsPrecision: admin.settings.precision,
            settingsRoundingRule: admin.settings.rounding_rule,
          }
        : null,
    },
    handicaps: row.handicaps.all.map((handicap) => ({
      recordId: handicap.id,
      handicapId: handicap.handicap_id,
      handicap: handicap.value,
      source: handicap.source,
      asOf: handicap.as_of,
      createdAt: handicap.created_at,
    })),
    activity: row.activity.map((activity) => ({
      eventId: activity.event_id,
      action: activity.action,
      source: activity.source,
      reason: activity.reason,
      targetVersion: activity.target_version,
      occurredAt: activity.occurred_at,
    })),
  };
}
