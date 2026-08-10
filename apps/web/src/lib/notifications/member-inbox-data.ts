import "server-only";

import { z } from "zod";

import {
  type MarkMemberInboxReadInput,
  memberInboxRowsSchema,
  memberInboxItemFromRow,
  type MemberInboxItem,
} from "../../domain/member-inbox";
import { MutationError } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function mapReadError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "22023" || error.code === "22004")
    return new MutationError("validation", { cause: error });
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

export async function executeReadMemberInbox(
  actorUserId: string,
  limit = 50,
): Promise<readonly MemberInboxItem[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("read_member_inbox", {
    p_actor_user_id: actorUserId,
    p_limit: limit,
  });
  if (error) throw mapReadError(error);
  const parsed = memberInboxRowsSchema.safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return parsed.data.map(memberInboxItemFromRow);
}

const markReadRowSchema = z
  .object({
    inbox_item_id: z.uuid(),
    read_at: z.string().datetime({ offset: true }),
    version: z
      .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
      .transform(Number)
      .refine(Number.isSafeInteger),
  })
  .strict();

export async function executeMarkMemberInboxRead(
  actorUserId: string,
  input: MarkMemberInboxReadInput,
  correlationId: string,
): Promise<Readonly<{ inboxItemId: string; readAt: string; version: number }>> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("mark_member_inbox_read", {
    p_actor_user_id: actorUserId,
    p_inbox_item_id: input.inboxItemId,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) {
    if (error.code === "P0002")
      throw new MutationError("unavailable", { cause: error });
    if (error.code === "P0003")
      throw new MutationError("forbidden", { cause: error });
    if (error.code === "23505")
      throw new MutationError("operation_reused", { cause: error });
    throw mapReadError(error);
  }
  const parsed = z.array(markReadRowSchema).length(1).safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  const row = parsed.data[0];
  return {
    inboxItemId: row.inbox_item_id,
    readAt: row.read_at,
    version: row.version,
  };
}
