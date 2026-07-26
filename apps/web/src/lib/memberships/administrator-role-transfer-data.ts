import "server-only";

import { z } from "zod";

import type {
  AdministratorRoleTransferInput,
  AdministratorRoleTransferResult,
} from "@/lib/memberships/administrator-role-transfer";
import { MutationError } from "@/lib/mutations/result";
import { createSupabaseServiceClient } from "@/lib/supabase/service-client";

const transferRowsSchema = z
  .array(
    z.object({
      transferred_group_id: z.uuid(),
      group_version: z.number().int().positive(),
      previous_administrator_membership_id: z.uuid(),
      previous_administrator_role: z.literal("coordinator"),
      replacement_membership_id: z.uuid(),
      replacement_role: z.literal("administrator"),
    }),
  )
  .length(1);

type SupabaseRpcError = Readonly<{
  code?: string;
  message?: string;
}>;

function mapTransferError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003") {
    return new MutationError("forbidden", { cause: error });
  }
  if (error.code === "P0002") {
    return new MutationError("unavailable", { cause: error });
  }
  if (error.code === "40001") {
    return new MutationError("stale_version", { cause: error });
  }
  if (error.code === "P0001") {
    return new MutationError("locked", { cause: error });
  }
  if (
    error.code === "22004" ||
    error.code === "22023" ||
    error.code === "23502" ||
    error.code === "23514"
  ) {
    return new MutationError("validation", { cause: error });
  }
  if (!error.code) {
    return new MutationError("transient", { cause: error });
  }
  return new MutationError("unexpected", { cause: error });
}

export async function executeAdministratorRoleTransfer(
  actorUserId: string,
  input: AdministratorRoleTransferInput,
  correlationId: string,
): Promise<AdministratorRoleTransferResult> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("transfer_group_administrator", {
    p_actor_user_id: actorUserId,
    p_replacement_membership_id: input.replacementMembershipId,
    p_expected_group_version: input.expectedGroupVersion,
    p_confirmed: input.confirmed,
    p_reason: input.reason,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });

  if (error) throw mapTransferError(error);

  const rows = transferRowsSchema.safeParse(data);
  if (!rows.success) {
    throw new MutationError("unexpected", { cause: rows.error });
  }

  const [row] = rows.data;
  return {
    groupId: row.transferred_group_id,
    groupVersion: row.group_version,
    previousAdministratorMembershipId: row.previous_administrator_membership_id,
    previousAdministratorRole: row.previous_administrator_role,
    replacementMembershipId: row.replacement_membership_id,
    replacementRole: row.replacement_role,
  };
}
