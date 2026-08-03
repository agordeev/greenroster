import "server-only";

import { z } from "zod";

import type {
  RoundCancellationInput,
  RoundCancellationReceipt,
} from "../../domain/round-cancellation";
import { MutationError, type MutationFieldErrors } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

const roundCancellationRowsSchema = z
  .array(
    z
      .object({
        round_id: z.uuid(),
        group_id: z.uuid(),
        state: z.literal("cancelled"),
        version: z.union([z.number().int().positive(), z.string()]),
        cancelled_at: z.string().datetime({ offset: true }),
        cancellation_reason: z.string().min(1),
        participant_count: z.union([
          z.number().int().nonnegative(),
          z.string(),
        ]),
        notification_count: z.union([
          z.number().int().nonnegative(),
          z.string(),
        ]),
      })
      .strict(),
  )
  .length(1);

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function safeInteger(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new MutationError("unexpected", {
      cause: new Error("Invalid round cancellation count or version."),
    });
  }
  return parsed;
}

function cancellationFieldErrors(
  message: string | undefined,
): MutationFieldErrors | undefined {
  switch (message) {
    case "round_cancellation_reason_required":
      return { reason: ["Add a reason for cancelling this round."] };
    case "round_version_invalid":
    case "round_version_changed":
      return { expectedRoundVersion: ["Refresh the round before cancelling."] };
    case "round_not_found":
      return { roundId: ["Select a round in this group and refresh."] };
    default:
      return undefined;
  }
}

function mapRoundCancellationError(error: SupabaseRpcError): MutationError {
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
  if (
    error.code === "22003" ||
    error.code === "22004" ||
    error.code === "22023" ||
    error.code === "22P02" ||
    error.code === "23505" ||
    error.code === "23514"
  ) {
    const fieldErrors = cancellationFieldErrors(error.message);
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

export async function executeCancelRound(
  actorUserId: string,
  input: RoundCancellationInput,
  correlationId: string,
): Promise<RoundCancellationReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("cancel_round", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_reason: input.reason,
    p_expected_round_version: input.expectedRoundVersion,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapRoundCancellationError(error);

  const rows = roundCancellationRowsSchema.safeParse(data);
  if (!rows.success) {
    throw new MutationError("unexpected", { cause: rows.error });
  }
  const [row] = rows.data;
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    state: row.state,
    version: safeInteger(row.version),
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    participantCount: safeInteger(row.participant_count),
    notificationCount: safeInteger(row.notification_count),
  };
}
