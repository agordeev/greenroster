import { z } from "zod";

import { mobileSupabase } from "../auth/mobile-supabase";
import { createMobileOperationId } from "../mobile-operation-id";

const uuidSchema = z.uuid();
const integerSchema = z
  .union([z.number().int(), z.string().regex(/^\d+$/u)])
  .transform(Number);

const rowSchema = z
  .object({
    round_id: uuidSchema,
    group_id: uuidSchema,
    participant_id: uuidSchema,
    participant_kind: z.enum(["member", "guest"]),
    membership_id: uuidSchema.nullable(),
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
  .extend({ revision_id: uuidSchema })
  .strict();

const statsSchema = z
  .object({
    rounds_tracked: integerSchema,
    holes_with_strokes: integerSchema,
    strokes_total: integerSchema,
    average_strokes: z
      .union([z.number(), z.string()])
      .nullable()
      .transform((v) => (v === null ? null : Number(v))),
    holes_with_putts: integerSchema,
    putts_total: integerSchema,
    average_putts: z
      .union([z.number(), z.string()])
      .nullable()
      .transform((v) => (v === null ? null : Number(v))),
    fairways_hit: integerSchema,
    fairways_attempted: integerSchema,
    greens_hit: integerSchema,
    greens_attempted: integerSchema,
    sand_saves: integerSchema,
    sand_attempted: integerSchema,
  })
  .strict();

export type MobileHoleScoreRow = Readonly<{
  roundId: string;
  groupId: string;
  participantId: string;
  participantKind: "member" | "guest";
  membershipId: string | null;
  firstName: string | null;
  lastName: string | null;
  holeNumber: number;
  version: number;
  strokes: number | null;
  putts: number | null;
  fairwayHit: boolean | null;
  greenInRegulation: boolean | null;
  sandSave: boolean | null;
  holeComment: string | null;
  updatedAt: string;
  canEdit: boolean;
}>;

export type MobileHoleScoreReceipt = Readonly<{
  roundId: string;
  groupId: string;
  participantId: string;
  holeNumber: number;
  version: number;
  strokes: number | null;
  putts: number | null;
  fairwayHit: boolean | null;
  greenInRegulation: boolean | null;
  sandSave: boolean | null;
  holeComment: string | null;
  updatedAt: string;
  revisionId: string;
}>;
export type MobilePersonalGolfStats = Readonly<{
  roundsTracked: number;
  holesWithStrokes: number;
  strokesTotal: number;
  averageStrokes: number | null;
  holesWithPutts: number;
  puttsTotal: number;
  averagePutts: number | null;
  fairwaysHit: number;
  fairwaysAttempted: number;
  greensHit: number;
  greensAttempted: number;
  sandSaves: number;
  sandAttempted: number;
}>;

export type MobileHoleScoreInput = Readonly<{
  participantId: string;
  holeNumber: number;
  changedFields: Readonly<Record<string, unknown>>;
  expectedVersion: number;
  reason?: string | null;
}>;

function mapRow(row: z.infer<typeof rowSchema>): MobileHoleScoreRow {
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

function mapReceipt(
  row: z.infer<typeof receiptSchema>,
): MobileHoleScoreReceipt {
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    participantId: row.participant_id,
    holeNumber: row.hole_number,
    version: row.version,
    strokes: row.strokes,
    putts: row.putts,
    fairwayHit: row.fairway_hit,
    greenInRegulation: row.green_in_regulation,
    sandSave: row.sand_save,
    holeComment: row.hole_comment,
    updatedAt: row.updated_at,
    revisionId: row.revision_id,
  };
}

function mapError(error: Readonly<{ code?: string; message?: string }>) {
  const normalized = (error.message ?? "").toLowerCase();
  if (error.code === "40001" || normalized.includes("version_changed"))
    return "stale" as const;
  if (error.code === "P0003") return "permission_denied" as const;
  if (error.code === "P0001") return "locked" as const;
  if (error.code === "22023" || error.code === "22004")
    return "validation" as const;
  return "unavailable" as const;
}

export const mobileHoleScorecardApi = {
  async read(roundId: string) {
    const { data, error } = await mobileSupabase.rpc(
      "read_mobile_round_hole_scorecard",
      { p_round_id: roundId },
    );
    if (error)
      return {
        ok: false as const,
        code: mapError(error),
        message: "Your hole details could not be loaded.",
      };
    const parsed = z.array(rowSchema).safeParse(data);
    if (!parsed.success)
      return {
        ok: false as const,
        code: "unavailable" as const,
        message: "Your hole details could not be loaded.",
      };
    return { ok: true as const, data: parsed.data.map(mapRow) };
  },
  async set(input: MobileHoleScoreInput) {
    const operationId = createMobileOperationId();
    const correlationId = createMobileOperationId();
    const deviceOperationId = createMobileOperationId();
    const { data, error } = await mobileSupabase.rpc(
      "set_mobile_round_participant_hole_score",
      {
        p_participant_id: input.participantId,
        p_hole_number: input.holeNumber,
        p_changed_fields: input.changedFields,
        p_expected_version: input.expectedVersion,
        p_device_operation_id: deviceOperationId,
        p_reason: input.reason ?? null,
        p_client_changed_at: new Date().toISOString(),
        p_correlation_id: correlationId,
        p_operation_id: operationId,
      },
    );
    if (error)
      return {
        ok: false as const,
        code: mapError(error),
        message: "Your hole details could not be saved.",
      };
    const parsed = z.array(receiptSchema).safeParse(data);
    if (!parsed.success || !parsed.data[0])
      return {
        ok: false as const,
        code: "unavailable" as const,
        message: "Your hole details could not be saved.",
      };
    const row = parsed.data[0];
    return {
      ok: true as const,
      data: mapReceipt(row),
    };
  },
  async stats() {
    const { data, error } = await mobileSupabase.rpc(
      "read_mobile_personal_golf_stats",
    );
    if (error)
      return {
        ok: false as const,
        code: mapError(error),
        message: "Your golf stats could not be loaded.",
      };
    const parsed = z.array(statsSchema).safeParse(data);
    if (!parsed.success || !parsed.data[0])
      return {
        ok: false as const,
        code: "unavailable" as const,
        message: "Your golf stats could not be loaded.",
      };
    const row = parsed.data[0];
    return {
      ok: true as const,
      data: {
        roundsTracked: row.rounds_tracked,
        holesWithStrokes: row.holes_with_strokes,
        strokesTotal: row.strokes_total,
        averageStrokes: row.average_strokes,
        holesWithPutts: row.holes_with_putts,
        puttsTotal: row.putts_total,
        averagePutts: row.average_putts,
        fairwaysHit: row.fairways_hit,
        fairwaysAttempted: row.fairways_attempted,
        greensHit: row.greens_hit,
        greensAttempted: row.greens_attempted,
        sandSaves: row.sand_saves,
        sandAttempted: row.sand_attempted,
      } satisfies MobilePersonalGolfStats,
    };
  },
};
