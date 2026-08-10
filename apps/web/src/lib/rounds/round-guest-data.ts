import "server-only";

import { z } from "zod";

import type {
  CreateRoundGuestExecutionInput,
  RoundGuestReceipt,
  UpdateRoundGuestExecutionInput,
  WithdrawRoundGuestExecutionInput,
  WithdrawRoundGuestReceipt,
} from "../../domain/round-guest";
import { MutationError, type MutationFieldErrors } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

const numericValue = z
  .union([
    z.number().finite(),
    z.string().regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/u),
  ])
  .transform(String)
  .nullable();

const guestRows = z
  .array(
    z
      .object({
        round_id: z.uuid(),
        group_id: z.uuid(),
        participant_id: z.uuid(),
        participant_kind: z.literal("guest"),
        membership_id: z.null(),
        sponsor_membership_id: z.uuid(),
        first_name: z.string(),
        last_name: z.string(),
        rsvp_status: z.enum(["playing", "not_playing"]),
        version: z.union([z.number().int().positive(), z.string()]),
        quota_snapshot: numericValue,
        quota_snapshot_source: z.record(z.string(), z.unknown()).nullable(),
        handicap_snapshot: numericValue,
        handicap_snapshot_source: z.enum(["manual", "import"]).nullable(),
        handicap_snapshot_as_of: z.string().nullable(),
        tee_snapshot: z.string().nullable(),
        duplicate_like: z.boolean(),
        changed_at: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .length(1);

const withdrawalRows = z
  .array(
    z
      .object({
        round_id: z.uuid(),
        group_id: z.uuid(),
        participant_id: z.uuid(),
        participant_kind: z.literal("guest"),
        membership_id: z.null(),
        sponsor_membership_id: z.uuid(),
        rsvp_status: z.literal("not_playing"),
        version: z.union([z.number().int().positive(), z.string()]),
        score_invalidated: z.boolean(),
        changed_at: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .length(1);

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function safeVersion(value: number | string): number {
  const version = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new MutationError("unexpected", {
      cause: new Error("Invalid guest version."),
    });
  }
  return version;
}

function fieldErrors(
  message: string | undefined,
): MutationFieldErrors | undefined {
  switch (message) {
    case "guest_first_name_invalid":
      return { firstName: ["Choose a first name for your guest."] };
    case "guest_last_name_invalid":
      return { lastName: ["Choose a last name for your guest."] };
    case "guest_quota_required":
      return { quotaSnapshot: ["Enter a quota for your guest in this round."] };
    case "guest_version_changed":
      return {
        expectedParticipantVersion: [
          "Refresh the round before saving your guest.",
        ],
      };
    case "guest_withdraw_confirmation_required":
      return { confirmed: ["Confirm that you want to withdraw your guest."] };
    case "guest_withdraw_reason_required":
      return {
        reason: ["Tell your coordinator why you are withdrawing this guest."],
      };
    default:
      return undefined;
  }
}

function mapGuestError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (error.code === "P0001")
    return new MutationError("locked", { cause: error });
  if (error.code === "40001")
    return new MutationError("stale_version", { cause: error });
  if (error.code === "23505")
    return new MutationError("operation_reused", { cause: error });
  if (
    error.code === "22003" ||
    error.code === "22004" ||
    error.code === "22023" ||
    error.code === "23514"
  ) {
    const mapped = fieldErrors(error.message);
    return new MutationError("validation", {
      cause: error,
      ...(mapped ? { fieldErrors: mapped } : {}),
    });
  }
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

function mapGuestRow(
  row: z.infer<typeof guestRows>[number],
): RoundGuestReceipt {
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    participantId: row.participant_id,
    participantKind: row.participant_kind,
    membershipId: row.membership_id,
    sponsorMembershipId: row.sponsor_membership_id,
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
    duplicateLike: row.duplicate_like,
    changedAt: row.changed_at,
  };
}

export async function executeCreateRoundGuest(
  actorUserId: string,
  input: CreateRoundGuestExecutionInput,
  correlationId: string,
): Promise<RoundGuestReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("create_round_guest", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_sponsor_membership_id: input.sponsorMembershipId ?? null,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_quota_snapshot: input.quotaSnapshot,
    p_handicap_snapshot: input.handicapSnapshot,
    p_tee_snapshot: input.teeSnapshot,
    p_source: input.source,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapGuestError(error);
  const parsed = guestRows.safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return mapGuestRow(parsed.data[0]);
}

export async function executeUpdateRoundGuest(
  actorUserId: string,
  input: UpdateRoundGuestExecutionInput,
  correlationId: string,
): Promise<RoundGuestReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("update_round_guest", {
    p_actor_user_id: actorUserId,
    p_participant_id: input.participantId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_quota_snapshot: input.quotaSnapshot,
    p_handicap_snapshot: input.handicapSnapshot,
    p_tee_snapshot: input.teeSnapshot,
    p_expected_participant_version: input.expectedParticipantVersion,
    p_reason: input.reason ?? null,
    p_source: input.source,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapGuestError(error);
  const parsed = guestRows.safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return mapGuestRow(parsed.data[0]);
}

export async function executeWithdrawRoundGuest(
  actorUserId: string,
  input: WithdrawRoundGuestExecutionInput,
  correlationId: string,
): Promise<WithdrawRoundGuestReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("withdraw_round_guest", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_participant_id: input.participantId,
    p_expected_participant_version: input.expectedParticipantVersion,
    p_confirmed: input.confirmed,
    p_reason: input.reason,
    p_source: input.source,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapGuestError(error);
  const parsed = withdrawalRows.safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  const row = parsed.data[0];
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    participantId: row.participant_id,
    participantKind: row.participant_kind,
    membershipId: row.membership_id,
    sponsorMembershipId: row.sponsor_membership_id,
    rsvpStatus: row.rsvp_status,
    version: safeVersion(row.version),
    scoreInvalidated: row.score_invalidated,
    changedAt: row.changed_at,
  };
}
