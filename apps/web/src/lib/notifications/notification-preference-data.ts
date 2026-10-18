import "server-only";

import { z } from "zod";

import type {
  EmailPreferenceInput,
  EmailPreferenceReceipt,
} from "../../domain/notification-preference";
import { MutationError } from "../mutations/result";
import { createServerActionSupabaseClient } from "../supabase/server-action-client";

const savedRows = z
  .array(
    z.object({
      category: z.string(),
      email_enabled: z.boolean(),
      version: z.union([z.number().int().positive(), z.string()]),
    }),
  )
  .length(1);

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function mapPreferenceError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (error.code === "40001")
    return new MutationError("stale_version", { cause: error });
  if (error.code === "23505")
    return new MutationError("operation_reused", { cause: error });
  if (error.code === "22023" || error.code === "22004")
    return new MutationError("validation", { cause: error });
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

// The database reads the member from the signed-in user, so this call uses
// the member's own client rather than the service client.
export async function executeSetEmailPreference(
  _actorUserId: string,
  input: EmailPreferenceInput,
  correlationId: string,
): Promise<EmailPreferenceReceipt> {
  const supabase = await createServerActionSupabaseClient();
  const { data, error } = await supabase.rpc(
    "set_mobile_member_notification_preference",
    {
      p_category: input.category,
      p_channel: "email",
      p_enabled: input.enabled,
      p_expected_preference_version: input.expectedVersion,
      p_correlation_id: correlationId,
      p_operation_id: input.operationId,
    },
  );
  if (error) throw mapPreferenceError(error);
  const parsed = savedRows.safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  const [row] = parsed.data;
  return {
    category: row.category,
    emailEnabled: row.email_enabled,
    version: Number(row.version),
  };
}
