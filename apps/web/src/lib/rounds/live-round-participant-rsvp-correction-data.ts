import "server-only";

import { z } from "zod";

import type {
  LiveRoundParticipantNotPlayingExecutionInput,
  LiveRoundParticipantNotPlayingReceipt,
} from "../../domain/live-round-participant-rsvp-correction";
import type { RoundScoreCurrentState } from "../../domain/round-score";
import { MutationError, type MutationFieldErrors } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";
import { safePositiveInteger } from "./rpc-shared";

const liveRoundParticipantNotPlayingRowsSchema = z
  .array(
    z
      .object({
        round_id: z.uuid(),
        group_id: z.uuid(),
        participant_id: z.uuid(),
        membership_id: z.uuid().nullable(),
        rsvp_status: z.literal("not_playing"),
        version: z.union([z.number().int().positive(), z.string()]),
        score_invalidated: z.boolean(),
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

const staleScoreStateSchema = z
  .object({
    participant_id: z.uuid(),
    version: z.union([z.number().int().nonnegative(), z.string()]),
    revision_id: z.uuid().nullable(),
    gross_score: z.union([z.number(), z.string()]).nullable(),
    net_score: z.union([z.number(), z.string()]).nullable(),
    golf_points: z.union([z.number(), z.string()]).nullable(),
    manual_merit: z.union([z.number(), z.string()]).nullable(),
    plus_minus: z.union([z.number(), z.string()]).nullable(),
    ranking_value: z.union([z.number(), z.string()]).nullable(),
    changed_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

function numericString(value: number | string | null): string | null {
  return value === null ? null : String(value);
}

function currentScoreFromDetails(
  details: string | null | undefined,
): RoundScoreCurrentState | undefined {
  if (!details) return undefined;
  try {
    const parsed = staleScoreStateSchema.safeParse(JSON.parse(details));
    if (!parsed.success) return undefined;
    const row = parsed.data;
    const version =
      typeof row.version === "number" ? row.version : Number(row.version);
    if (!Number.isSafeInteger(version) || version < 0) return undefined;
    return {
      participantId: row.participant_id,
      version,
      revisionId: row.revision_id,
      grossScore: numericString(row.gross_score),
      netScore: numericString(row.net_score),
      golfPoints: numericString(row.golf_points),
      manualMerit: numericString(row.manual_merit),
      plusMinus: numericString(row.plus_minus),
      rankingValue: numericString(row.ranking_value),
      changedAt: row.changed_at,
    };
  } catch {
    return undefined;
  }
}

function correctionFieldErrors(
  message: string | undefined,
): MutationFieldErrors | undefined {
  switch (message) {
    case "participant_version_changed":
    case "rsvp_version_invalid":
      return {
        expectedParticipantVersion: [
          "Refresh the live round before trying this correction again.",
        ],
      };
    case "score_version_invalid":
      return {
        expectedScoreVersion: [
          "Refresh the current score before trying this correction again.",
        ],
      };
    case "score_revision_context_required":
      return {
        expectedScoreRevisionId: [
          "Refresh the current score before trying this correction again.",
        ],
      };
    case "rsvp_change_confirmation_required":
      return {
        confirmed: ["Confirm the participant correction before saving."],
      };
    case "rsvp_change_reason_required":
      return { reason: ["Add a reason between 1 and 500 characters."] };
    case "participant_not_found":
    case "round_not_found":
      return {
        participantId: ["This live participant is no longer available."],
      };
    default:
      return undefined;
  }
}

function mapLiveRoundParticipantNotPlayingError(
  error: SupabaseRpcError,
): MutationError {
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
    const fieldErrors = correctionFieldErrors(error.message);
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

export async function executeSetLiveRoundParticipantNotPlaying(
  actorUserId: string,
  input: LiveRoundParticipantNotPlayingExecutionInput,
  correlationId: string,
): Promise<LiveRoundParticipantNotPlayingReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc(
    "set_live_round_participant_not_playing",
    {
      p_actor_user_id: actorUserId,
      p_round_id: input.roundId,
      p_participant_id: input.participantId,
      p_expected_participant_version: input.expectedParticipantVersion,
      p_expected_score_version: input.expectedScoreVersion,
      p_expected_score_revision_id: input.expectedScoreRevisionId,
      p_confirmed: input.confirmed,
      p_reason: input.reason,
      p_source: input.source,
      p_correlation_id: correlationId,
      p_operation_id: input.operationId,
    },
  );
  if (error) throw mapLiveRoundParticipantNotPlayingError(error);

  const parsed = liveRoundParticipantNotPlayingRowsSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  const [row] = parsed.data;
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    participantId: row.participant_id,
    membershipId: row.membership_id,
    rsvpStatus: row.rsvp_status,
    version: safePositiveInteger(row.version, "Invalid participant version."),
    scoreInvalidated: row.score_invalidated,
    changedAt: row.changed_at,
  };
}
