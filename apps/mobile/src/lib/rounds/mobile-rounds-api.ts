import { z } from "zod";

import { mobileSupabase } from "../auth/mobile-supabase";

const roundRowSchema = z
  .object({
    round_id: z.uuid(),
    group_id: z.uuid(),
    description: z.string().nullable(),
    scheduled_at: z.string().datetime({ offset: true }).nullable(),
    group_time_zone: z.string().min(1),
    venue: z.string().nullable(),
    format: z.enum(["individual_net", "individual_gross"]),
    state: z.enum(["published", "live", "completed", "cancelled"]),
    version: z
      .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
      .transform((value) => Number(value))
      .refine(Number.isSafeInteger),
    participant_status: z.enum(["no_response", "playing", "not_playing"]),
    participant_version: z
      .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
      .transform((value) => Number(value))
      .refine(Number.isSafeInteger)
      .nullable(),
    participant_count: z
      .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)])
      .transform((value) => Number(value))
      .refine(Number.isSafeInteger),
    playing_count: z
      .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)])
      .transform((value) => Number(value))
      .refine(Number.isSafeInteger),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();

const roundDetailRowSchema = roundRowSchema
  .extend({
    round_url: z
      .string()
      .regex(/^https:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/u)
      .nullable(),
    notes: z.string().max(500).nullable(),
    rsvp_deadline_at: z.string().datetime({ offset: true }).nullable(),
    rsvp_changed_at: z.string().datetime({ offset: true }).nullable(),
    cancelled_at: z.string().datetime({ offset: true }).nullable(),
    cancellation_reason: z.string().max(500).nullable(),
  })
  .strict();

const roundRsvpReceiptRowSchema = z
  .object({
    round_id: z.uuid(),
    group_id: z.uuid(),
    participant_id: z.uuid(),
    membership_id: z.uuid(),
    rsvp_status: z.enum(["playing", "not_playing"]),
    version: z
      .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
      .transform((value) => Number(value))
      .refine(Number.isSafeInteger),
    changed_at: z.string().datetime({ offset: true }),
  })
  .strict();

const querySchema = z
  .object({
    completedBefore: z.string().datetime({ offset: true }).nullable(),
    completedLimit: z.number().int().min(1).max(100),
  })
  .strict();

export type MobileRoundState = "published" | "live" | "completed" | "cancelled";

export type MobileRoundSummary = Readonly<{
  roundId: string;
  groupId: string;
  description: string | null;
  scheduledAt: string | null;
  groupTimeZone: string;
  venue: string | null;
  format: "individual_net" | "individual_gross";
  state: MobileRoundState;
  version: number;
  participantStatus: "no_response" | "playing" | "not_playing";
  participantVersion: number | null;
  participantCount: number;
  playingCount: number;
  updatedAt: string;
}>;

export type MobileRoundDetail = Readonly<
  MobileRoundSummary & {
    roundUrl: string | null;
    notes: string | null;
    rsvpDeadlineAt: string | null;
    rsvpChangedAt: string | null;
    cancelledAt: string | null;
    cancellationReason: string | null;
  }
>;

export type MobileRoundsErrorCode =
  "permission_denied" | "validation" | "unavailable";

export type MobileRoundsResult =
  | Readonly<{ ok: true; data: readonly MobileRoundSummary[] }>
  | Readonly<{ ok: false; code: MobileRoundsErrorCode; message: string }>;

type MobileRoundsFailure = Readonly<{
  ok: false;
  code: MobileRoundsErrorCode;
  message: string;
}>;

export type MobileRoundSummaryResult =
  | Readonly<{ ok: true; data: MobileRoundSummary }>
  | Readonly<{ ok: false; code: MobileRoundsErrorCode; message: string }>;

export type MobileRoundDetailResult =
  | Readonly<{ ok: true; data: MobileRoundDetail }>
  | Readonly<{ ok: false; code: MobileRoundsErrorCode; message: string }>;

export type MobileRoundRsvpStatus = "playing" | "not_playing";

export type MobileRoundRsvpReceipt = Readonly<{
  roundId: string;
  groupId: string;
  participantId: string;
  membershipId: string;
  rsvpStatus: MobileRoundRsvpStatus;
  version: number;
  changedAt: string;
}>;

export type MobileRoundsMutationErrorCode =
  "permission_denied" | "stale" | "locked" | "validation" | "unavailable";

export type MobileRoundMutationError = Readonly<{
  ok: false;
  code: MobileRoundsMutationErrorCode;
  correlationId?: string;
  message: string;
}>;

export type MobileRoundRsvpResult =
  | Readonly<{ ok: true; data: MobileRoundRsvpReceipt }>
  | MobileRoundMutationError;

export type MobileRoundOperationContext = Readonly<{
  correlationId: string;
  operationId: string;
}>;

type MobileRoundsClient = Pick<typeof mobileSupabase, "rpc">;

function mapError(
  error: Readonly<{ code?: string; message?: string }>,
): MobileRoundsFailure {
  const normalized = (error.message ?? "").toLowerCase();
  if (
    error.code === "P0003" ||
    error.code === "P0002" ||
    normalized.includes("round_not_found") ||
    normalized.includes("not_authorized") ||
    normalized.includes("permission")
  ) {
    return {
      code: "permission_denied",
      message: "You can't open the group's rounds.",
      ok: false,
    };
  }
  if (error.code === "22023" || normalized.includes("invalid")) {
    return {
      code: "validation",
      message: "We couldn't load rounds. Refresh and try again.",
      ok: false,
    };
  }
  return {
    code: "unavailable",
    message: "We couldn't load rounds. Check your connection and try again.",
    ok: false,
  };
}

function mapRow(row: z.infer<typeof roundRowSchema>): MobileRoundSummary {
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    description: row.description,
    scheduledAt: row.scheduled_at,
    groupTimeZone: row.group_time_zone,
    venue: row.venue,
    format: row.format,
    state: row.state,
    version: row.version,
    participantStatus: row.participant_status,
    participantVersion: row.participant_version,
    participantCount: row.participant_count,
    playingCount: row.playing_count,
    updatedAt: row.updated_at,
  };
}

function mapDetailRow(
  row: z.infer<typeof roundDetailRowSchema>,
): MobileRoundDetail {
  return {
    ...mapRow(row),
    roundUrl: row.round_url,
    notes: row.notes,
    rsvpDeadlineAt: row.rsvp_deadline_at,
    rsvpChangedAt: row.rsvp_changed_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
  };
}

function mapRsvpReceipt(
  row: z.infer<typeof roundRsvpReceiptRowSchema>,
): MobileRoundRsvpReceipt {
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    participantId: row.participant_id,
    membershipId: row.membership_id,
    rsvpStatus: row.rsvp_status,
    version: row.version,
    changedAt: row.changed_at,
  };
}

function invalidSummary(message: string): MobileRoundSummaryResult {
  return { code: "unavailable", message, ok: false };
}

function invalidDetail(message: string): MobileRoundDetailResult {
  return { code: "unavailable", message, ok: false };
}

function mapMutationError(
  error: Readonly<{ code?: string; message?: string }>,
  correlationId?: string,
): MobileRoundMutationError {
  const normalized = (error.message ?? "unavailable").toLowerCase();
  const supportReference = correlationId ? { correlationId } : {};
  if (
    error.code === "40001" ||
    normalized.includes("participant_version_changed") ||
    normalized.includes("stale") ||
    normalized.includes("operation_id_reused")
  ) {
    return {
      code: "stale",
      ...supportReference,
      message:
        "Your response was changed somewhere else. Refresh the round and choose again.",
      ok: false,
    };
  }
  if (
    error.code === "P0001" ||
    normalized.includes("round_rsvp_closed") ||
    normalized.includes("rsvp_closed") ||
    normalized.includes("locked")
  ) {
    return {
      code: "locked",
      ...supportReference,
      message: "You can no longer change your response to this round.",
      ok: false,
    };
  }
  if (
    error.code === "P0003" ||
    normalized.includes("actor_not_authorized") ||
    normalized.includes("recovery_session_forbidden") ||
    normalized.includes("permission")
  ) {
    return {
      code: "permission_denied",
      ...supportReference,
      message: "You can't respond to this round.",
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
    error.code === "22004" ||
    normalized.includes("invalid") ||
    normalized.includes("required")
  ) {
    return {
      code: "validation",
      ...supportReference,
      message: "Choose Playing or Not Playing and try again.",
      ok: false,
    };
  }
  return {
    code: "unavailable",
    ...supportReference,
    message:
      "We couldn't save your response. Check your connection and try again.",
    ok: false,
  };
}

function contextDefaults(): MobileRoundOperationContext {
  return {
    correlationId: createRoundOperationId(),
    operationId: createRoundOperationId(),
  };
}

// Keep the API adapter SSR/test friendly. Native callers may provide an
// explicit operation context; when they do not, use the platform UUID source
// without importing Expo modules into shared data-loading code.
function createRoundOperationId() {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (randomUuid) return randomUuid.call(globalThis.crypto);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/gu, (value) => {
    const random = Math.floor(Math.random() * 16);
    const next = value === "x" ? random : (random & 0x3) | 0x8;
    return next.toString(16);
  });
}

const rsvpInputSchema = z
  .object({
    roundId: z.uuid(),
    rsvpStatus: z.enum(["playing", "not_playing"]),
    expectedParticipantVersion: z.number().int().positive(),
  })
  .strict();

export function createMobileRoundsApi(client: MobileRoundsClient) {
  const api = {
    async list(
      options: Readonly<{
        completedBefore?: string | null;
        completedLimit?: number;
      }> = {},
    ): Promise<MobileRoundsResult> {
      const parsedQuery = querySchema.safeParse({
        completedBefore: options.completedBefore ?? null,
        completedLimit: options.completedLimit ?? 25,
      });
      if (!parsedQuery.success) {
        return {
          code: "validation",
          message: "We couldn't load rounds. Refresh and try again.",
          ok: false,
        };
      }
      try {
        const { data, error } = await client.rpc("list_mobile_rounds", {
          p_completed_before: parsedQuery.data.completedBefore,
          p_completed_limit: parsedQuery.data.completedLimit,
        });
        if (error) return mapError(error);
        const parsed = z.array(roundRowSchema).safeParse(data);
        if (!parsed.success) {
          return {
            code: "unavailable",
            message:
              "We couldn't load rounds. Check your connection and try again.",
            ok: false,
          };
        }
        return { data: parsed.data.map(mapRow), ok: true };
      } catch {
        return mapError({ message: "network_unavailable" });
      }
    },
    async read(roundId: string): Promise<MobileRoundSummaryResult> {
      const parsedRoundId = z.uuid().safeParse(roundId);
      if (!parsedRoundId.success) {
        return {
          code: "validation",
          message: "We couldn't load that round.",
          ok: false,
        };
      }
      try {
        const { data, error } = await client.rpc("read_mobile_round_summary", {
          p_round_id: parsedRoundId.data,
        });
        if (error) return mapError(error);
        const parsed = z.array(roundRowSchema).safeParse(data);
        if (!parsed.success || parsed.data.length !== 1) {
          return invalidSummary(
            "We couldn't load this round. Check your connection and try again.",
          );
        }
        return { data: mapRow(parsed.data[0]), ok: true };
      } catch {
        return mapError({ message: "network_unavailable" });
      }
    },

    async readDetail(roundId: string): Promise<MobileRoundDetailResult> {
      const parsedRoundId = z.uuid().safeParse(roundId);
      if (!parsedRoundId.success) {
        return {
          code: "validation",
          message: "We couldn't load that round.",
          ok: false,
        };
      }
      try {
        const { data, error } = await client.rpc("read_mobile_round_detail", {
          p_round_id: parsedRoundId.data,
        });
        if (error) return mapError(error);
        const parsed = z.array(roundDetailRowSchema).safeParse(data);
        if (!parsed.success || parsed.data.length !== 1) {
          return invalidDetail(
            "We couldn't load this round. Check your connection and try again.",
          );
        }
        return { data: mapDetailRow(parsed.data[0]), ok: true };
      } catch {
        return mapError({ message: "network_unavailable" });
      }
    },

    async setRsvp(
      rawInput: Readonly<{
        roundId: string;
        rsvpStatus: MobileRoundRsvpStatus;
        expectedParticipantVersion: number;
      }>,
      operationContext: MobileRoundOperationContext = contextDefaults(),
    ): Promise<MobileRoundRsvpResult> {
      const parsedInput = rsvpInputSchema.safeParse(rawInput);
      if (!parsedInput.success) {
        return {
          code: "validation",
          correlationId: operationContext.correlationId,
          message: "Choose Playing or Not Playing and try again.",
          ok: false,
        };
      }
      try {
        const { data, error } = await client.rpc(
          "set_mobile_round_participant_rsvp",
          {
            p_round_id: parsedInput.data.roundId,
            p_rsvp_status: parsedInput.data.rsvpStatus,
            p_expected_participant_version:
              parsedInput.data.expectedParticipantVersion,
            p_correlation_id: operationContext.correlationId,
            p_operation_id: operationContext.operationId,
          },
        );
        if (error)
          return mapMutationError(error, operationContext.correlationId);
        const parsed = z.array(roundRsvpReceiptRowSchema).safeParse(data);
        if (!parsed.success || !parsed.data[0] || parsed.data.length !== 1) {
          return {
            code: "unavailable",
            correlationId: operationContext.correlationId,
            message:
              "We couldn't confirm your response. Check your connection and try again.",
            ok: false,
          };
        }
        return { data: mapRsvpReceipt(parsed.data[0]), ok: true };
      } catch {
        return mapMutationError(
          { message: "network_unavailable" },
          operationContext.correlationId,
        );
      }
    },
  };
  return {
    ...api,
    detail: api.readDetail,
    readRoundDetail: api.readDetail,
    setParticipantRsvp: api.setRsvp,
    updateRsvp: api.setRsvp,
    rsvp: api.setRsvp,
  };
}

export const mobileRoundsApi = createMobileRoundsApi(mobileSupabase);

export const mobileRoundSummarySchema = roundRowSchema;
export const mobileRoundDetailSchema = roundDetailRowSchema;
export const mobileRoundRsvpReceiptSchema = roundRsvpReceiptRowSchema;
