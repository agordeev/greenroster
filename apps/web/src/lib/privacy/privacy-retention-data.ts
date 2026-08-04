import "server-only";

import { z } from "zod";

import { MutationError } from "../mutations/result";

const countSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, "Invalid retention count.");

const retentionRowSchema = z
  .object({
    expired_invitation_count: countSchema,
    email_provider_event_count: countSchema,
    email_delivery_count: countSchema,
    push_receipt_count: countSchema,
    push_delivery_count: countSchema,
    pruned_at: z.string().datetime({ offset: true }),
  })
  .strict();

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

export type PrivacyRetentionResult = Readonly<{
  expiredInvitationCount: number;
  emailProviderEventCount: number;
  emailDeliveryCount: number;
  pushReceiptCount: number;
  pushDeliveryCount: number;
  prunedAt: string;
}>;

function mapRetentionError(error: SupabaseRpcError): MutationError {
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

export async function executePrivacyRetention(): Promise<PrivacyRetentionResult> {
  const { createSupabaseServiceClient } =
    await import("../supabase/service-client");
  const supabase = createSupabaseServiceClient();
  const result = await supabase.rpc("prune_privacy_retention");
  if (result.error) throw mapRetentionError(result.error);

  const parsed = z.array(retentionRowSchema).length(1).safeParse(result.data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }

  const [row] = parsed.data;
  return {
    expiredInvitationCount: row.expired_invitation_count,
    emailProviderEventCount: row.email_provider_event_count,
    emailDeliveryCount: row.email_delivery_count,
    pushReceiptCount: row.push_receipt_count,
    pushDeliveryCount: row.push_delivery_count,
    prunedAt: row.pruned_at,
  };
}
