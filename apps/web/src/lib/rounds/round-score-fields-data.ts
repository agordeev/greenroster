import "server-only";

import { z } from "zod";

import type {
  RoundScoreFieldsInput,
  RoundScoreFieldsReceipt,
} from "../../domain/round-score-fields";
import { MutationError, type MutationFieldErrors } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

const versionSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, "Invalid round version.");

const rowsSchema = z
  .array(
    z
      .object({
        round_id: z.uuid(),
        group_id: z.uuid(),
        format: z.enum(["individual_net", "individual_gross"]),
        enable_gross_score: z.boolean(),
        enable_net_score: z.boolean(),
        version: versionSchema,
      })
      .strict(),
  )
  .length(1);

type SupabaseRpcError = Readonly<{
  code?: string;
  message?: string;
}>;

function fieldErrors(message: string | undefined): MutationFieldErrors | null {
  switch (message) {
    case "round_version_invalid":
    case "round_version_changed":
      return { expectedRoundVersion: ["Refresh the draft before saving."] };
    case "score_field_capabilities_required":
    case "score_field_capability_invalid":
      return { enableNetScore: ["Choose the scores you want to enter."] };
    case "round_not_found":
      return {
        roundId: [
          "We couldn't find that draft. Refresh the page and try again.",
        ],
      };
    default:
      return null;
  }
}

function mapError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003") {
    return new MutationError("forbidden", { cause: error });
  }
  if (error.code === "P0002") {
    return new MutationError("unavailable", { cause: error });
  }
  if (error.code === "P0001") {
    return new MutationError("locked", { cause: error });
  }
  if (error.code === "40001") {
    return new MutationError("stale_version", { cause: error });
  }
  if (error.code === "23505") {
    return new MutationError("operation_reused", { cause: error });
  }
  if (
    error.code === "22004" ||
    error.code === "22023" ||
    error.code === "22P02" ||
    error.code === "23514"
  ) {
    const mapped = fieldErrors(error.message);
    return new MutationError("validation", {
      cause: error,
      ...(mapped ? { fieldErrors: mapped } : {}),
    });
  }
  if (!error.code) {
    return new MutationError("transient", { cause: error });
  }
  return new MutationError("unexpected", { cause: error });
}

export async function executeSetRoundScoreFields(
  actorUserId: string,
  input: RoundScoreFieldsInput,
  correlationId: string,
): Promise<RoundScoreFieldsReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("set_round_draft_score_fields", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_enable_gross_score: input.enableGrossScore,
    p_enable_net_score: input.enableNetScore,
    p_expected_round_version: input.expectedRoundVersion,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });

  if (error) throw mapError(error);
  const parsed = rowsSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  const [row] = parsed.data;
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    format: row.format,
    enableGrossScore: row.enable_gross_score,
    enableNetScore: row.enable_net_score,
    version: row.version,
  };
}
