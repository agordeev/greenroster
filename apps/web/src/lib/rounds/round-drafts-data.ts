import "server-only";

import { z } from "zod";

import type {
  CreateRoundDraftInput,
  RoundDraft,
  UpdateRoundDraftInput,
} from "../../domain/round-drafts";
import { MutationError, type MutationFieldErrors } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

const versionSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, "Invalid round version.");

const roundRowSchema = z
  .object({
    round_id: z.uuid(),
    group_id: z.uuid(),
    group_name: z.string().optional(),
    group_time_zone: z.string(),
    description: z.string().nullable(),
    scheduled_at: z.string().nullable(),
    venue: z.string().nullable(),
    round_url: z.string().nullable(),
    notes: z.string().nullable(),
    notes_visible_to_players: z.boolean(),
    rsvp_deadline_at: z.string().nullable(),
    format: z.enum(["individual_net", "individual_gross"]).nullable(),
    enable_gross_score: z.boolean().optional(),
    enable_net_score: z.boolean().optional(),
    state: z.enum(["draft", "published", "live", "completed", "cancelled"]),
    version: versionSchema,
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .strict();

const roundMutationRowsSchema = z.array(roundRowSchema).length(1);
const roundListRowsSchema = z.array(roundRowSchema);

type SupabaseRpcError = Readonly<{
  code?: string;
  message?: string;
}>;

function mapRoundDraftError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003") {
    return new MutationError("forbidden", { cause: error });
  }
  if (error.code === "P0002") {
    return new MutationError("unavailable", { cause: error });
  }
  if (error.code === "P0001") {
    return new MutationError("locked", { cause: error });
  }
  if (error.code === "40001") {
    return new MutationError("stale_version", { cause: error });
  }
  if (
    error.code === "22003" ||
    error.code === "22004" ||
    error.code === "22023" ||
    error.code === "22P02" ||
    error.code === "23505" ||
    error.code === "23514"
  ) {
    const fieldErrors = roundDraftFieldErrors(error.message);
    return new MutationError("validation", {
      cause: error,
      ...(fieldErrors ? { fieldErrors } : {}),
    });
  }
  if (!error.code) {
    return new MutationError("transient", { cause: error });
  }
  return new MutationError("unexpected", { cause: error });
}

function roundDraftFieldErrors(
  message: string | undefined,
): MutationFieldErrors | undefined {
  switch (message) {
    case "round_scheduled_at_invalid":
      return { scheduledLocal: ["Enter a valid local date and time."] };
    case "round_rsvp_deadline_invalid":
      return {
        rsvpDeadlineLocal: [
          "Enter an RSVP deadline before the scheduled round time.",
        ],
      };
    case "round_url_invalid":
      return { roundUrl: ["Use an https:// URL."] };
    case "round_notes_invalid":
      return { notes: ["Notes must be 500 characters or fewer."] };
    case "round_input_invalid":
      return { expectedRoundVersion: ["Refresh before saving."] };
    case "round_format_invalid":
      return { format: ["Choose a supported round format."] };
    default:
      return undefined;
  }
}

function roundFromRow(row: z.infer<typeof roundRowSchema>): RoundDraft {
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    ...(row.group_name !== undefined ? { groupName: row.group_name } : {}),
    groupTimeZone: row.group_time_zone,
    description: row.description,
    scheduledAt: row.scheduled_at,
    venue: row.venue,
    roundUrl: row.round_url,
    notes: row.notes,
    notesVisibleToPlayers: row.notes_visible_to_players,
    rsvpDeadlineAt: row.rsvp_deadline_at,
    format: row.format,
    ...(row.enable_gross_score !== undefined
      ? { enableGrossScore: row.enable_gross_score }
      : {}),
    ...(row.enable_net_score !== undefined
      ? { enableNetScore: row.enable_net_score }
      : {}),
    state: row.state,
    version: row.version,
    ...(row.created_at !== undefined ? { createdAt: row.created_at } : {}),
    ...(row.updated_at !== undefined ? { updatedAt: row.updated_at } : {}),
  };
}

export async function executeCreateRoundDraft(
  actorUserId: string,
  input: CreateRoundDraftInput,
  correlationId: string,
): Promise<RoundDraft> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("create_round_draft", {
    p_actor_user_id: actorUserId,
    p_description: input.description,
    p_scheduled_local: input.scheduledLocal,
    p_venue: input.venue,
    p_round_url: input.roundUrl,
    p_notes: input.notes,
    p_notes_visible_to_players: input.notesVisibleToPlayers,
    p_rsvp_deadline_local: input.rsvpDeadlineLocal,
    p_format: input.format,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });

  if (error) throw mapRoundDraftError(error);
  const rows = roundMutationRowsSchema.safeParse(data);
  if (!rows.success)
    throw new MutationError("unexpected", { cause: rows.error });
  return roundFromRow(rows.data[0]);
}

export async function executeUpdateRoundDraft(
  actorUserId: string,
  input: UpdateRoundDraftInput,
  correlationId: string,
): Promise<RoundDraft> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("update_round_draft", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_description: input.description,
    p_scheduled_local: input.scheduledLocal,
    p_venue: input.venue,
    p_round_url: input.roundUrl,
    p_notes: input.notes,
    p_notes_visible_to_players: input.notesVisibleToPlayers,
    p_rsvp_deadline_local: input.rsvpDeadlineLocal,
    p_format: input.format,
    p_expected_round_version: input.expectedRoundVersion,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });

  if (error) throw mapRoundDraftError(error);
  const rows = roundMutationRowsSchema.safeParse(data);
  if (!rows.success)
    throw new MutationError("unexpected", { cause: rows.error });
  return roundFromRow(rows.data[0]);
}

export async function executeListRoundDrafts(
  actorUserId: string,
): Promise<readonly RoundDraft[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("list_rounds", {
    p_actor_user_id: actorUserId,
  });

  if (error) throw mapRoundDraftError(error);
  const rows = roundListRowsSchema.safeParse(data);
  if (!rows.success)
    throw new MutationError("unexpected", { cause: rows.error });
  return rows.data.map(roundFromRow);
}
