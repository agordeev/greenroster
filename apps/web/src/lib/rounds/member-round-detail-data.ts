import "server-only";

import { z } from "zod";

import type {
  MemberRoundDetail,
  MemberRoundGuestContext,
} from "../../domain/member-round-detail";
import { MutationError } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";
import {
  mapRoundReadError,
  nonNegativeIntegerSchema,
  numericValueSchema,
  positiveIntegerSchema,
} from "./rpc-shared";

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

const instantSchema = z.string().datetime({ offset: true });

const detailRowSchema = z
  .object({
    round_id: z.uuid(),
    group_id: z.uuid(),
    description: z.string().nullable(),
    scheduled_at: instantSchema.nullable(),
    group_time_zone: z.string().min(1),
    venue: z.string().nullable(),
    round_url: z.string().url().nullable(),
    notes: z.string().max(500).nullable(),
    format: z.enum(["individual_net", "individual_gross"]),
    state: z.enum(["published", "live", "completed", "cancelled"]),
    version: positiveIntegerSchema,
    rsvp_deadline_at: instantSchema.nullable(),
    participant_status: z.enum(["no_response", "playing", "not_playing"]),
    participant_version: positiveIntegerSchema.nullable(),
    rsvp_changed_at: instantSchema.nullable(),
    participant_count: nonNegativeIntegerSchema,
    playing_count: nonNegativeIntegerSchema,
    cancelled_at: instantSchema.nullable(),
    cancellation_reason: z.string().nullable(),
    updated_at: instantSchema,
  })
  .strict();

const guestSchema = z
  .object({
    participant_id: z.uuid(),
    sponsor_membership_id: z.uuid(),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    rsvp_status: z.enum(["playing", "not_playing"]),
    version: positiveIntegerSchema,
    quota_snapshot: numericValueSchema,
    handicap_snapshot: numericValueSchema,
    tee_snapshot: z.enum(["pro", "back", "middle", "front"]).nullable(),
    duplicate_like: z.boolean(),
    changed_at: instantSchema,
  })
  .strict();

const guestContextSchema = z
  .object({
    round_id: z.uuid(),
    group_id: z.uuid(),
    format: z.enum(["individual_net", "individual_gross"]),
    state: z.enum(["published", "live"]),
    can_manage: z.boolean(),
    guests: z.array(guestSchema),
  })
  .strict();

export async function executeReadMemberRoundDetail(
  client: Readonly<{
    rpc: (
      name: string,
      args?: Readonly<Record<string, unknown>>,
    ) => PromiseLike<
      Readonly<{ data: unknown; error: SupabaseRpcError | null }>
    >;
  }>,
  roundId: string,
): Promise<MemberRoundDetail> {
  const result = await client.rpc("read_mobile_round_detail", {
    p_round_id: roundId,
  });
  if (result.error) throw mapRoundReadError(result.error);
  const parsed = z.array(detailRowSchema).length(1).safeParse(result.data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  const row = parsed.data[0];
  return {
    roundId: row.round_id,
    groupId: row.group_id,
    description: row.description,
    scheduledAt: row.scheduled_at,
    groupTimeZone: row.group_time_zone,
    venue: row.venue,
    roundUrl: row.round_url,
    notes: row.notes,
    format: row.format,
    state: row.state,
    version: row.version,
    rsvpDeadlineAt: row.rsvp_deadline_at,
    participantStatus: row.participant_status,
    participantVersion: row.participant_version,
    rsvpChangedAt: row.rsvp_changed_at,
    participantCount: row.participant_count,
    playingCount: row.playing_count,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    updatedAt: row.updated_at,
  };
}

export async function executeReadMemberRoundGuestContext(
  actorUserId: string,
  roundId: string,
): Promise<MemberRoundGuestContext> {
  const supabase = createSupabaseServiceClient();
  const result = await supabase.rpc("read_member_round_guest_context", {
    p_actor_user_id: actorUserId,
    p_round_id: roundId,
  });
  if (result.error) throw mapRoundReadError(result.error);
  const parsed = guestContextSchema.safeParse(result.data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return {
    roundId: parsed.data.round_id,
    groupId: parsed.data.group_id,
    format: parsed.data.format,
    state: parsed.data.state,
    canManage: parsed.data.can_manage,
    guests: parsed.data.guests.map((guest) => ({
      participantId: guest.participant_id,
      sponsorMembershipId: guest.sponsor_membership_id,
      firstName: guest.first_name,
      lastName: guest.last_name,
      rsvpStatus: guest.rsvp_status,
      version: guest.version,
      quotaSnapshot: guest.quota_snapshot,
      handicapSnapshot: guest.handicap_snapshot,
      teeSnapshot: guest.tee_snapshot,
      duplicateLike: guest.duplicate_like,
      changedAt: guest.changed_at,
    })),
  };
}
