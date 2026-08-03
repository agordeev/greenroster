import "server-only";

import { z } from "zod";

import type {
  LiveRoundScoreParticipant,
  RoundScoreCapabilities,
  RoundScoreCurrentState,
} from "../../domain/round-score";
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

const positiveIntegerSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, "Invalid positive integer.");

const instantSchema = z.string().datetime({ offset: true }).nullable();

const liveRoundScoreRowSchema = z
  .object({
    round_id: z.uuid(),
    group_id: z.uuid(),
    format: z.enum(["individual_net", "individual_gross"]),
    scheduled_at: instantSchema,
    group_time_zone: z.string().min(1),
    round_version: positiveIntegerSchema,
    participant_id: z.uuid(),
    participant_kind: z.enum(["member", "guest"]),
    membership_id: z.uuid().nullable(),
    sponsor_membership_id: z.uuid().nullable(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    rsvp_status: z.enum(["no_response", "playing", "not_playing"]),
    participant_version: positiveIntegerSchema,
    quota_snapshot: numericValueSchema,
    handicap_snapshot: numericValueSchema,
    tee_snapshot: z.enum(["pro", "back", "middle", "front"]).nullable(),
    enabled_final_total_fields: z
      .object({
        golf_points: z.literal(true),
        gross_score: z.boolean(),
        net_score: z.boolean(),
      })
      .strict(),
    score_version: nonNegativeIntegerSchema,
    score_revision_id: z.uuid().nullable(),
    gross_score: numericValueSchema,
    net_score: numericValueSchema,
    golf_points: numericValueSchema,
    manual_merit: numericValueSchema,
    plus_minus: numericValueSchema,
    ranking_value: numericValueSchema,
    score_changed_at: instantSchema,
    can_edit: z.boolean(),
    can_author_manual_merit: z.boolean(),
  })
  .strict();

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function mapLiveScoreReadError(error: SupabaseRpcError): MutationError {
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

function scoreFromRow(
  row: z.infer<typeof liveRoundScoreRowSchema>,
): RoundScoreCurrentState {
  return {
    participantId: row.participant_id,
    version: row.score_version,
    revisionId: row.score_revision_id,
    grossScore: row.gross_score,
    netScore: row.net_score,
    golfPoints: row.golf_points,
    manualMerit: row.manual_merit,
    plusMinus: row.plus_minus,
    rankingValue: row.ranking_value,
    changedAt: row.score_changed_at,
  };
}

function capabilitiesFromRow(
  row: z.infer<typeof liveRoundScoreRowSchema>,
): RoundScoreCapabilities {
  return {
    golfPoints: row.enabled_final_total_fields.golf_points,
    grossScore: row.enabled_final_total_fields.gross_score,
    netScore: row.enabled_final_total_fields.net_score,
  };
}

function participantFromRow(
  row: z.infer<typeof liveRoundScoreRowSchema>,
): LiveRoundScoreParticipant {
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    format: row.format,
    scheduledAt: row.scheduled_at,
    groupTimeZone: row.group_time_zone,
    roundVersion: row.round_version,
    participantId: row.participant_id,
    participantKind: row.participant_kind,
    membershipId: row.membership_id,
    sponsorMembershipId: row.sponsor_membership_id,
    firstName: row.first_name,
    lastName: row.last_name,
    rsvpStatus: row.rsvp_status,
    participantVersion: row.participant_version,
    quotaSnapshot: row.quota_snapshot,
    handicapSnapshot: row.handicap_snapshot,
    teeSnapshot: row.tee_snapshot,
    enabledFields: capabilitiesFromRow(row),
    score: scoreFromRow(row),
    canEdit: row.can_edit,
    canAuthorManualMerit: row.can_author_manual_merit,
  };
}

export async function executeReadLiveRoundScores(
  actorUserId: string,
  roundId: string,
): Promise<readonly LiveRoundScoreParticipant[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("read_live_round_scores", {
    p_actor_user_id: actorUserId,
    p_round_id: roundId,
  });
  if (error) throw mapLiveScoreReadError(error);

  const parsed = z.array(liveRoundScoreRowSchema).safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  return parsed.data.map(participantFromRow);
}
