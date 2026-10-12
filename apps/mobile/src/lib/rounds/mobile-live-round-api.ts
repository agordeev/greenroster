import { z } from "zod";

import { mobileSupabase } from "../auth/mobile-supabase";
import { createMobileOperationId } from "../mobile-operation-id";

const uuidSchema = z.uuid();

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

const enabledFieldsSchema = z
  .object({
    golf_points: z.literal(true),
    gross_score: z.boolean(),
    net_score: z.boolean(),
  })
  .strict();

/** Authored fields are deliberately limited to values accepted by the score RPC. */
export const mobileScoreChangedFieldsSchema = z
  .object({
    gross_score: z
      .number()
      .finite()
      .int()
      .min(0)
      .max(300)
      .nullable()
      .optional(),
    net_score: z.number().finite().int().min(0).max(300).nullable().optional(),
    golf_points: z
      .number()
      .finite()
      .min(0)
      .max(100)
      .multipleOf(0.01)
      .nullable()
      .optional(),
    manual_merit: z
      .number()
      .finite()
      .min(-1000)
      .max(1000)
      .multipleOf(0.01)
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((fields, context) => {
    if (Object.keys(fields).length === 0) {
      context.addIssue({
        code: "custom",
        message: "Enter at least one score.",
      });
    }
  });

export type MobileScoreChangedFields = z.infer<
  typeof mobileScoreChangedFieldsSchema
>;

const liveRoundScoreRowSchema = z
  .object({
    round_id: uuidSchema,
    group_id: uuidSchema,
    format: z.enum(["individual_net", "individual_gross"]),
    scheduled_at: instantSchema,
    group_time_zone: z.string().min(1),
    round_version: positiveIntegerSchema,
    participant_id: uuidSchema,
    participant_kind: z.enum(["member", "guest"]),
    membership_id: uuidSchema.nullable(),
    sponsor_membership_id: uuidSchema.nullable(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    rsvp_status: z.enum(["no_response", "playing", "not_playing"]),
    participant_version: positiveIntegerSchema,
    quota_snapshot: numericValueSchema,
    handicap_snapshot: numericValueSchema,
    tee_snapshot: z.enum(["pro", "back", "middle", "front"]).nullable(),
    enabled_final_total_fields: enabledFieldsSchema,
    score_version: nonNegativeIntegerSchema,
    score_revision_id: uuidSchema.nullable(),
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

const scoreReceiptRowSchema = z
  .object({
    participant_id: uuidSchema,
    round_id: uuidSchema,
    group_id: uuidSchema,
    version: positiveIntegerSchema,
    revision_id: uuidSchema,
    gross_score: numericValueSchema,
    net_score: numericValueSchema,
    golf_points: numericValueSchema,
    manual_merit: numericValueSchema,
    plus_minus: numericValueSchema,
    ranking_value: numericValueSchema,
    changed_at: z.string().datetime({ offset: true }),
  })
  .strict();

const syncReceiptRowSchema = z
  .object({
    round_id: uuidSchema,
    group_id: uuidSchema,
    participant_id: uuidSchema,
    score_revision_id: uuidSchema,
    receipt_version: positiveIntegerSchema,
    received_at: z.string().datetime({ offset: true }),
  })
  .strict();

export type MobileLiveRoundCapabilities = Readonly<{
  golfPoints: true;
  grossScore: boolean;
  netScore: boolean;
}>;

export type MobileLiveRoundScore = Readonly<{
  participantId: string;
  version: number;
  revisionId: string | null;
  grossScore: string | null;
  netScore: string | null;
  golfPoints: string | null;
  manualMerit: string | null;
  plusMinus: string | null;
  rankingValue: string | null;
  changedAt: string | null;
}>;

export type MobileLiveRoundScoreCurrentState = MobileLiveRoundScore;

export type MobileLiveRoundParticipant = Readonly<{
  roundId: string;
  groupId: string;
  format: "individual_net" | "individual_gross";
  scheduledAt: string | null;
  groupTimeZone: string;
  roundVersion: number;
  participantId: string;
  participantKind: "member" | "guest";
  membershipId: string | null;
  sponsorMembershipId: string | null;
  firstName: string | null;
  lastName: string | null;
  rsvpStatus: "no_response" | "playing" | "not_playing";
  participantVersion: number;
  quotaSnapshot: string | null;
  handicapSnapshot: string | null;
  teeSnapshot: "pro" | "back" | "middle" | "front" | null;
  enabledFields: MobileLiveRoundCapabilities;
  score: MobileLiveRoundScore;
  canEdit: boolean;
  canAuthorManualMerit: boolean;
}>;

export type MobileLiveRoundScoreReceipt = Readonly<{
  participantId: string;
  roundId: string;
  groupId: string;
  version: number;
  revisionId: string;
  grossScore: string | null;
  netScore: string | null;
  golfPoints: string | null;
  manualMerit: string | null;
  plusMinus: string | null;
  rankingValue: string | null;
  changedAt: string;
}>;

export type MobileLiveRoundSyncReceipt = Readonly<{
  roundId: string;
  groupId: string;
  participantId: string;
  scoreRevisionId: string;
  receiptVersion: number;
  receivedAt: string;
}>;

export type MobileLiveRoundStaleDetails = Readonly<{
  currentScore: MobileLiveRoundScore;
}>;

export type MobileLiveRoundErrorCode =
  "permission_denied" | "stale" | "locked" | "validation" | "unavailable";

export type MobileLiveRoundError = Readonly<{
  ok: false;
  code: MobileLiveRoundErrorCode;
  correlationId?: string;
  message: string;
  details?: MobileLiveRoundStaleDetails;
}>;

export type MobileLiveRoundResult<T> =
  Readonly<{ ok: true; data: T }> | MobileLiveRoundError;

export type MobileLiveRoundApiClient = Pick<typeof mobileSupabase, "rpc">;

export type MobileLiveRoundOperationContext = Readonly<{
  correlationId: string;
  operationId: string;
}>;

export type MobileLiveRoundScoreInput = Readonly<{
  participantId: string;
  changedFields: MobileScoreChangedFields;
  expectedScoreVersion: number;
  deviceOperationId: string;
  clientChangedAt: string;
  reason?: string | null;
}>;

function mapScore(row: z.infer<typeof liveRoundScoreRowSchema>) {
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
  } satisfies MobileLiveRoundScore;
}

function mapParticipant(row: z.infer<typeof liveRoundScoreRowSchema>) {
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
    enabledFields: {
      golfPoints: row.enabled_final_total_fields.golf_points,
      grossScore: row.enabled_final_total_fields.gross_score,
      netScore: row.enabled_final_total_fields.net_score,
    },
    score: mapScore(row),
    canEdit: row.can_edit,
    canAuthorManualMerit: row.can_author_manual_merit,
  } satisfies MobileLiveRoundParticipant;
}

function mapReceipt(row: z.infer<typeof scoreReceiptRowSchema>) {
  return {
    participantId: row.participant_id,
    roundId: row.round_id,
    groupId: row.group_id,
    version: row.version,
    revisionId: row.revision_id,
    grossScore: row.gross_score,
    netScore: row.net_score,
    golfPoints: row.golf_points,
    manualMerit: row.manual_merit,
    plusMinus: row.plus_minus,
    rankingValue: row.ranking_value,
    changedAt: row.changed_at,
  } satisfies MobileLiveRoundScoreReceipt;
}

function mapSyncReceipt(row: z.infer<typeof syncReceiptRowSchema>) {
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    participantId: row.participant_id,
    scoreRevisionId: row.score_revision_id,
    receiptVersion: row.receipt_version,
    receivedAt: row.received_at,
  } satisfies MobileLiveRoundSyncReceipt;
}

function parseStaleDetails(error: Readonly<{ details?: string }>) {
  if (!error.details) return undefined;
  try {
    const parsed: unknown = JSON.parse(error.details);
    const stale = z
      .object({
        participant_id: uuidSchema,
        version: nonNegativeIntegerSchema,
        revision_id: uuidSchema.nullable(),
        gross_score: numericValueSchema,
        net_score: numericValueSchema,
        golf_points: numericValueSchema,
        manual_merit: numericValueSchema,
        plus_minus: numericValueSchema,
        ranking_value: numericValueSchema,
        changed_at: instantSchema,
      })
      .strict()
      .safeParse(parsed);
    if (!stale.success) return undefined;
    return {
      currentScore: {
        participantId: stale.data.participant_id,
        version: stale.data.version,
        revisionId: stale.data.revision_id,
        grossScore: stale.data.gross_score,
        netScore: stale.data.net_score,
        golfPoints: stale.data.golf_points,
        manualMerit: stale.data.manual_merit,
        plusMinus: stale.data.plus_minus,
        rankingValue: stale.data.ranking_value,
        changedAt: stale.data.changed_at,
      },
    } satisfies MobileLiveRoundStaleDetails;
  } catch {
    return undefined;
  }
}

function mapError(
  error: Readonly<{ code?: string; message?: string; details?: string }>,
  correlationId?: string,
): MobileLiveRoundError {
  const normalized = (error.message ?? "unavailable").toLowerCase();
  const supportReference = correlationId ? { correlationId } : {};
  if (
    error.code === "40001" ||
    normalized.includes("version_changed") ||
    normalized.includes("stale") ||
    normalized.includes("operation_id_reused")
  ) {
    return {
      code: "stale",
      ...supportReference,
      details: parseStaleDetails(error),
      message:
        "This score was changed somewhere else. Check the current score, then enter yours again.",
      ok: false,
    };
  }
  if (
    error.code === "P0001" ||
    normalized.includes("locked") ||
    normalized.includes("scoring_locked")
  ) {
    return {
      code: "locked",
      ...supportReference,
      message: "Scores can no longer be changed for this round.",
      ok: false,
    };
  }
  if (
    error.code === "P0003" ||
    normalized.includes("identity_context") ||
    normalized.includes("actor_not_authorized") ||
    normalized.includes("score_actor_not_authorized") ||
    normalized.includes("permission")
  ) {
    return {
      code: "permission_denied",
      ...supportReference,
      message: "You can't change this score.",
      ok: false,
    };
  }
  if (
    error.code === "P0002" ||
    normalized.includes("round_not_found") ||
    normalized.includes("participant_not_found")
  ) {
    return {
      code: "permission_denied",
      ...supportReference,
      message: "This round is no longer available to you.",
      ok: false,
    };
  }
  if (
    error.code === "22023" ||
    normalized.includes("invalid") ||
    normalized.includes("required") ||
    normalized.includes("disabled") ||
    normalized.includes("ineligible")
  ) {
    return {
      code: "validation",
      ...supportReference,
      message: "Check the scores and try again.",
      ok: false,
    };
  }
  return {
    code: "unavailable",
    ...supportReference,
    message:
      "We couldn't save this score. Check your connection and try again.",
    ok: false,
  };
}

function contextDefaults(): MobileLiveRoundOperationContext {
  return {
    correlationId: createMobileOperationId(),
    operationId: createMobileOperationId(),
  };
}

const readInputSchema = z.object({ roundId: uuidSchema }).strict();
const scoreInputSchema = z
  .object({
    participantId: uuidSchema,
    changedFields: mobileScoreChangedFieldsSchema,
    expectedScoreVersion: z.number().int().nonnegative(),
    deviceOperationId: uuidSchema,
    clientChangedAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

const syncInputSchema = z
  .object({
    participantId: uuidSchema,
    scoreRevisionId: uuidSchema,
  })
  .strict();

export function createMobileLiveRoundApi(client: MobileLiveRoundApiClient) {
  const api = {
    async read(
      roundId: string,
    ): Promise<MobileLiveRoundResult<readonly MobileLiveRoundParticipant[]>> {
      const parsedInput = readInputSchema.safeParse({ roundId });
      if (!parsedInput.success) {
        return {
          code: "validation",
          message: "We couldn't load that round.",
          ok: false,
        };
      }
      try {
        const { data, error } = await client.rpc(
          "read_mobile_live_round_scores",
          { p_round_id: parsedInput.data.roundId },
        );
        if (error) return mapError(error);
        const parsed = z.array(liveRoundScoreRowSchema).safeParse(data);
        if (!parsed.success) {
          return {
            code: "unavailable",
            message:
              "We couldn't load this round. Check your connection and try again.",
            ok: false,
          };
        }
        return { data: parsed.data.map(mapParticipant), ok: true };
      } catch {
        return mapError({ message: "network_unavailable" });
      }
    },

    async setScore(
      rawInput: MobileLiveRoundScoreInput,
      operationContext: MobileLiveRoundOperationContext = contextDefaults(),
    ): Promise<MobileLiveRoundResult<MobileLiveRoundScoreReceipt>> {
      const parsedInput = scoreInputSchema.safeParse(rawInput);
      if (!parsedInput.success) {
        return {
          code: "validation",
          correlationId: operationContext.correlationId,
          message: "Check the scores and try again.",
          ok: false,
        };
      }
      try {
        const { data, error } = await client.rpc(
          "set_mobile_round_participant_score",
          {
            p_participant_id: parsedInput.data.participantId,
            p_changed_fields: parsedInput.data.changedFields,
            p_expected_score_version: parsedInput.data.expectedScoreVersion,
            p_device_operation_id: parsedInput.data.deviceOperationId,
            p_client_changed_at: parsedInput.data.clientChangedAt,
            p_correlation_id: operationContext.correlationId,
            p_operation_id: operationContext.operationId,
            p_reason: parsedInput.data.reason ?? null,
          },
        );
        if (error) return mapError(error, operationContext.correlationId);
        const parsed = z.array(scoreReceiptRowSchema).safeParse(data);
        if (!parsed.success || !parsed.data[0]) {
          return {
            code: "unavailable",
            correlationId: operationContext.correlationId,
            message:
              "We couldn't confirm that your score was saved. Check your connection and try again.",
            ok: false,
          };
        }
        return { data: mapReceipt(parsed.data[0]), ok: true };
      } catch {
        return mapError(
          { message: "network_unavailable" },
          operationContext.correlationId,
        );
      }
    },

    async acknowledgeSync(
      rawInput: Readonly<{
        participantId: string;
        scoreRevisionId: string;
      }>,
      operationContext: MobileLiveRoundOperationContext = contextDefaults(),
    ): Promise<MobileLiveRoundResult<MobileLiveRoundSyncReceipt>> {
      const parsedInput = syncInputSchema.safeParse(rawInput);
      if (!parsedInput.success) {
        return {
          code: "validation",
          correlationId: operationContext.correlationId,
          message: "We couldn't confirm this score update. Try again.",
          ok: false,
        };
      }
      try {
        const { data, error } = await client.rpc(
          "acknowledge_mobile_round_score_sync",
          {
            p_participant_id: parsedInput.data.participantId,
            p_score_revision_id: parsedInput.data.scoreRevisionId,
            p_correlation_id: operationContext.correlationId,
            p_operation_id: operationContext.operationId,
          },
        );
        if (error) return mapError(error, operationContext.correlationId);
        const parsed = z.array(syncReceiptRowSchema).safeParse(data);
        if (!parsed.success || !parsed.data[0]) {
          return {
            code: "unavailable",
            correlationId: operationContext.correlationId,
            message:
              "We couldn't confirm this score update. Check your connection and try again.",
            ok: false,
          };
        }
        return { data: mapSyncReceipt(parsed.data[0]), ok: true };
      } catch {
        return mapError(
          { message: "network_unavailable" },
          operationContext.correlationId,
        );
      }
    },
  };
  return {
    ...api,
    // Keep the naming aligned with the other mobile API adapters while the
    // scorecard code can use the more explicit setScore spelling.
    resolve: api.read,
    setParticipantScore: api.setScore,
    updateScore: api.setScore,
    acknowledgeMobileSync: api.acknowledgeSync,
  };
}

export const mobileLiveRoundApi = createMobileLiveRoundApi(mobileSupabase);

export const mobileLiveRoundScoreRowSchema = liveRoundScoreRowSchema;
export const mobileLiveRoundScoreReceiptSchema = scoreReceiptRowSchema;
export const mobileLiveRoundSyncReceiptSchema = syncReceiptRowSchema;
