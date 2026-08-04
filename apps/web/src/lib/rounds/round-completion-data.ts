import "server-only";

import { z } from "zod";

import {
  roundCompletionFieldErrors,
  type RoundCompletionInput,
  type RoundCompletionPreview,
  type RoundCompletionPreviewInput,
  type RoundCompletionParticipant,
  type RoundCompletionReadiness,
  type RoundCompletionReceipt,
  type RoundReopenInput,
  type RoundReopenReceipt,
} from "../../domain/round-completion";
import { MutationError } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

const numericValueSchema = z
  .union([
    z.number().finite(),
    z.string().regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/u),
  ])
  .transform((value) => String(value))
  .nullable();

const nonNegativeIntegerSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, "Invalid non-negative integer.");

const positiveIntegerSchema = nonNegativeIntegerSchema.refine(
  (value) => value > 0,
  "Expected a positive integer.",
);

const participantKindSchema = z.enum(["member", "guest"]);

const readinessRowSchema = z
  .object({
    readiness_status: z.enum(["blocked", "warning", "server_ready"]),
    blocker_code: z.string().nullable(),
    warning_code: z.string().nullable(),
    participant_id: z.uuid().nullable(),
    participant_kind: participantKindSchema.nullable(),
    details: z.record(z.string(), z.unknown()),
  })
  .strict();

const meritSchema = z
  .object({
    participation: numericValueSchema,
    placement: numericValueSchema,
    manual: numericValueSchema,
    generated: numericValueSchema,
    total: numericValueSchema,
  })
  .strict();

const participantSchema = z
  .object({
    participant_id: z.uuid(),
    participant_kind: participantKindSchema,
    participant_name: z.string(),
    membership_id: z.uuid().nullable(),
    sponsor_membership_id: z.uuid().nullable(),
    ranking_value: numericValueSchema,
    competition_rank: positiveIntegerSchema.nullable(),
    is_winner: z.boolean(),
    winner_tie_size: nonNegativeIntegerSchema,
    golf_points: numericValueSchema,
    gross_score: numericValueSchema,
    net_score: numericValueSchema,
    quota_snapshot: numericValueSchema,
    quota_before: numericValueSchema,
    quota_after: numericValueSchema,
    plus_minus: numericValueSchema,
    score_revision_id: z.uuid().nullable(),
    standing_before: positiveIntegerSchema.nullable(),
    standing_after: positiveIntegerSchema.nullable(),
    standing_delta: z.number().int().nullable(),
    merit: meritSchema,
  })
  .strict();

const consequenceSchema = z
  .object({
    winner_count: nonNegativeIntegerSchema,
    winner_is_tie: z.boolean(),
    participant_count: nonNegativeIntegerSchema,
    member_quota_impact_count: nonNegativeIntegerSchema,
    standing_impact_count: nonNegativeIntegerSchema,
  })
  .strict();

const previewEnvelopeSchema = z
  .object({
    round_id: z.uuid(),
    group_id: z.uuid(),
    format: z.enum(["individual_net", "individual_gross"]),
    state: z.literal("live"),
    snapshot_present: z.boolean(),
    readiness: z.array(readinessRowSchema),
    server_checks_passed: z.boolean(),
    warning_count: nonNegativeIntegerSchema,
    mobile_sync_check: z.enum(["complete", "blocked", "unavailable"]),
    completion_handshake_required: z.boolean(),
    completion_allowed: z.boolean(),
    consequences: consequenceSchema,
    participants: z.array(participantSchema),
  })
  .strict();

const completionRowsSchema = z
  .array(
    z
      .object({
        round_id: z.uuid(),
        group_id: z.uuid(),
        completion_id: z.uuid(),
        completion_number: positiveIntegerSchema,
        state: z.literal("completed"),
        version: positiveIntegerSchema,
        completed_at: z.string().datetime({ offset: true }),
        outbox_job_id: z.uuid(),
      })
      .strict(),
  )
  .length(1);

const reopenRowsSchema = z
  .array(
    z
      .object({
        round_id: z.uuid(),
        group_id: z.uuid(),
        completion_id: z.uuid(),
        state: z.literal("live"),
        version: positiveIntegerSchema,
        reopened_at: z.string().datetime({ offset: true }),
        reopen_reason: z.string().min(1),
      })
      .strict(),
  )
  .length(1);

const contextEnvelopeSchema = z
  .object({
    round: z
      .object({
        group_id: z.uuid(),
        state: z.enum(["draft", "published", "live", "completed", "cancelled"]),
      })
      .passthrough(),
  })
  .passthrough();

type SupabaseRpcError = Readonly<{
  code?: string;
  message?: string;
  details?: string | null;
}>;

function mapRoundCompletionError(error: SupabaseRpcError): MutationError {
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
    error.code === "22003" ||
    error.code === "22004" ||
    error.code === "22023" ||
    error.code === "22P02" ||
    error.code === "23502" ||
    error.code === "23514"
  ) {
    const fieldErrors = roundCompletionFieldErrors(error.message);
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

function mapPreviewError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003") {
    return new MutationError("forbidden", { cause: error });
  }
  if (error.code === "P0002") {
    return new MutationError("unavailable", { cause: error });
  }
  if (error.code === "P0001") {
    return new MutationError("locked", { cause: error });
  }
  if (!error.code) {
    return new MutationError("transient", { cause: error });
  }
  return new MutationError("unexpected", { cause: error });
}

function previewParticipantFromRow(
  row: z.infer<typeof participantSchema>,
): RoundCompletionParticipant {
  return {
    participantId: row.participant_id,
    participantKind: row.participant_kind,
    participantName: row.participant_name,
    membershipId: row.membership_id,
    sponsorMembershipId: row.sponsor_membership_id,
    rankingValue: row.ranking_value,
    competitionRank: row.competition_rank,
    isWinner: row.is_winner,
    winnerTieSize: row.winner_tie_size,
    golfPoints: row.golf_points,
    grossScore: row.gross_score,
    netScore: row.net_score,
    quotaSnapshot: row.quota_snapshot,
    quotaBefore: row.quota_before,
    quotaAfter: row.quota_after,
    plusMinus: row.plus_minus,
    scoreRevisionId: row.score_revision_id,
    standingBefore: row.standing_before,
    standingAfter: row.standing_after,
    standingDelta: row.standing_delta,
    merit: {
      participation: row.merit.participation ?? "0",
      placement: row.merit.placement ?? "0",
      manual: row.merit.manual ?? "0",
      generated: row.merit.generated ?? "0",
      total: row.merit.total ?? "0",
    },
  };
}

function previewFromEnvelope(
  value: z.infer<typeof previewEnvelopeSchema>,
): RoundCompletionPreview {
  return {
    roundId: value.round_id,
    groupId: value.group_id,
    format: value.format,
    state: value.state,
    snapshotPresent: value.snapshot_present,
    readiness: value.readiness.map((row): RoundCompletionReadiness => ({
      status: row.readiness_status,
      blockerCode: row.blocker_code,
      warningCode: row.warning_code,
      participantId: row.participant_id,
      participantKind: row.participant_kind,
      details: row.details,
    })),
    serverChecksPassed: value.server_checks_passed,
    warningCount: value.warning_count,
    mobileSyncCheck: value.mobile_sync_check,
    completionHandshakeRequired: value.completion_handshake_required,
    completionAllowed: value.completion_allowed,
    consequences: {
      winnerCount: value.consequences.winner_count,
      winnerIsTie: value.consequences.winner_is_tie,
      participantCount: value.consequences.participant_count,
      memberQuotaImpactCount: value.consequences.member_quota_impact_count,
      standingImpactCount: value.consequences.standing_impact_count,
    },
    participants: value.participants.map(previewParticipantFromRow),
  };
}

async function verifyCoordinatorRoundContext(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  actorUserId: string,
  input: RoundCompletionPreviewInput,
): Promise<void> {
  const { data, error } = await supabase.rpc("read_coordinator_round_detail", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
  });
  if (error) throw mapPreviewError(error);
  const parsed = contextEnvelopeSchema.safeParse(data);
  if (!parsed.success || parsed.data.round.group_id !== input.groupId) {
    throw new MutationError("forbidden", {
      cause: new Error("Completion preview tenant mismatch."),
    });
  }
  if (parsed.data.round.state !== "live") {
    throw new MutationError("locked", {
      cause: new Error("Completion preview requires a Live round."),
    });
  }
}

export async function executePreviewLiveRoundCompletion(
  actorUserId: string,
  input: RoundCompletionPreviewInput,
): Promise<RoundCompletionPreview> {
  const supabase = createSupabaseServiceClient();
  await verifyCoordinatorRoundContext(supabase, actorUserId, input);
  const { data, error } = await supabase.rpc("preview_live_round_completion", {
    p_round_id: input.roundId,
    p_group_id: input.groupId,
  });
  if (error) throw mapPreviewError(error);
  const parsed = previewEnvelopeSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  if (
    parsed.data.round_id !== input.roundId ||
    parsed.data.group_id !== input.groupId
  ) {
    throw new MutationError("unexpected", {
      cause: new Error("Completion preview target mismatch."),
    });
  }
  return previewFromEnvelope(parsed.data);
}

export async function executeCompleteLiveRound(
  actorUserId: string,
  input: RoundCompletionInput,
  correlationId: string,
): Promise<RoundCompletionReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("complete_live_round", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_expected_round_version: input.expectedRoundVersion,
    p_confirmed: input.confirmed,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapRoundCompletionError(error);
  const parsed = completionRowsSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  const [row] = parsed.data;
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    completionId: row.completion_id,
    completionNumber: row.completion_number,
    state: row.state,
    version: row.version,
    completedAt: row.completed_at,
    outboxJobId: row.outbox_job_id,
  };
}

export async function executeReopenCompletedRound(
  actorUserId: string,
  input: RoundReopenInput,
  correlationId: string,
): Promise<RoundReopenReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("reopen_completed_round", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_reason: input.reason,
    p_expected_round_version: input.expectedRoundVersion,
    p_confirmed: input.confirmed,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapRoundCompletionError(error);
  const parsed = reopenRowsSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  const [row] = parsed.data;
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    completionId: row.completion_id,
    state: row.state,
    version: row.version,
    reopenedAt: row.reopened_at,
    reopenReason: row.reopen_reason,
  };
}
