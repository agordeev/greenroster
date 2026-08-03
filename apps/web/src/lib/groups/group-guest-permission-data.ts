import "server-only";

import { z } from "zod";

import type {
  GroupGuestPermission,
  GroupGuestPermissionInput,
} from "./group-guest-permission";
import { MutationError } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

const permissionRowsSchema = z
  .array(
    z
      .object({
        group_id: z.uuid(),
        allow_member_guests: z.boolean(),
        group_version: z.number().int().positive(),
      })
      .strict(),
  )
  .length(1);

const updateRowsSchema = z
  .array(
    z
      .object({
        updated_group_id: z.uuid(),
        updated_allow_member_guests: z.boolean(),
        updated_group_version: z.number().int().positive(),
      })
      .strict(),
  )
  .length(1);

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function mapError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (error.code === "40001")
    return new MutationError("stale_version", { cause: error });
  if (error.code === "22004" || error.code === "22023")
    return new MutationError("validation", { cause: error });
  if (error.code === "23505")
    return new MutationError("operation_reused", { cause: error });
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

export async function executeReadGroupGuestPermission(
  actorUserId: string,
): Promise<GroupGuestPermission> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("read_group_guest_permission", {
    p_actor_user_id: actorUserId,
  });
  if (error) throw mapError(error);

  const rows = permissionRowsSchema.safeParse(data);
  if (!rows.success)
    throw new MutationError("unexpected", { cause: rows.error });
  const [row] = rows.data;
  return {
    groupId: row.group_id,
    allowMemberGuests: row.allow_member_guests,
    groupVersion: row.group_version,
  };
}

export async function executeUpdateGroupGuestPermission(
  actorUserId: string,
  input: GroupGuestPermissionInput,
  correlationId: string,
): Promise<GroupGuestPermission> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("update_group_guest_permission", {
    p_actor_user_id: actorUserId,
    p_allow_member_guests: input.allowMemberGuests,
    p_expected_group_version: input.expectedGroupVersion,
    p_reason: input.reason,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapError(error);

  const rows = updateRowsSchema.safeParse(data);
  if (!rows.success)
    throw new MutationError("unexpected", { cause: rows.error });
  const [row] = rows.data;
  return {
    groupId: row.updated_group_id,
    allowMemberGuests: row.updated_allow_member_guests,
    groupVersion: row.updated_group_version,
  };
}
