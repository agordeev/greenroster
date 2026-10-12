import "server-only";

import { z } from "zod";

import type {
  RoundScoreCurrentState,
  RoundScoreExecutionInput,
  RoundScoreReceipt,
} from "../../domain/round-score";
import { MutationError, type MutationFieldErrors } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";
import { numericValueSchema, safePositiveInteger } from "./rpc-shared";

const roundScoreRowsSchema = z
  .array(
    z
      .object({
        participant_id: z.uuid(),
        round_id: z.uuid(),
        group_id: z.uuid(),
        version: z.union([z.number().int().positive(), z.string()]),
        revision_id: z.uuid(),
        gross_score: numericValueSchema,
        net_score: numericValueSchema,
        golf_points: numericValueSchema,
        manual_merit: numericValueSchema,
        plus_minus: numericValueSchema,
        ranking_value: numericValueSchema,
        changed_at: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .length(1);

type SupabaseRpcError = Readonly<{
  code?: string;
  message?: string;
  details?: string | null;
}>;

const scoreStateRowSchema = z
  .object({
    participant_id: z.uuid(),
    version: z.union([z.number().int().nonnegative(), z.string()]),
    revision_id: z.uuid().nullable(),
    gross_score: numericValueSchema,
    net_score: numericValueSchema,
    golf_points: numericValueSchema,
    manual_merit: numericValueSchema,
    plus_minus: numericValueSchema,
    ranking_value: numericValueSchema,
    changed_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

function scoreFieldErrors(
  message: string | undefined,
): MutationFieldErrors | undefined {
  switch (message) {
    case "score_version_invalid":
    case "score_version_changed":
      return {
        expectedScoreVersion: ["Refresh the current score before saving."],
      };
    case "score_field_disabled":
      return {
        changedFields: ["This score isn't used in this round."],
      };
    case "score_field_invalid":
      return { changedFields: ["Enter a valid score."] };
    case "score_correction_reason_required":
      return { reason: ["Add a reason to change a saved score."] };
    case "score_reason_invalid":
      return { reason: ["Keep the reason to 500 characters or fewer."] };
    case "participant_not_found":
    case "round_not_found":
      return { participantId: ["This player is no longer in the round."] };
    default:
      return undefined;
  }
}

function currentScoreFromDetails(
  details: string | null | undefined,
): RoundScoreCurrentState | undefined {
  if (!details) return undefined;
  try {
    const parsed = scoreStateRowSchema.safeParse(JSON.parse(details));
    if (!parsed.success) return undefined;
    const row = parsed.data;
    const version =
      typeof row.version === "number" ? row.version : Number(row.version);
    if (!Number.isSafeInteger(version) || version < 0) return undefined;
    return {
      participantId: row.participant_id,
      version,
      revisionId: row.revision_id,
      grossScore: row.gross_score,
      netScore: row.net_score,
      golfPoints: row.golf_points,
      manualMerit: row.manual_merit,
      plusMinus: row.plus_minus,
      rankingValue: row.ranking_value,
      changedAt: row.changed_at,
    };
  } catch {
    return undefined;
  }
}

function mapRoundScoreError(error: SupabaseRpcError): MutationError {
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
    const currentScore = currentScoreFromDetails(error.details);
    return new MutationError("stale_version", {
      cause: error,
      ...(currentScore ? { details: { currentScore } } : {}),
    });
  }
  if (error.code === "23505") {
    return new MutationError("operation_reused", { cause: error });
  }
  if (
    error.code === "22003" ||
    error.code === "22004" ||
    error.code === "22023" ||
    error.code === "22P02" ||
    error.code === "23502" ||
    error.code === "23514"
  ) {
    const fieldErrors = scoreFieldErrors(error.message);
    return new MutationError("validation", {
      cause: error,
      ...(fieldErrors ? { fieldErrors } : {}),
    });
  }
  if (!error.code) {
    return new MutationError("transient", { cause: error });
  }
  return new MutationError("unexpected", { cause: error });
}

export async function executeSetRoundParticipantScore(
  actorUserId: string,
  input: RoundScoreExecutionInput,
  correlationId: string,
): Promise<RoundScoreReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("set_round_participant_score", {
    p_actor_user_id: actorUserId,
    p_participant_id: input.participantId,
    p_changed_fields: input.changedFields,
    p_expected_score_version: input.expectedScoreVersion,
    p_device_operation_id: input.deviceOperationId,
    p_source: input.source,
    p_reason: input.reason ?? null,
    p_client_changed_at: input.clientChangedAt,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapRoundScoreError(error);

  const parsed = roundScoreRowsSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  const [row] = parsed.data;
  return {
    participantId: row.participant_id,
    roundId: row.round_id,
    groupId: row.group_id,
    version: safePositiveInteger(row.version, "Invalid score version."),
    revisionId: row.revision_id,
    grossScore: row.gross_score,
    netScore: row.net_score,
    golfPoints: row.golf_points,
    manualMerit: row.manual_merit,
    plusMinus: row.plus_minus,
    rankingValue: row.ranking_value,
    changedAt: row.changed_at,
  };
}
