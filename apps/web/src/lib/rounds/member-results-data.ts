import "server-only";

import { z } from "zod";

import { MutationError } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

const numericSnapshotSchema = z
  .union([
    z.number().finite(),
    z.string().regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/u),
  ])
  .transform((value) => String(value))
  .nullable();

const integerSchema = z
  .union([z.number().int(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, "Invalid integer.");

const positiveIntegerSchema = integerSchema.refine(
  (value) => value > 0,
  "Expected a positive integer.",
);

const instantSchema = z.string().datetime({ offset: true });

const resultRowSchema = z
  .object({
    round_id: z.uuid(),
    group_id: z.uuid(),
    completion_id: z.uuid(),
    completion_number: positiveIntegerSchema,
    completed_at: instantSchema,
    round_version: positiveIntegerSchema,
    participant_id: z.uuid(),
    participant_kind: z.enum(["member", "guest"]),
    membership_id: z.uuid().nullable(),
    sponsor_membership_id: z.uuid().nullable(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    rsvp_status: z.enum(["no_response", "playing", "not_playing"]),
    rsvp_changed_at: instantSchema.nullable(),
    score_revision_id: z.uuid().nullable(),
    golf_points: numericSnapshotSchema,
    gross_score: numericSnapshotSchema,
    net_score: numericSnapshotSchema,
    quota_snapshot: numericSnapshotSchema,
    plus_minus: numericSnapshotSchema,
    ranking_value: numericSnapshotSchema,
    competition_rank: positiveIntegerSchema.nullable(),
    participation_merit: numericSnapshotSchema,
    placement_merit: numericSnapshotSchema,
    manual_merit: numericSnapshotSchema,
    generated_merit: numericSnapshotSchema,
    total_merit: numericSnapshotSchema,
  })
  .strict();

const roundSchema = z
  .object({
    id: z.uuid(),
    group_id: z.uuid(),
    description: z.string().nullable(),
    scheduled_at: instantSchema.nullable(),
    group_time_zone: z.string().min(1),
    format: z.enum(["individual_net", "individual_gross"]),
    state: z.enum(["completed"]),
  })
  .strict();

const standingsRowSchema = z
  .object({
    group_id: z.uuid(),
    group_name: z.string().min(1),
    group_time_zone: z.string().min(1),
    standings_reset_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable(),
    membership_id: z.uuid(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    merit_total: numericSnapshotSchema,
    rounds_played: integerSchema,
    standing_rank: positiveIntegerSchema.nullable(),
    is_actor: z.boolean(),
    quota_projection_ready: z.boolean(),
    projected_quota: numericSnapshotSchema,
    projection_source: z.record(z.string(), z.unknown()),
    uses_initial_quota_next: z.boolean(),
    eligible_quota_count: integerSchema,
  })
  .strict();

const quotaHistoryRowSchema = z
  .object({
    group_id: z.uuid(),
    group_name: z.string().min(1),
    group_time_zone: z.string().min(1),
    standings_reset_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable(),
    membership_id: z.uuid(),
    history_id: z.uuid(),
    completion_id: z.uuid(),
    round_id: z.uuid(),
    completed_at: instantSchema,
    round_description: z.string().nullable(),
    format: z.enum(["individual_net", "individual_gross"]),
    point_total: numericSnapshotSchema,
    plus_minus: numericSnapshotSchema,
    quota_before: numericSnapshotSchema,
    quota_after: numericSnapshotSchema,
    method: z.enum(["moving_average", "best_10_of_20", "previous_plus_minus"]),
    source: z.record(z.string(), z.unknown()),
    counts_in_standings: z.boolean(),
  })
  .strict();

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function mapReadError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0002" || error.code === "P0003") {
    return new MutationError(
      error.code === "P0003" ? "forbidden" : "unavailable",
      {
        cause: error,
      },
    );
  }
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

function parseRows<T>(data: unknown, schema: z.ZodType<T>): T[] {
  const parsed = z.array(schema).safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return parsed.data;
}

export type MemberOfficialResult = z.infer<typeof resultRowSchema>;
export type MemberOfficialRound = z.infer<typeof roundSchema>;
export type MemberStanding = z.infer<typeof standingsRowSchema>;
export type MemberQuotaHistory = z.infer<typeof quotaHistoryRowSchema>;

export async function executeReadMemberOfficialResults(
  actorUserId: string,
  roundId: string,
): Promise<
  Readonly<{ round: MemberOfficialRound; results: MemberOfficialResult[] }>
> {
  const supabase = createSupabaseServiceClient();
  const resultsRpc = await supabase.rpc("read_official_round_results", {
    p_actor_user_id: actorUserId,
    p_round_id: roundId,
  });
  if (resultsRpc.error) throw mapReadError(resultsRpc.error);
  const results = parseRows(resultsRpc.data, resultRowSchema);
  const groupId = results[0]?.group_id;
  let roundQuery = supabase
    .from("rounds")
    .select(
      "id, group_id, description, scheduled_at, group_time_zone, format, state",
    )
    .eq("id", roundId);
  if (groupId) roundQuery = roundQuery.eq("group_id", groupId);
  const roundResult = await roundQuery.maybeSingle();
  if (roundResult.error || !roundResult.data) {
    throw new MutationError("unavailable", { cause: roundResult.error });
  }
  const round = roundSchema.safeParse(roundResult.data);
  if (!round.success)
    throw new MutationError("unexpected", { cause: round.error });
  return { round: round.data, results };
}

export async function executeReadMemberStandings(
  actorUserId: string,
): Promise<MemberStanding[]> {
  const supabase = createSupabaseServiceClient();
  const result = await supabase.rpc("read_member_standings", {
    p_actor_user_id: actorUserId,
  });
  if (result.error) throw mapReadError(result.error);
  return parseRows(result.data, standingsRowSchema);
}

export async function executeReadMemberQuotaHistory(
  actorUserId: string,
): Promise<MemberQuotaHistory[]> {
  const supabase = createSupabaseServiceClient();
  const result = await supabase.rpc("read_member_quota_history", {
    p_actor_user_id: actorUserId,
  });
  if (result.error) throw mapReadError(result.error);
  return parseRows(result.data, quotaHistoryRowSchema);
}
