import "server-only";

import { z } from "zod";

import {
  memberSelfHandicapInputSchema,
  memberSelfProfileInputSchema,
  memberSelfProfileDraftSchema,
  type MemberSelfHandicapInput,
  type MemberSelfProfile,
  type MemberSelfProfileInput,
} from "@/domain/member-self-profile";
import { MutationError } from "@/lib/mutations/result";
import { createServerActionSupabaseClient } from "@/lib/supabase/server-action-client";
import { createServerComponentSupabaseClient } from "@/lib/supabase/server-component-client";

type MemberProfileClient = Pick<
  Awaited<ReturnType<typeof createServerComponentSupabaseClient>>,
  "rpc"
>;

const positiveVersionSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
  .transform(Number);
const nonnegativeVersionSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)])
  .transform(Number);

const profileRowSchema = z
  .object({
    membership_id: z.uuid(),
    group_id: z.uuid(),
    user_id: z.uuid(),
    group_name: z.string().min(1),
    group_time_zone: z.string().min(1),
    role: z.enum(["member", "coordinator", "administrator"]),
    status: z.enum(["pending", "active", "inactive"]),
    membership_version: positiveVersionSchema,
    profile_version: nonnegativeVersionSchema,
    contact_version: nonnegativeVersionSchema,
    first_name: z.string(),
    last_name: z.string(),
    spouse_first_name: z.string().nullable(),
    spouse_last_name: z.string().nullable(),
    tee_location: z.enum(["pro", "back", "middle", "front"]).nullable(),
    secondary_email: z.string().nullable(),
    home_phone_display: z.string().nullable(),
    work_phone_display: z.string().nullable(),
    mobile_phone_display: z.string().nullable(),
    address_line1: z.string().nullable(),
    address_line2: z.string().nullable(),
    city: z.string().nullable(),
    state_region: z.string().nullable(),
    postal_code: z.string().nullable(),
    country: z.string().nullable(),
    secondary_email_visible: z.boolean(),
    home_phone_visible: z.boolean(),
    work_phone_visible: z.boolean(),
    mobile_phone_visible: z.boolean(),
    address_listed: z.boolean(),
    handicap_record_id: z.uuid().nullable(),
    handicap_id: z.string().nullable(),
    handicap: z.union([z.number(), z.string()]).nullable(),
    handicap_source: z.enum(["manual", "import"]).nullable(),
    handicap_as_of: z.string().nullable(),
    handicap_created_at: z.string().nullable(),
  })
  .strict();

const updateReceiptSchema = z
  .object({
    membership_id: z.uuid(),
    group_id: z.uuid(),
    membership_version: positiveVersionSchema,
    profile_version: nonnegativeVersionSchema,
    contact_version: nonnegativeVersionSchema,
  })
  .strict();

const handicapReceiptSchema = z
  .object({
    handicap_record_id: z.uuid(),
    membership_id: z.uuid(),
    group_id: z.uuid(),
    membership_version: positiveVersionSchema,
    handicap_id: z.string().nullable(),
    handicap: z.union([z.number(), z.string()]),
    source: z.enum(["manual", "import"]),
    as_of: z.string(),
    created_at: z.string(),
  })
  .strict();

type SupabaseRpcError = Readonly<{ code?: string; message?: string }>;

function mapProfileError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (error.code === "40001")
    return new MutationError("stale_version", { cause: error });
  if (error.code === "23505")
    return new MutationError("operation_reused", { cause: error });
  if (error.code === "22004" || error.code === "22023")
    return new MutationError("validation", { cause: error });
  if (!error.code) return new MutationError("transient", { cause: error });
  return new MutationError("unexpected", { cause: error });
}

function singleRow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = z.array(schema).length(1).safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  return parsed.data[0];
}

function profileFromRow(
  row: z.infer<typeof profileRowSchema>,
): MemberSelfProfile {
  return {
    membershipId: row.membership_id,
    groupId: row.group_id,
    userId: row.user_id,
    groupName: row.group_name,
    groupTimeZone: row.group_time_zone,
    role: row.role,
    status: row.status,
    membershipVersion: row.membership_version,
    profileVersion: row.profile_version,
    contactVersion: row.contact_version,
    draft: memberSelfProfileDraftSchema.parse({
      firstName: row.first_name,
      lastName: row.last_name,
      spouseFirstName: row.spouse_first_name,
      spouseLastName: row.spouse_last_name,
      teeLocation: row.tee_location,
      secondaryEmail: row.secondary_email,
      homePhone: row.home_phone_display,
      workPhone: row.work_phone_display,
      mobilePhone: row.mobile_phone_display,
      addressLine1: row.address_line1,
      addressLine2: row.address_line2,
      city: row.city,
      stateRegion: row.state_region,
      postalCode: row.postal_code,
      country: row.country,
      secondaryEmailVisible: row.secondary_email_visible,
      homePhoneVisible: row.home_phone_visible,
      workPhoneVisible: row.work_phone_visible,
      mobilePhoneVisible: row.mobile_phone_visible,
      addressListed: row.address_listed,
    }),
    handicapRecordId: row.handicap_record_id,
    handicapId: row.handicap_id,
    handicap: row.handicap === null ? null : String(row.handicap),
    handicapSource: row.handicap_source,
    handicapAsOf: row.handicap_as_of,
    handicapCreatedAt: row.handicap_created_at,
  };
}

export async function executeReadMemberSelfProfile(
  client: MemberProfileClient,
): Promise<MemberSelfProfile> {
  const { data, error } = await client.rpc(
    "resolve_mobile_member_self_profile",
  );
  if (error) throw mapProfileError(error);
  return profileFromRow(singleRow(profileRowSchema, data));
}

export async function executeUpdateMemberSelfProfile(
  _actorUserId: string,
  input: MemberSelfProfileInput,
  correlationId: string,
) {
  const supabase = await createServerActionSupabaseClient();
  const { data, error } = await supabase.rpc(
    "update_mobile_member_self_profile",
    {
      p_first_name: input.firstName,
      p_last_name: input.lastName,
      p_spouse_first_name: input.spouseFirstName,
      p_spouse_last_name: input.spouseLastName,
      p_tee_location: input.teeLocation,
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
      p_expected_profile_version: input.expectedProfileVersion,
      p_expected_contact_version: input.expectedContactVersion,
      p_expected_membership_version: input.expectedMembershipVersion,
      p_reason: input.reason ?? null,
      p_correlation_id: correlationId,
      p_operation_id: input.operationId,
    },
  );
  if (error) throw mapProfileError(error);
  return singleRow(updateReceiptSchema, data);
}

export async function executeSetMemberSelfHandicap(
  _actorUserId: string,
  input: MemberSelfHandicapInput,
  correlationId: string,
) {
  const supabase = await createServerActionSupabaseClient();
  const { data, error } = await supabase.rpc(
    "set_mobile_member_self_handicap",
    {
      p_handicap_id: input.handicapId || null,
      p_handicap: input.handicap,
      p_as_of: input.asOf,
      p_expected_membership_version: input.expectedMembershipVersion,
      p_confirmed: input.confirmed,
      p_reason: input.reason,
      p_correlation_id: correlationId,
      p_operation_id: input.operationId,
    },
  );
  if (error) throw mapProfileError(error);
  return singleRow(handicapReceiptSchema, data);
}

export function validateMemberSelfProfileInput(value: unknown) {
  return memberSelfProfileInputSchema.safeParse(value);
}

export function validateMemberSelfHandicapInput(value: unknown) {
  return memberSelfHandicapInputSchema.safeParse(value);
}
