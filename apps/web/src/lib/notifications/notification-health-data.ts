import "server-only";

import { z } from "zod";

import { MutationError } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

const countSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, "Invalid notification count.");

const instantSchema = z.string().datetime({ offset: true }).nullable();

const notificationHealthRowSchema = z
  .object({
    group_id: z.uuid(),
    outbox_queued: countSchema,
    outbox_processing: countSchema,
    outbox_retryable: countSchema,
    outbox_oldest_at: instantSchema,
    email_queued: countSchema,
    email_sending: countSchema,
    email_retryable: countSchema,
    email_failed_permanent: countSchema,
    email_suppressed: countSchema,
    push_queued: countSchema,
    push_sending: countSchema,
    push_retryable: countSchema,
    push_failed_permanent: countSchema,
    push_cancelled: countSchema,
    push_receipt_pending: countSchema,
    push_receipt_failed: countSchema,
    last_activity_at: instantSchema,
    sampled_at: z.string().datetime({ offset: true }),
  })
  .strict();

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

export type NotificationDeliveryHealth = Readonly<{
  groupId: string;
  outboxQueued: number;
  outboxProcessing: number;
  outboxRetryable: number;
  outboxOldestAt: string | null;
  emailQueued: number;
  emailSending: number;
  emailRetryable: number;
  emailFailedPermanent: number;
  emailSuppressed: number;
  pushQueued: number;
  pushSending: number;
  pushRetryable: number;
  pushFailedPermanent: number;
  pushCancelled: number;
  pushReceiptPending: number;
  pushReceiptFailed: number;
  lastActivityAt: string | null;
  sampledAt: string;
}>;

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

export async function executeReadNotificationDeliveryHealth(
  actorUserId: string,
): Promise<NotificationDeliveryHealth> {
  const supabase = createSupabaseServiceClient();
  const result = await supabase.rpc("read_notification_delivery_health", {
    p_actor_user_id: actorUserId,
  });
  if (result.error) throw mapReadError(result.error);

  const parsed = z
    .array(notificationHealthRowSchema)
    .length(1)
    .safeParse(result.data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });

  const [row] = parsed.data;
  return {
    groupId: row.group_id,
    outboxQueued: row.outbox_queued,
    outboxProcessing: row.outbox_processing,
    outboxRetryable: row.outbox_retryable,
    outboxOldestAt: row.outbox_oldest_at,
    emailQueued: row.email_queued,
    emailSending: row.email_sending,
    emailRetryable: row.email_retryable,
    emailFailedPermanent: row.email_failed_permanent,
    emailSuppressed: row.email_suppressed,
    pushQueued: row.push_queued,
    pushSending: row.push_sending,
    pushRetryable: row.push_retryable,
    pushFailedPermanent: row.push_failed_permanent,
    pushCancelled: row.push_cancelled,
    pushReceiptPending: row.push_receipt_pending,
    pushReceiptFailed: row.push_receipt_failed,
    lastActivityAt: row.last_activity_at,
    sampledAt: row.sampled_at,
  };
}
