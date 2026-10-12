import "server-only";

import { z } from "zod";

import {
  projectMemberQuotaBootstrap,
  type MemberQuotaBootstrapProjection,
} from "../../domain/member-quota-bootstrap";
import type {
  MemberQuotaBootstrapContext,
  MemberQuotaBootstrapInput,
  MemberQuotaBootstrapResult,
  MemberQuotaProjectionSource,
} from "./member-quota-bootstrap";
import { MutationError } from "../mutations/result";

const decimalValueSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim());

const quotaMethodSchema = z.enum([
  "moving_average",
  "best_10_of_20",
  "previous_plus_minus",
]);

const precisionSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

const adjustmentBandSchema = z
  .object({
    adjustment: decimalValueSchema,
    lower_bound: decimalValueSchema,
    lower_inclusive: z.boolean(),
    position: z.number().int().positive(),
    upper_bound: decimalValueSchema,
    upper_inclusive: z.boolean(),
  })
  .strict();

const seedTotalSchema = z
  .object({
    point_total: decimalValueSchema,
    position: z.number().int().min(1).max(20),
  })
  .strict();

const projectionSourceSchema = z.record(z.string(), z.unknown());

const contextRowSchema = z
  .object({
    adjustment_bands: z.array(adjustmentBandSchema),
    context_group_id: z.uuid(),
    context_membership_id: z.uuid(),
    initial_quota: decimalValueSchema.nullable(),
    initial_quota_provenance: z.string().nullable(),
    projection_ready: z.boolean(),
    projection_effective_at: z.string().datetime({ offset: true }).nullable(),
    projection_source: projectionSourceSchema,
    projection_version: z.number().int().nonnegative(),
    projected_quota: decimalValueSchema.nullable(),
    seed_totals: z.array(seedTotalSchema).max(20),
    settings_history_length: z.number().int().nullable(),
    settings_method: quotaMethodSchema.nullable(),
    settings_precision: precisionSchema.nullable(),
    settings_rounding_rule: z.literal("half_away_from_zero").nullable(),
    settings_version: z.number().int().nonnegative(),
    uses_initial_quota: z.boolean(),
  })
  .strict();

const contextRowsSchema = z.array(contextRowSchema).length(1);

const resultRowSchema = z
  .object({
    configured_group_id: z.uuid(),
    configured_membership_id: z.uuid(),
    projection_ready: z.boolean(),
    projection_source: projectionSourceSchema,
    projection_version: z.number().int().positive(),
    projected_quota: decimalValueSchema.nullable(),
    settings_version: z.number().int().nonnegative(),
    uses_initial_quota: z.boolean(),
  })
  .strict();

const resultRowsSchema = z.array(resultRowSchema).length(1);

type RpcClient = Readonly<{
  rpc: (
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ) => PromiseLike<Readonly<{ data: unknown; error: SupabaseRpcError | null }>>;
}>;

export type MemberQuotaBootstrapDataDependencies = Readonly<{
  createClient: () => RpcClient | Promise<RpcClient>;
}>;

const defaultDependencies: MemberQuotaBootstrapDataDependencies = {
  createClient: async () => {
    const { createSupabaseServiceClient } =
      await import("../supabase/service-client");
    return createSupabaseServiceClient();
  },
};

type SupabaseRpcError = Readonly<{
  code?: string;
  message?: string;
}>;

function mapMemberQuotaBootstrapError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003") {
    return new MutationError("forbidden", { cause: error });
  }
  if (error.code === "P0002") {
    return new MutationError("unavailable", { cause: error });
  }
  if (error.code === "40001") {
    return new MutationError("stale_version", { cause: error });
  }
  if (error.code === "P0001") {
    return new MutationError("locked", { cause: error });
  }
  if (
    error.code === "22003" ||
    error.code === "22004" ||
    error.code === "22023" ||
    error.code === "22P02" ||
    error.code === "23502" ||
    error.code === "23503" ||
    error.code === "23505" ||
    error.code === "23514"
  ) {
    return new MutationError("validation", { cause: error });
  }
  if (!error.code) {
    return new MutationError("transient", { cause: error });
  }
  return new MutationError("unexpected", { cause: error });
}

function projectionSource(
  context: z.infer<typeof contextRowSchema>,
  projection: MemberQuotaBootstrapProjection,
): MemberQuotaProjectionSource {
  const kind =
    projection.source.type === "initial"
      ? "initial_quota"
      : projection.source.type === "seed_history"
        ? "seed_history"
        : "not_ready";

  return {
    history_length: context.settings_history_length,
    kind,
    method: context.settings_method,
    precision: context.settings_precision,
    rounding_rule: context.settings_rounding_rule,
    seed_positions: projection.source.seedPositions,
    settings_version: context.settings_version,
  };
}

function quotaBandInput(context: z.infer<typeof contextRowSchema>) {
  return context.adjustment_bands.map((band) => ({
    adjustment: band.adjustment,
    lowerBound: band.lower_bound,
    lowerInclusive: band.lower_inclusive,
    upperBound: band.upper_bound,
    upperInclusive: band.upper_inclusive,
  }));
}

async function resolveQuotaBootstrapContext(
  supabase: RpcClient,
  actorUserId: string,
  membershipId: string,
): Promise<z.infer<typeof contextRowSchema>> {
  const result = await supabase.rpc(
    "resolve_membership_quota_bootstrap_context",
    {
      p_actor_user_id: actorUserId,
      p_membership_id: membershipId,
    },
  );

  if (result.error) throw mapMemberQuotaBootstrapError(result.error);
  if (Array.isArray(result.data) && result.data.length === 0) {
    throw new MutationError("unavailable");
  }

  const rows = contextRowsSchema.safeParse(result.data);
  if (!rows.success) {
    throw new MutationError("unexpected", { cause: rows.error });
  }
  const context = rows.data[0];
  if (context.context_membership_id !== membershipId) {
    throw new MutationError("unexpected", {
      cause: new Error("Membership quota context target mismatch"),
    });
  }
  return context;
}

export async function executeGetMemberQuotaBootstrapContext(
  actorUserId: string,
  membershipId: string,
  overrides?: Partial<MemberQuotaBootstrapDataDependencies>,
): Promise<MemberQuotaBootstrapContext> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const supabase = await dependencies.createClient();
  const context = await resolveQuotaBootstrapContext(
    supabase,
    actorUserId,
    membershipId,
  );

  return {
    membershipId: context.context_membership_id,
    groupId: context.context_group_id,
    initialQuota: context.initial_quota,
    usesInitialQuota: context.uses_initial_quota,
    initialQuotaProvenance: context.initial_quota_provenance,
    seedTotals: context.seed_totals.map((seed) => ({
      position: seed.position,
      pointTotal: seed.point_total,
    })),
    projectionVersion: context.projection_version,
    projectionReady: context.projection_ready,
    projectedQuota: context.projected_quota,
    projectionSource: context.projection_source,
    projectionEffectiveAt: context.projection_effective_at,
    settingsVersion: context.settings_version,
    settingsMethod: context.settings_method,
    settingsHistoryLength: context.settings_history_length,
    settingsPrecision: context.settings_precision,
    settingsRoundingRule: context.settings_rounding_rule,
    adjustmentBands: context.adjustment_bands.map((band) => ({
      adjustment: band.adjustment,
      lowerBound: band.lower_bound,
      lowerInclusive: band.lower_inclusive,
      position: band.position,
      upperBound: band.upper_bound,
      upperInclusive: band.upper_inclusive,
    })),
  };
}

export async function executeMemberQuotaBootstrap(
  actorUserId: string,
  input: MemberQuotaBootstrapInput,
  correlationId: string,
): Promise<MemberQuotaBootstrapResult> {
  const supabase = await defaultDependencies.createClient();
  const context = await resolveQuotaBootstrapContext(
    supabase,
    actorUserId,
    input.membershipId,
  );

  if (
    context.settings_method === null ||
    context.settings_precision === null ||
    context.settings_rounding_rule === null ||
    context.settings_version <= 0
  ) {
    throw new MutationError("unavailable");
  }

  let projection: MemberQuotaBootstrapProjection;
  try {
    projection = projectMemberQuotaBootstrap({
      adjustmentBands: quotaBandInput(context),
      historyLength: context.settings_history_length,
      initialQuota: input.initialQuota,
      method: context.settings_method,
      precision: context.settings_precision,
      seedTotals: input.seedTotals,
      useInitialQuota: input.useInitialQuota,
    });
  } catch (error) {
    throw new MutationError("validation", { cause: error });
  }

  const projectedSource = projectionSource(context, projection);
  const result = await supabase.rpc("configure_membership_quota_bootstrap", {
    p_actor_user_id: actorUserId,
    p_membership_id: input.membershipId,
    p_initial_quota: input.initialQuota,
    p_use_initial_quota: projection.usesInitialQuota,
    p_seed_totals: input.seedTotals,
    p_projection_ready: projection.ready,
    p_projected_quota: projection.quota,
    p_projection_source: projectedSource,
    p_expected_projection_version: input.expectedProjectionVersion,
    p_expected_settings_version: input.expectedSettingsVersion,
    p_reason: input.reason,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });

  if (result.error) {
    throw mapMemberQuotaBootstrapError(result.error);
  }

  const resultRows = resultRowsSchema.safeParse(result.data);
  if (!resultRows.success) {
    throw new MutationError("unexpected", { cause: resultRows.error });
  }

  const row = resultRows.data[0];

  return {
    groupId: row.configured_group_id,
    membershipId: row.configured_membership_id,
    projectionReady: row.projection_ready,
    projectedQuota: row.projected_quota,
    projectionSource: row.projection_source,
    projectionVersion: row.projection_version,
    settingsVersion: row.settings_version,
    usesInitialQuota: row.uses_initial_quota,
  };
}
