import "server-only";

import { z } from "zod";

import type { GroupProfileInput, GroupProfileResult } from "./group-profile";
import { MutationError, type MutationFieldErrors } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

const groupProfileRowsSchema = z
  .array(
    z
      .object({
        updated_group_id: z.uuid(),
        updated_group_name: z.string(),
        updated_group_time_zone: z.string(),
        updated_group_version: z.number().int().positive(),
      })
      .strict(),
  )
  .length(1);

type SupabaseRpcError = Readonly<{
  code?: string;
  message?: string;
}>;

function mapGroupProfileError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003") {
    return new MutationError("forbidden", { cause: error });
  }
  if (error.code === "P0002") {
    return new MutationError("unavailable", { cause: error });
  }
  if (error.code === "40001") {
    return new MutationError("stale_version", { cause: error });
  }
  if (
    error.code === "22004" ||
    error.code === "22023" ||
    error.code === "23514"
  ) {
    const fieldErrors = groupProfileFieldErrors(error.message);
    return new MutationError("validation", {
      cause: error,
      ...(fieldErrors ? { fieldErrors } : {}),
    });
  }
  if (!error.code) {
    return new MutationError("transient", { cause: error });
  }
  return new MutationError("unexpected", { cause: error });
}

function groupProfileFieldErrors(
  message: string | undefined,
): MutationFieldErrors | undefined {
  switch (message) {
    case "group_profile_name_required":
      return { groupName: ["Enter a group name."] };
    case "group_profile_time_zone_required":
    case "group_profile_time_zone_invalid":
      return { groupTimeZone: ["Enter a time zone such as America/New_York."] };
    case "group_profile_reason_required":
    case "group_profile_reason_invalid":
      return { reason: ["Add a reason for this group profile change."] };
    case "group_profile_input_invalid":
      return { expectedGroupVersion: ["Refresh before saving."] };
    default:
      return undefined;
  }
}

export async function executeUpdateGroupProfile(
  actorUserId: string,
  input: GroupProfileInput,
  correlationId: string,
): Promise<GroupProfileResult> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("update_group_profile", {
    p_actor_user_id: actorUserId,
    p_group_name: input.groupName,
    p_group_time_zone: input.groupTimeZone,
    p_expected_group_version: input.expectedGroupVersion,
    p_reason: input.reason,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });

  if (error) throw mapGroupProfileError(error);

  const rows = groupProfileRowsSchema.safeParse(data);
  if (!rows.success) {
    throw new MutationError("unexpected", { cause: rows.error });
  }

  const [row] = rows.data;
  return {
    groupId: row.updated_group_id,
    groupName: row.updated_group_name,
    groupTimeZone: row.updated_group_time_zone,
    groupVersion: row.updated_group_version,
  };
}
