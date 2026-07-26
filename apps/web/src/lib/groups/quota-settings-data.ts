import "server-only";

import { z } from "zod";

import type {
  QuotaSettingsInput,
  QuotaSettingsResult,
} from "@/lib/groups/quota-settings";
import { MutationError } from "@/lib/mutations/result";
import { createSupabaseServiceClient } from "@/lib/supabase/service-client";

const quotaSettingsRowsSchema = z
  .array(
    z.object({
      configured_group_id: z.uuid(),
      configured_history_length: z.number().int().nullable(),
      configured_method: z.enum([
        "moving_average",
        "best_10_of_20",
        "previous_plus_minus",
      ]),
      configured_precision: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      configured_rounding_rule: z.literal("half_away_from_zero"),
      settings_version: z.number().int().positive(),
    }),
  )
  .length(1);

type SupabaseRpcError = Readonly<{
  code?: string;
  message?: string;
}>;

function mapQuotaSettingsError(error: SupabaseRpcError): MutationError {
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

function rpcBands(input: QuotaSettingsInput) {
  if (input.method !== "previous_plus_minus") return [];

  return input.bands.map((band) => ({
    adjustment: band.adjustment,
    lower_bound: band.lowerBound,
    lower_inclusive: band.lowerInclusive,
    upper_bound: band.upperBound,
    upper_inclusive: band.upperInclusive,
  }));
}

export async function executeConfigureQuotaSettings(
  actorUserId: string,
  input: QuotaSettingsInput,
  correlationId: string,
): Promise<QuotaSettingsResult> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("configure_group_quota_rules", {
    p_actor_user_id: actorUserId,
    p_method: input.method,
    p_moving_average_history_length: input.historyLength,
    p_precision: input.precision,
    p_rounding_rule: input.roundingRule,
    p_bands: rpcBands(input),
    p_expected_settings_version: input.expectedSettingsVersion,
    p_reason: input.reason,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });

  if (error) throw mapQuotaSettingsError(error);

  const rows = quotaSettingsRowsSchema.safeParse(data);
  if (!rows.success) {
    throw new MutationError("unexpected", { cause: rows.error });
  }

  const [row] = rows.data;
  return {
    groupId: row.configured_group_id,
    historyLength: row.configured_history_length,
    method: row.configured_method,
    precision: row.configured_precision,
    roundingRule: row.configured_rounding_rule,
    settingsVersion: row.settings_version,
  };
}
