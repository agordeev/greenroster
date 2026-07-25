import "server-only";

import { z } from "zod";

import type {
  GroupBootstrapInput,
  GroupBootstrapResult,
} from "@/lib/groups/bootstrap-group";
import { MutationError } from "@/lib/mutations/result";
import { createSupabaseServiceClient } from "@/lib/supabase/service-client";

const groupBootstrapRowsSchema = z
  .array(
    z.object({
      created_group_id: z.uuid(),
      administrator_membership_id: z.uuid(),
    }),
  )
  .length(1);

type SupabaseRpcError = Readonly<{
  code?: string;
  message?: string;
}>;

function mapBootstrapError(error: SupabaseRpcError): MutationError {
  if (
    error.code === "23505" ||
    error.code === "23514" ||
    error.code === "23502" ||
    error.message === "identity_already_attached"
  ) {
    return new MutationError("validation", { cause: error });
  }

  if (error.code === "P0002") {
    return new MutationError("unavailable", { cause: error });
  }

  if (!error.code) {
    return new MutationError("transient", { cause: error });
  }

  return new MutationError("unexpected", { cause: error });
}

export async function executeGroupBootstrap(
  actorUserId: string,
  input: GroupBootstrapInput,
  correlationId: string,
): Promise<GroupBootstrapResult> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("bootstrap_group", {
    p_administrator_user_id: actorUserId,
    p_group_name: input.groupName,
    p_group_time_zone: input.groupTimeZone,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });

  if (error) {
    throw mapBootstrapError(error);
  }

  const rows = groupBootstrapRowsSchema.safeParse(data);

  if (!rows.success) {
    throw new MutationError("unexpected", { cause: rows.error });
  }

  return {
    groupId: rows.data[0].created_group_id,
    administratorMembershipId: rows.data[0].administrator_membership_id,
  };
}
