import "server-only";

import { z } from "zod";

import type {
  PendingMemberProfileInput,
  PendingMemberProfileResult,
} from "@/lib/memberships/pending-member-profile";
import { MutationError } from "@/lib/mutations/result";
import { createSupabaseServiceClient } from "@/lib/supabase/service-client";

const pendingMemberProfileRowsSchema = z
  .array(
    z
      .object({
        created_membership_id: z.uuid(),
        created_group_id: z.uuid(),
        profile_version: z.number().int().positive(),
        contact_version: z.number().int().positive(),
      })
      .strict(),
  )
  .length(1);

type SupabaseRpcError = Readonly<{
  code?: string;
  message?: string;
}>;

function mapPendingMemberProfileError(error: SupabaseRpcError): MutationError {
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
    error.code === "22003" ||
    error.code === "22004" ||
    error.code === "22023" ||
    error.code === "22P02" ||
    error.code === "23502" ||
    error.code === "23503" ||
    error.code === "23505" ||
    error.code === "23514"
  ) {
    return new MutationError("validation", { cause: error });
  }
  if (!error.code) {
    return new MutationError("transient", { cause: error });
  }
  return new MutationError("unexpected", { cause: error });
}

export async function executeCreatePendingMemberProfile(
  actorUserId: string,
  input: PendingMemberProfileInput,
  correlationId: string,
): Promise<PendingMemberProfileResult> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("create_pending_member_profile", {
    p_actor_user_id: actorUserId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_spouse_first_name: input.spouseFirstName,
    p_spouse_last_name: input.spouseLastName,
    p_tee_location: input.teeLocation,
    p_dues_paid: input.duesPaid,
    p_secondary_email: input.secondaryEmail,
    p_home_phone: input.homePhone,
    p_work_phone: input.workPhone,
    p_mobile_phone: input.mobilePhone,
    p_address_line1: input.addressLine1,
    p_address_line2: input.addressLine2,
    p_city: input.city,
    p_state_region: input.stateRegion,
    p_postal_code: input.postalCode,
    p_country: input.country,
    p_secondary_email_visible: input.secondaryEmailVisible,
    p_home_phone_visible: input.homePhoneVisible,
    p_work_phone_visible: input.workPhoneVisible,
    p_mobile_phone_visible: input.mobilePhoneVisible,
    p_address_listed: input.addressListed,
    p_reason: input.reason,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });

  if (error) {
    throw mapPendingMemberProfileError(error);
  }

  const rows = pendingMemberProfileRowsSchema.safeParse(data);
  if (!rows.success) {
    throw new MutationError("unexpected", { cause: rows.error });
  }

  const row = rows.data[0];

  return {
    membershipId: row.created_membership_id,
    groupId: row.created_group_id,
    profileVersion: row.profile_version,
    contactVersion: row.contact_version,
  };
}
