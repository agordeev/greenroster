import "server-only";

import { z } from "zod";

import type {
  RoundScoringInput,
  RoundScoringReceipt,
} from "../../domain/round-scoring";
import { MutationError, type MutationFieldErrors } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

const roundScoringRowsSchema = z
  .array(
    z
      .object({
        round_id: z.uuid(),
        group_id: z.uuid(),
        state: z.literal("live"),
        version: z.union([z.number().int().positive(), z.string()]),
        opened_at: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .length(1);

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function safePositiveInteger(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new MutationError("unexpected", {
      cause: new Error("Invalid scoring-open version."),
    });
  }
  return parsed;
}

function scoringFieldErrors(
  message: string | undefined,
): MutationFieldErrors | undefined {
  switch (message) {
    case "scoring_open_confirmation_required":
      return { confirmed: ["Confirm that scoring should open now."] };
    case "round_version_invalid":
    case "round_version_changed":
      return {
        expectedRoundVersion: ["Refresh the round before opening scoring."],
      };
    case "round_not_found":
      return { roundId: ["Select a round in this group and refresh."] };
    default:
      return undefined;
  }
}

function mapRoundScoringError(error: SupabaseRpcError): MutationError {
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
    error.code === "22P02"
  ) {
    const fieldErrors = scoringFieldErrors(error.message);
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

export async function executeOpenRoundScoring(
  actorUserId: string,
  input: RoundScoringInput,
  correlationId: string,
): Promise<RoundScoringReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("open_round_scoring", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_expected_round_version: input.expectedRoundVersion,
    p_confirmed: input.confirmed,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapRoundScoringError(error);

  const parsed = roundScoringRowsSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  const [row] = parsed.data;
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    state: row.state,
    version: safePositiveInteger(row.version),
    openedAt: row.opened_at,
  };
}
