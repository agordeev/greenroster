import "server-only";

import { z } from "zod";

import type {
  RoundHoleScoreInput,
  RoundHoleScoreReceipt,
  RoundHoleScoreRow,
} from "../../domain/round-hole-scorecard";
import { MutationError } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

const integerSchema = z
  .union([z.number().int(), z.string().regex(/^-?\d+$/u)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger);

const rowSchema = z
  .object({
    round_id: z.uuid(),
    group_id: z.uuid(),
    participant_id: z.uuid(),
    participant_kind: z.enum(["member", "guest"]),
    membership_id: z.uuid().nullable(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    hole_number: integerSchema,
    version: integerSchema,
    strokes: z.number().int().nullable(),
    putts: z.number().int().nullable(),
    fairway_hit: z.boolean().nullable(),
    green_in_regulation: z.boolean().nullable(),
    sand_save: z.boolean().nullable(),
    hole_comment: z.string().nullable(),
    updated_at: z.string().datetime({ offset: true }),
    can_edit: z.boolean(),
  })
  .strict();

const receiptSchema = rowSchema
  .pick({
    participant_id: true,
    round_id: true,
    group_id: true,
    hole_number: true,
    version: true,
    strokes: true,
    putts: true,
    fairway_hit: true,
    green_in_regulation: true,
    sand_save: true,
    hole_comment: true,
    updated_at: true,
  })
  .extend({ revision_id: z.uuid() })
  .strict();

type RpcError = Readonly<{
  code?: string;
  message?: string;
  details?: string | null;
}>;

function mapError(error: RpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (error.code === "P0001")
    return new MutationError("locked", { cause: error });
  if (error.code === "40001") {
    let details: unknown;
    try {
      details = error.details ? JSON.parse(error.details) : undefined;
    } catch {
      details = undefined;
    }
    return new MutationError("stale_version", { cause: error, details });
  }
  if (error.code === "23505")
    return new MutationError("operation_reused", { cause: error });
  if (
    error.code === "22023" ||
    error.code === "22004" ||
    error.code === "23514"
  ) {
    return new MutationError("validation", { cause: error });
  }
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

function mapRow(row: z.infer<typeof rowSchema>): RoundHoleScoreRow {
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    participantId: row.participant_id,
    participantKind: row.participant_kind,
    membershipId: row.membership_id,
    firstName: row.first_name,
    lastName: row.last_name,
    holeNumber: row.hole_number,
    version: row.version,
    strokes: row.strokes,
    putts: row.putts,
    fairwayHit: row.fairway_hit,
    greenInRegulation: row.green_in_regulation,
    sandSave: row.sand_save,
    holeComment: row.hole_comment,
    updatedAt: row.updated_at,
    canEdit: row.can_edit,
  };
}

export async function executeReadRoundHoleScorecard(
  actorUserId: string,
  roundId: string,
): Promise<readonly RoundHoleScoreRow[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("read_round_hole_scorecard", {
    p_actor_user_id: actorUserId,
    p_round_id: roundId,
  });
  if (error) throw mapError(error);
  const parsed = z.array(rowSchema).safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return parsed.data.map(mapRow);
}

export async function executeSetRoundParticipantHoleScore(
  actorUserId: string,
  input: RoundHoleScoreInput,
  correlationId: string,
): Promise<RoundHoleScoreReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc(
    "set_round_participant_hole_score",
    {
      p_actor_user_id: actorUserId,
      p_participant_id: input.participantId,
      p_hole_number: input.holeNumber,
      p_changed_fields: input.changedFields,
      p_expected_version: input.expectedVersion,
      p_device_operation_id: input.deviceOperationId,
      p_source: "portal",
      p_reason: input.reason ?? null,
      p_client_changed_at: input.clientChangedAt,
      p_correlation_id: correlationId,
      p_operation_id: input.operationId,
    },
  );
  if (error) throw mapError(error);
  const parsed = z.array(receiptSchema).safeParse(data);
  if (!parsed.success || !parsed.data[0]) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  const row = parsed.data[0];
  return {
    participantId: row.participant_id,
    roundId: row.round_id,
    groupId: row.group_id,
    holeNumber: row.hole_number,
    version: row.version,
    revisionId: row.revision_id,
    strokes: row.strokes,
    putts: row.putts,
    fairwayHit: row.fairway_hit,
    greenInRegulation: row.green_in_regulation,
    sandSave: row.sand_save,
    holeComment: row.hole_comment,
    updatedAt: row.updated_at,
  };
}
