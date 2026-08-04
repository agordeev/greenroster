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
      message: "This account cannot access the group rounds.",
      ok: false,
    };
  }
  if (error.code === "22023" || normalized.includes("invalid")) {
    return {
      code: "validation",
      message: "The round list request is invalid. Refresh and try again.",
      ok: false,
    };
  }
  return {
    code: "unavailable",
    message:
      "GreenRoster could not load rounds. Check your connection and try again.",
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

function invalidSummary(message: string): MobileRoundSummaryResult {
  return { code: "unavailable", message, ok: false };
}

export function createMobileRoundsApi(client: MobileRoundsClient) {
  return {
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
          message: "The round list request is invalid. Refresh and try again.",
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
            message: "GreenRoster returned an invalid round list.",
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
          message: "That round could not be loaded.",
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
            "GreenRoster returned an invalid round summary.",
          );
        }
        return { data: mapRow(parsed.data[0]), ok: true };
      } catch {
        return mapError({ message: "network_unavailable" });
      }
    },
  };
}

export const mobileRoundsApi = createMobileRoundsApi(mobileSupabase);

export const mobileRoundSummarySchema = roundRowSchema;
