import "server-only";

import { z } from "zod";

import type {
  OrganizerBootstrapInput,
  OrganizerBootstrapResult,
} from "./organizer-signup";
import { MutationError } from "@/lib/mutations/result";
import { createSupabaseServiceClient } from "@/lib/supabase/service-client";

const legalRowsSchema = z
  .array(
    z.object({
      terms_version: z.string().min(1),
      privacy_version: z.string().min(1),
    }),
  )
  .max(1);

const bootstrapRowsSchema = z
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

export type CurrentLegalDocuments = Readonly<{
  termsVersion: string;
  privacyVersion: string;
}>;

export async function resolveCurrentLegalDocuments(): Promise<CurrentLegalDocuments | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("resolve_current_legal_documents");
  if (error) return null;

  const parsed = legalRowsSchema.safeParse(data);
  if (!parsed.success || parsed.data.length !== 1) return null;

  return {
    termsVersion: parsed.data[0].terms_version,
    privacyVersion: parsed.data[0].privacy_version,
  };
}

function mapBootstrapError(error: SupabaseRpcError): MutationError {
  if (error.message === "identity_already_attached") {
    return new MutationError("forbidden", { cause: error });
  }
  if (
    error.code === "23505" ||
    error.code === "23514" ||
    error.code === "23502" ||
    error.code === "22023" ||
    error.message === "organizer_signup_input_invalid"
  ) {
    return new MutationError("validation", { cause: error });
  }
  if (error.code === "P0002") {
    return new MutationError("unavailable", { cause: error });
  }
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

export async function executeOrganizerBootstrap(
  actorUserId: string,
  input: OrganizerBootstrapInput,
  correlationId: string,
): Promise<OrganizerBootstrapResult> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("bootstrap_organizer", {
    p_administrator_user_id: actorUserId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_group_name: input.groupName,
    p_group_time_zone: input.groupTimeZone,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });

  if (error) throw mapBootstrapError(error);

  const rows = bootstrapRowsSchema.safeParse(data);
  if (!rows.success)
    throw new MutationError("unexpected", { cause: rows.error });

  return {
    groupId: rows.data[0].created_group_id,
    administratorMembershipId: rows.data[0].administrator_membership_id,
  };
}
