import { z } from "zod";

import { mobileSupabase } from "../auth/mobile-supabase";

const uuidSchema = z.uuid();

const numericValueSchema = z
  .union([
    z.number().finite(),
    z.string().regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/u),
  ])
  .transform((value) => String(value));

const nullableNumericValueSchema = numericValueSchema.nullable();

const positiveIntegerSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(
    (value) => value > 0 && Number.isSafeInteger(value),
    "Invalid positive integer.",
  );

const nullablePositiveIntegerSchema = positiveIntegerSchema.nullable();

const officialResultRowSchema = z
  .object({
    round_id: uuidSchema,
    group_id: uuidSchema,
    completion_id: uuidSchema,
    completion_number: positiveIntegerSchema,
    completed_at: z.string().datetime({ offset: true }),
    round_version: positiveIntegerSchema,
    participant_id: uuidSchema,
    participant_kind: z.enum(["member", "guest"]),
    membership_id: uuidSchema.nullable(),
    sponsor_membership_id: uuidSchema.nullable(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    rsvp_status: z.enum(["no_response", "playing", "not_playing"]),
    rsvp_changed_at: z.string().datetime({ offset: true }).nullable(),
    score_revision_id: uuidSchema,
    golf_points: nullableNumericValueSchema,
    gross_score: nullableNumericValueSchema,
    net_score: nullableNumericValueSchema,
    quota_snapshot: nullableNumericValueSchema,
    plus_minus: nullableNumericValueSchema,
    ranking_value: nullableNumericValueSchema,
    competition_rank: nullablePositiveIntegerSchema,
    participation_merit: numericValueSchema,
    placement_merit: numericValueSchema,
    manual_merit: numericValueSchema,
    generated_merit: numericValueSchema,
    total_merit: numericValueSchema,
  })
  .strict();

export type MobileOfficialRoundResult = Readonly<{
  roundId: string;
  groupId: string;
  completionId: string;
  completionNumber: number;
  completedAt: string;
  roundVersion: number;
  participantId: string;
  participantKind: "member" | "guest";
  membershipId: string | null;
  sponsorMembershipId: string | null;
  firstName: string | null;
  lastName: string | null;
  rsvpStatus: "no_response" | "playing" | "not_playing";
  rsvpChangedAt: string | null;
  scoreRevisionId: string;
  golfPoints: string | null;
  grossScore: string | null;
  netScore: string | null;
  quotaSnapshot: string | null;
  plusMinus: string | null;
  rankingValue: string | null;
  competitionRank: number | null;
  participationMerit: string;
  placementMerit: string;
  manualMerit: string;
  generatedMerit: string;
  totalMerit: string;
}>;

export type MobileOfficialResultsErrorCode =
  "permission_denied" | "validation" | "unavailable";

export type MobileOfficialResultsResult =
  | Readonly<{
      ok: true;
      data: readonly MobileOfficialRoundResult[];
    }>
  | Readonly<{
      ok: false;
      code: MobileOfficialResultsErrorCode;
      message: string;
    }>;

type MobileOfficialResultsClient = Pick<typeof mobileSupabase, "rpc">;

function mapError(
  error: Readonly<{ code?: string; message?: string }>,
): Readonly<{
  ok: false;
  code: MobileOfficialResultsErrorCode;
  message: string;
}> {
  const normalized = (error.message ?? "unavailable").toLowerCase();
  if (
    error.code === "P0003" ||
    error.code === "P0002" ||
    normalized.includes("round_not_found") ||
    normalized.includes("round_results_not_available") ||
    normalized.includes("recovery_session") ||
    normalized.includes("actor_not_authorized") ||
    normalized.includes("permission")
  ) {
    return {
      code: "permission_denied",
      message: "This official result is no longer available to this account.",
      ok: false,
    };
  }
  if (
    error.code === "22023" ||
    normalized.includes("invalid") ||
    normalized.includes("required")
  ) {
    return {
      code: "validation",
      message: "The official result request is invalid. Refresh and try again.",
      ok: false,
    };
  }
  return {
    code: "unavailable",
    message:
      "GreenRoster could not load this official result. Check your connection and try again.",
    ok: false,
  };
}

function mapRow(
  row: z.infer<typeof officialResultRowSchema>,
): MobileOfficialRoundResult {
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    completionId: row.completion_id,
    completionNumber: row.completion_number,
    completedAt: row.completed_at,
    roundVersion: row.round_version,
    participantId: row.participant_id,
    participantKind: row.participant_kind,
    membershipId: row.membership_id,
    sponsorMembershipId: row.sponsor_membership_id,
    firstName: row.first_name,
    lastName: row.last_name,
    rsvpStatus: row.rsvp_status,
    rsvpChangedAt: row.rsvp_changed_at,
    scoreRevisionId: row.score_revision_id,
    golfPoints: row.golf_points,
    grossScore: row.gross_score,
    netScore: row.net_score,
    quotaSnapshot: row.quota_snapshot,
    plusMinus: row.plus_minus,
    rankingValue: row.ranking_value,
    competitionRank: row.competition_rank,
    participationMerit: row.participation_merit,
    placementMerit: row.placement_merit,
    manualMerit: row.manual_merit,
    generatedMerit: row.generated_merit,
    totalMerit: row.total_merit,
  };
}

const readInputSchema = z.object({ roundId: uuidSchema }).strict();

export function createMobileOfficialResultsApi(
  client: MobileOfficialResultsClient,
) {
  return {
    async read(roundId: string): Promise<MobileOfficialResultsResult> {
      const parsedInput = readInputSchema.safeParse({ roundId });
      if (!parsedInput.success) {
        return {
          code: "validation",
          message: "That round could not be loaded.",
          ok: false,
        };
      }
      try {
        const { data, error } = await client.rpc(
          "read_mobile_official_round_results",
          { p_round_id: parsedInput.data.roundId },
        );
        if (error) return mapError(error);
        const parsed = z.array(officialResultRowSchema).safeParse(data);
        if (!parsed.success) {
          return {
            code: "unavailable",
            message: "GreenRoster returned an invalid official result.",
            ok: false,
          };
        }
        return { data: parsed.data.map(mapRow), ok: true };
      } catch {
        return mapError({ message: "network_unavailable" });
      }
    },
  };
}

export const mobileOfficialResultsApi =
  createMobileOfficialResultsApi(mobileSupabase);

export const mobileOfficialResultRowSchema = officialResultRowSchema;
