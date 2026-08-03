import "server-only";

import { z } from "zod";

import type {
  RoundParticipantRead,
  RoundRsvpExecutionInput,
  RoundRsvpReceipt,
} from "../../domain/round-rsvp";
import { MutationError, type MutationFieldErrors } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

const roundRsvpRowsSchema = z
  .array(
    z
      .object({
        round_id: z.uuid(),
        group_id: z.uuid(),
        participant_id: z.uuid(),
        membership_id: z.uuid(),
        rsvp_status: z.enum(["playing", "not_playing"]),
        version: z.union([z.number().int().positive(), z.string()]),
        changed_at: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .length(1);

const numericSnapshotSchema = z
  .union([z.number(), z.string()])
  .transform((value) => String(value))
  .nullable();

const roundParticipantRowsSchema = z.array(
  z
    .object({
      round_id: z.uuid(),
      participant_id: z.uuid(),
      group_id: z.uuid(),
      membership_id: z.uuid(),
      first_name: z.string().nullable(),
      last_name: z.string().nullable(),
      rsvp_status: z.enum(["no_response", "playing", "not_playing"]),
      version: z.union([z.number().int().positive(), z.string()]),
      quota_snapshot: numericSnapshotSchema,
      quota_snapshot_source: z.record(z.string(), z.unknown()).nullable(),
      handicap_snapshot: numericSnapshotSchema,
      handicap_snapshot_source: z.enum(["manual", "import"]).nullable(),
      handicap_snapshot_as_of: z.string().nullable(),
      tee_snapshot: z.string().nullable(),
    })
    .strict(),
);

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function rsvpFieldErrors(
  message: string | undefined,
): MutationFieldErrors | undefined {
  switch (message) {
    case "participant_version_changed":
    case "rsvp_version_invalid":
      return {
        expectedParticipantVersion: ["Refresh this round before responding."],
      };
    case "rsvp_source_invalid":
      return { source: ["Use a supported response source."] };
    case "rsvp_status_invalid":
      return { rsvpStatus: ["Choose Playing or Not Playing."] };
    case "round_not_found":
    case "participant_not_found":
      return { roundId: ["This round is no longer available to you."] };
    default:
      return undefined;
  }
}

function mapRoundRsvpError(error: SupabaseRpcError): MutationError {
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
    const fieldErrors = rsvpFieldErrors(error.message);
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

function safeVersion(value: number | string): number {
  const version = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new MutationError("unexpected", {
      cause: new Error("Invalid participant version."),
    });
  }
  return version;
}

function participantFromRow(
  row: z.infer<typeof roundParticipantRowsSchema>[number],
): RoundParticipantRead {
  return {
    roundId: row.round_id,
    participantId: row.participant_id,
    groupId: row.group_id,
    membershipId: row.membership_id,
    firstName: row.first_name,
    lastName: row.last_name,
    rsvpStatus: row.rsvp_status,
    version: safeVersion(row.version),
    quotaSnapshot: row.quota_snapshot,
    quotaSnapshotSource: row.quota_snapshot_source,
    handicapSnapshot: row.handicap_snapshot,
    handicapSnapshotSource: row.handicap_snapshot_source,
    handicapSnapshotAsOf: row.handicap_snapshot_as_of,
    teeSnapshot: row.tee_snapshot,
  };
}

export async function executeReadRoundParticipants(
  actorUserId: string,
  roundId: string,
): Promise<readonly RoundParticipantRead[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("read_round_participants", {
    p_actor_user_id: actorUserId,
    p_round_id: roundId,
  });
  if (error) throw mapRoundRsvpError(error);

  const rows = roundParticipantRowsSchema.safeParse(data);
  if (!rows.success) {
    throw new MutationError("unexpected", { cause: rows.error });
  }
  return rows.data.map(participantFromRow);
}

export async function executeSetRoundRsvp(
  actorUserId: string,
  input: RoundRsvpExecutionInput,
  correlationId: string,
): Promise<RoundRsvpReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("set_round_participant_rsvp", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_rsvp_status: input.rsvpStatus,
    p_expected_participant_version: input.expectedParticipantVersion,
    p_source: input.source,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapRoundRsvpError(error);

  const rows = roundRsvpRowsSchema.safeParse(data);
  if (!rows.success) {
    throw new MutationError("unexpected", { cause: rows.error });
  }
  const [row] = rows.data;
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    participantId: row.participant_id,
    membershipId: row.membership_id,
    rsvpStatus: row.rsvp_status,
    version: safeVersion(row.version),
    changedAt: row.changed_at,
  };
}
