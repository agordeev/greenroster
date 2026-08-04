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

const nonNegativeIntegerSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(
    (value) => Number.isSafeInteger(value) && value >= 0,
    "Invalid non-negative integer.",
  );

const positiveIntegerSchema = nonNegativeIntegerSchema.refine(
  (value) => value > 0,
  "Invalid positive integer.",
);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const instantSchema = z.string().datetime({ offset: true });
const sourceSchema = z.record(z.string(), z.unknown());

const standingsRowSchema = z
  .object({
    group_id: uuidSchema,
    group_name: z.string().min(1),
    group_time_zone: z.string().min(1),
    standings_reset_date: dateSchema.nullable(),
    membership_id: uuidSchema,
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    merit_total: numericValueSchema,
    rounds_played: nonNegativeIntegerSchema,
    standing_rank: positiveIntegerSchema.nullable(),
    is_actor: z.boolean(),
    quota_projection_ready: z.boolean(),
    projected_quota: nullableNumericValueSchema,
    projection_source: sourceSchema,
    uses_initial_quota_next: z.boolean(),
    eligible_quota_count: nonNegativeIntegerSchema,
  })
  .strict();

const quotaHistoryRowSchema = z
  .object({
    group_id: uuidSchema,
    group_name: z.string().min(1),
    group_time_zone: z.string().min(1),
    standings_reset_date: dateSchema.nullable(),
    membership_id: uuidSchema,
    history_id: uuidSchema,
    completion_id: uuidSchema,
    round_id: uuidSchema,
    completed_at: instantSchema,
    round_description: z.string().nullable(),
    format: z.enum(["individual_net", "individual_gross"]),
    point_total: numericValueSchema,
    plus_minus: nullableNumericValueSchema,
    quota_before: nullableNumericValueSchema,
    quota_after: numericValueSchema,
    method: z.enum(["moving_average", "best_10_of_20", "previous_plus_minus"]),
    source: sourceSchema,
    counts_in_standings: z.boolean(),
  })
  .strict();

export type MobileMemberStanding = Readonly<{
  groupId: string;
  groupName: string;
  groupTimeZone: string;
  standingsResetDate: string | null;
  membershipId: string;
  firstName: string | null;
  lastName: string | null;
  meritTotal: string;
  roundsPlayed: number;
  standingRank: number | null;
  isActor: boolean;
  quotaProjectionReady: boolean;
  projectedQuota: string | null;
  projectionSource: Readonly<Record<string, unknown>>;
  usesInitialQuotaNext: boolean;
  eligibleQuotaCount: number;
}>;

export type MobileMemberQuotaHistory = Readonly<{
  groupId: string;
  groupName: string;
  groupTimeZone: string;
  standingsResetDate: string | null;
  membershipId: string;
  historyId: string;
  completionId: string;
  roundId: string;
  completedAt: string;
  roundDescription: string | null;
  format: "individual_net" | "individual_gross";
  pointTotal: string;
  plusMinus: string | null;
  quotaBefore: string | null;
  quotaAfter: string;
  method: "moving_average" | "best_10_of_20" | "previous_plus_minus";
  source: Readonly<Record<string, unknown>>;
  countsInStandings: boolean;
}>;

export type MobileMemberResultsErrorCode =
  "permission_denied" | "validation" | "unavailable";

export type MobileMemberStandingsResult =
  | Readonly<{
      ok: true;
      data: readonly MobileMemberStanding[];
    }>
  | Readonly<{
      ok: false;
      code: MobileMemberResultsErrorCode;
      message: string;
    }>;

export type MobileMemberQuotaHistoryResult =
  | Readonly<{
      ok: true;
      data: readonly MobileMemberQuotaHistory[];
    }>
  | Readonly<{
      ok: false;
      code: MobileMemberResultsErrorCode;
      message: string;
    }>;

type MobileMemberResultsClient = Pick<typeof mobileSupabase, "rpc">;

function mapError(
  error: Readonly<{ code?: string; message?: string }>,
): Readonly<{
  ok: false;
  code: MobileMemberResultsErrorCode;
  message: string;
}> {
  const normalized = (error.message ?? "unavailable").toLowerCase();
  if (
    error.code === "P0002" ||
    error.code === "P0003" ||
    normalized.includes("not_available") ||
    normalized.includes("not_authorized") ||
    normalized.includes("permission") ||
    normalized.includes("recovery_session")
  ) {
    return {
      code: "permission_denied",
      message: "These standings and history are not available to this account.",
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
      message: "The standings request is invalid. Refresh and try again.",
      ok: false,
    };
  }
  return {
    code: "unavailable",
    message:
      "GreenRoster could not load standings and history. Check your connection and try again.",
    ok: false,
  };
}

function mapStanding(
  row: z.infer<typeof standingsRowSchema>,
): MobileMemberStanding {
  return {
    groupId: row.group_id,
    groupName: row.group_name,
    groupTimeZone: row.group_time_zone,
    standingsResetDate: row.standings_reset_date,
    membershipId: row.membership_id,
    firstName: row.first_name,
    lastName: row.last_name,
    meritTotal: row.merit_total,
    roundsPlayed: row.rounds_played,
    standingRank: row.standing_rank,
    isActor: row.is_actor,
    quotaProjectionReady: row.quota_projection_ready,
    projectedQuota: row.projected_quota,
    projectionSource: row.projection_source,
    usesInitialQuotaNext: row.uses_initial_quota_next,
    eligibleQuotaCount: row.eligible_quota_count,
  };
}

function mapQuotaHistory(
  row: z.infer<typeof quotaHistoryRowSchema>,
): MobileMemberQuotaHistory {
  return {
    groupId: row.group_id,
    groupName: row.group_name,
    groupTimeZone: row.group_time_zone,
    standingsResetDate: row.standings_reset_date,
    membershipId: row.membership_id,
    historyId: row.history_id,
    completionId: row.completion_id,
    roundId: row.round_id,
    completedAt: row.completed_at,
    roundDescription: row.round_description,
    format: row.format,
    pointTotal: row.point_total,
    plusMinus: row.plus_minus,
    quotaBefore: row.quota_before,
    quotaAfter: row.quota_after,
    method: row.method,
    source: row.source,
    countsInStandings: row.counts_in_standings,
  };
}

export function createMobileMemberStandingsApi(
  client: MobileMemberResultsClient,
) {
  return {
    async read(): Promise<MobileMemberStandingsResult> {
      try {
        const { data, error } = await client.rpc(
          "read_mobile_member_standings",
        );
        if (error) return mapError(error);
        const parsed = z.array(standingsRowSchema).safeParse(data);
        if (!parsed.success) {
          return {
            code: "unavailable",
            message: "GreenRoster returned invalid standings.",
            ok: false,
          };
        }
        return { data: parsed.data.map(mapStanding), ok: true };
      } catch {
        return mapError({ message: "network_unavailable" });
      }
    },
  };
}

export function createMobileMemberQuotaHistoryApi(
  client: MobileMemberResultsClient,
) {
  return {
    async read(): Promise<MobileMemberQuotaHistoryResult> {
      try {
        const { data, error } = await client.rpc(
          "read_mobile_member_quota_history",
        );
        if (error) return mapError(error);
        const parsed = z.array(quotaHistoryRowSchema).safeParse(data);
        if (!parsed.success) {
          return {
            code: "unavailable",
            message: "GreenRoster returned invalid quota history.",
            ok: false,
          };
        }
        return { data: parsed.data.map(mapQuotaHistory), ok: true };
      } catch {
        return mapError({ message: "network_unavailable" });
      }
    },
  };
}

export function createMobileMemberResultsApi(
  client: MobileMemberResultsClient,
) {
  const standingsApi = createMobileMemberStandingsApi(client);
  const quotaHistoryApi = createMobileMemberQuotaHistoryApi(client);
  return {
    readStandings: standingsApi.read,
    readQuotaHistory: quotaHistoryApi.read,
  };
}

export const mobileMemberStandingsApi =
  createMobileMemberStandingsApi(mobileSupabase);
export const mobileMemberQuotaHistoryApi =
  createMobileMemberQuotaHistoryApi(mobileSupabase);
export const mobileMemberResultsApi =
  createMobileMemberResultsApi(mobileSupabase);

export const mobileMemberStandingsRowSchema = standingsRowSchema;
export const mobileMemberQuotaHistoryRowSchema = quotaHistoryRowSchema;
