import "server-only";

import { z } from "zod";

import type {
  RoundCoordinatorDetail,
  RoundCoordinatorParticipant,
} from "../../domain/round-detail";
import { MutationError } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

const numericSnapshotSchema = z
  .union([
    z.number().finite(),
    z.string().regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/u),
  ])
  .transform((value) => String(value))
  .nullable();

const positiveIntegerSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, "Invalid positive integer.");

const nonNegativeIntegerSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, "Invalid non-negative integer.");

const instantSchema = z.string().datetime({ offset: true }).nullable();
const jsonObjectSchema = z.record(z.string(), z.unknown());
const httpsUrlSchema = z
  .string()
  .regex(/^https:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/u)
  .nullable();

const roundSchema = z
  .object({
    round_id: z.uuid(),
    group_id: z.uuid(),
    description: z.string().nullable(),
    scheduled_at: instantSchema,
    group_time_zone: z.string().min(1),
    venue: z.string().nullable(),
    round_url: httpsUrlSchema,
    notes: z.string().max(500).nullable(),
    notes_visible_to_players: z.boolean(),
    rsvp_deadline_at: instantSchema,
    format: z.enum(["individual_net", "individual_gross"]).nullable(),
    state: z.enum(["draft", "published", "live", "completed", "cancelled"]),
    version: positiveIntegerSchema,
    published_at: instantSchema,
    cancelled_at: instantSchema,
    cancellation_reason: z.string().max(500).nullable(),
  })
  .strict();

const ruleSnapshotSchema = z
  .object({
    round_id: z.uuid(),
    group_id: z.uuid(),
    format: z.enum(["individual_net", "individual_gross"]).nullable(),
    quota_method: z
      .enum(["moving_average", "best_10_of_20", "previous_plus_minus"])
      .nullable(),
    moving_average_history_length: nonNegativeIntegerSchema.nullable(),
    quota_precision: nonNegativeIntegerSchema.nullable(),
    quota_rounding_rule: z.literal("half_away_from_zero").nullable(),
    adjustment_bands: z.array(jsonObjectSchema),
    settings_version: nonNegativeIntegerSchema,
  })
  .strict();

const participantSchema = z
  .object({
    round_id: z.uuid(),
    participant_id: z.uuid(),
    group_id: z.uuid(),
    membership_id: z.uuid(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    rsvp_status: z.enum(["no_response", "playing", "not_playing"]),
    version: positiveIntegerSchema,
    quota_snapshot: numericSnapshotSchema,
    quota_snapshot_source: jsonObjectSchema.nullable(),
    handicap_snapshot: numericSnapshotSchema,
    handicap_snapshot_source: z.enum(["manual", "import"]).nullable(),
    handicap_snapshot_as_of: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable(),
    tee_snapshot: z.enum(["pro", "back", "middle", "front"]).nullable(),
  })
  .strict();

const countsSchema = z
  .object({
    playing_count: nonNegativeIntegerSchema,
    not_playing_count: nonNegativeIntegerSchema,
    no_response_count: nonNegativeIntegerSchema,
    guest_count: nonNegativeIntegerSchema,
  })
  .strict();

const envelopeSchema = z
  .object({
    round: roundSchema,
    rule_snapshot: ruleSnapshotSchema.nullable(),
    participants: z.array(participantSchema),
    counts: countsSchema,
  })
  .strict();

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function mapRoundDetailError(error: SupabaseRpcError): MutationError {
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

function participantFromRow(
  row: z.infer<typeof participantSchema>,
): RoundCoordinatorParticipant {
  return {
    roundId: row.round_id,
    participantId: row.participant_id,
    groupId: row.group_id,
    membershipId: row.membership_id,
    firstName: row.first_name,
    lastName: row.last_name,
    rsvpStatus: row.rsvp_status,
    version: row.version,
    quotaSnapshot: row.quota_snapshot,
    quotaSnapshotSource: row.quota_snapshot_source,
    handicapSnapshot: row.handicap_snapshot,
    handicapSnapshotSource: row.handicap_snapshot_source,
    handicapSnapshotAsOf: row.handicap_snapshot_as_of,
    teeSnapshot: row.tee_snapshot,
  };
}

export async function executeReadCoordinatorRoundDetail(
  actorUserId: string,
  roundId: string,
): Promise<RoundCoordinatorDetail> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("read_coordinator_round_detail", {
    p_actor_user_id: actorUserId,
    p_round_id: roundId,
  });
  if (error) throw mapRoundDetailError(error);

  const parsed = envelopeSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  const {
    round,
    rule_snapshot: ruleSnapshot,
    participants,
    counts,
  } = parsed.data;

  return {
    roundId: round.round_id,
    groupId: round.group_id,
    description: round.description,
    scheduledAt: round.scheduled_at,
    groupTimeZone: round.group_time_zone,
    venue: round.venue,
    roundUrl: round.round_url,
    notes: round.notes,
    notesVisibleToPlayers: round.notes_visible_to_players,
    rsvpDeadlineAt: round.rsvp_deadline_at,
    format: round.format,
    state: round.state,
    version: round.version,
    publishedAt: round.published_at,
    cancelledAt: round.cancelled_at,
    cancellationReason: round.cancellation_reason,
    ruleSnapshot: ruleSnapshot
      ? {
          roundId: ruleSnapshot.round_id,
          groupId: ruleSnapshot.group_id,
          format: ruleSnapshot.format,
          quotaMethod: ruleSnapshot.quota_method,
          movingAverageHistoryLength:
            ruleSnapshot.moving_average_history_length,
          quotaPrecision: ruleSnapshot.quota_precision,
          quotaRoundingRule: ruleSnapshot.quota_rounding_rule,
          adjustmentBands: ruleSnapshot.adjustment_bands,
          settingsVersion: ruleSnapshot.settings_version,
        }
      : null,
    participants: participants.map(participantFromRow),
    counts: {
      playing: counts.playing_count,
      notPlaying: counts.not_playing_count,
      noResponse: counts.no_response_count,
      guests: counts.guest_count,
    },
  };
}
