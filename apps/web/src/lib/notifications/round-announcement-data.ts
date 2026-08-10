import "server-only";

import { z } from "zod";

import {
  type RoundAnnouncementInput,
  type RoundAnnouncementReceipt,
} from "../../domain/round-announcement";
import { MutationError } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

const receiptRowSchema = z
  .object({
    announcement_id: z.uuid(),
    group_id: z.uuid(),
    round_id: z.uuid(),
    body: z.string().min(1).max(300),
    author_display_name: z.string().min(1).max(200),
    author_role: z.enum(["member", "coordinator", "administrator"]),
    created_at: z.string().datetime({ offset: true }),
    outbox_job_id: z.uuid(),
    inbox_count: z
      .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)])
      .transform(Number)
      .refine(Number.isSafeInteger),
  })
  .strict();

function mapError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (error.code === "P0001")
    return new MutationError("locked", { cause: error });
  if (error.code === "23505")
    return new MutationError("operation_reused", { cause: error });
  if (error.code === "22023" || error.code === "22004") {
    return new MutationError("validation", { cause: error });
  }
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

export async function executePostRoundAnnouncement(
  actorUserId: string,
  input: RoundAnnouncementInput,
  correlationId: string,
): Promise<RoundAnnouncementReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("post_round_announcement", {
    p_actor_user_id: actorUserId,
    p_round_id: input.roundId,
    p_body: input.body,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapError(error);
  const parsed = z.array(receiptRowSchema).length(1).safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  const row = parsed.data[0];
  return {
    announcementId: row.announcement_id,
    groupId: row.group_id,
    roundId: row.round_id,
    body: row.body,
    authorDisplayName: row.author_display_name,
    authorRole: row.author_role,
    createdAt: row.created_at,
    outboxJobId: row.outbox_job_id,
    inboxCount: row.inbox_count,
  };
}
