import { z } from "zod";

import { mobileSupabase } from "../auth/mobile-supabase";
import { createMobileOperationId } from "../mobile-operation-id";
import {
  mobileSelfProfileDraftSchema,
  normalizeMobileSelfProfileDraft,
  type MobileMutationOperationContext,
  type MobileSelfProfileDraft,
} from "./mobile-self-profile-state";

export type { MobileMutationOperationContext } from "./mobile-self-profile-state";

const selfProfileRowSchema = z
  .object({
    membership_id: z.uuid(),
    group_id: z.uuid(),
    user_id: z.uuid(),
    group_name: z.string().min(1),
    group_time_zone: z.string().min(1),
    role: z.enum(["member", "coordinator", "administrator"]),
    status: z.enum(["pending", "active", "inactive"]),
    membership_version: z.number().int().positive(),
    profile_version: z.number().int().nonnegative(),
    contact_version: z.number().int().nonnegative(),
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

const updateInputSchema = mobileSelfProfileDraftSchema.extend({
  expectedProfileVersion: z.number().int().nonnegative(),
  expectedContactVersion: z.number().int().nonnegative(),
  expectedMembershipVersion: z.number().int().positive(),
  reason: z.string().trim().max(500).nullable().optional(),
});

const handicapInputSchema = z.object({
  handicapId: z.string().trim().max(100),
  handicap: z
    .string()
    .trim()
    .regex(/^[+-]?\d+(\.\d)?$/, "Enter a handicap from -10.0 to 54.0.")
    .refine((value) => {
      const numericValue = Number(value);
      return numericValue >= -10 && numericValue <= 54;
    }, "Enter a handicap from -10.0 to 54.0."),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  expectedMembershipVersion: z.number().int().positive(),
  confirmed: z.literal(true),
  reason: z.string().trim().min(1).max(500),
});

export type MobileSelfProfileData = Readonly<{
  membershipId: string;
  groupId: string;
  userId: string;
  groupName: string;
  groupTimeZone: string;
  role: "member" | "coordinator" | "administrator";
  status: "pending" | "active" | "inactive";
  membershipVersion: number;
  profileVersion: number;
  contactVersion: number;
  draft: MobileSelfProfileDraft;
  handicapRecordId: string | null;
  handicapId: string | null;
  handicap: string | null;
  handicapSource: "manual" | "import" | null;
  handicapAsOf: string | null;
  handicapCreatedAt: string | null;
}>;

export type MobileSelfProfileErrorCode =
  "permission_denied" | "stale" | "validation" | "unavailable";

export type MobileSelfProfileResult =
  | Readonly<{ ok: true; data: MobileSelfProfileData }>
  | Readonly<{
      ok: false;
      code: MobileSelfProfileErrorCode;
      correlationId?: string;
      message: string;
      field?: string;
    }>;

export type MobileSelfProfileClient = Pick<typeof mobileSupabase, "rpc">;

function mapError(
  message: string,
  correlationId?: string,
): MobileSelfProfileResult {
  const normalized = message.toLowerCase();
  const supportReference = correlationId ? { correlationId } : {};
  if (
    normalized.includes("version_changed") ||
    normalized.includes("stale") ||
    normalized.includes("operation_id_reused")
  ) {
    return {
      code: "stale",
      ...supportReference,
      message:
        "Your profile changed somewhere else. Review the latest details, then save again.",
      ok: false,
    };
  }
  if (
    normalized.includes("identity_context") ||
    normalized.includes("recovery_session_forbidden") ||
    normalized.includes("actor_not_authorized") ||
    normalized.includes("member_not_found") ||
    normalized.includes("permission") ||
    normalized.includes("membership_inactive")
  ) {
    return {
      code: "permission_denied",
      ...supportReference,
      message: "You can't edit your profile. Contact a group administrator.",
      ok: false,
    };
  }
  if (
    normalized.includes("required") ||
    normalized.includes("invalid") ||
    normalized.includes("confirmation") ||
    normalized.includes("handicap_value")
  ) {
    return {
      code: "validation",
      ...supportReference,
      message: "Check the highlighted fields and try again.",
      ok: false,
    };
  }
  return {
    code: "unavailable",
    ...supportReference,
    message:
      "We couldn't save your profile. Check your connection and try again.",
    ok: false,
  };
}

function validationField(error: unknown) {
  if (error instanceof z.ZodError) {
    return String(error.issues[0]?.path[0] ?? "profile");
  }
  return "profile";
}

function parseData(
  value: unknown,
  correlationId?: string,
): MobileSelfProfileResult {
  const parsed = z.array(selfProfileRowSchema).safeParse(value);
  if (!parsed.success || !parsed.data[0]) {
    return {
      code: "unavailable",
      ...(correlationId ? { correlationId } : {}),
      message:
        "We couldn't load your profile. Check your connection and try again.",
      ok: false,
    };
  }
  const row = parsed.data[0];
  return {
    ok: true,
    data: {
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
      draft: normalizeMobileSelfProfileDraft({
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
    },
  };
}

export function createMobileSelfProfileApi(client: MobileSelfProfileClient) {
  const resolve = async (
    correlationId?: string,
  ): Promise<MobileSelfProfileResult> => {
    try {
      const { data, error } = await client.rpc(
        "resolve_mobile_member_self_profile",
      );
      return error
        ? mapError(error.message, correlationId)
        : parseData(data, correlationId);
    } catch {
      return mapError("network_unavailable", correlationId);
    }
  };

  const contextDefaults = () => ({
    correlationId: createMobileOperationId(),
    operationId: createMobileOperationId(),
  });

  return {
    resolve,
    async update(
      input: Readonly<Partial<MobileSelfProfileDraft>> &
        Readonly<{
          expectedProfileVersion: number;
          expectedContactVersion: number;
          expectedMembershipVersion: number;
          reason?: string | null;
        }>,
      operationContext: MobileMutationOperationContext = contextDefaults(),
    ): Promise<MobileSelfProfileResult> {
      let draft: MobileSelfProfileDraft;
      try {
        draft = normalizeMobileSelfProfileDraft(input);
      } catch (error) {
        return {
          code: "validation",
          correlationId: operationContext.correlationId,
          field: validationField(error),
          message: "Check the highlighted fields and try again.",
          ok: false,
        };
      }
      const parsed = updateInputSchema.safeParse({
        ...draft,
        expectedProfileVersion: input.expectedProfileVersion,
        expectedContactVersion: input.expectedContactVersion,
        expectedMembershipVersion: input.expectedMembershipVersion,
        reason: input.reason,
      });
      if (!parsed.success) {
        return {
          code: "validation",
          correlationId: operationContext.correlationId,
          field: String(parsed.error.issues[0]?.path[0] ?? "profile"),
          message: "Check the highlighted fields and try again.",
          ok: false,
        };
      }
      try {
        const { error } = await client.rpc(
          "update_mobile_member_self_profile",
          {
            p_first_name: draft.firstName,
            p_last_name: draft.lastName,
            p_spouse_first_name: draft.spouseFirstName,
            p_spouse_last_name: draft.spouseLastName,
            p_tee_location: draft.teeLocation,
            p_secondary_email: draft.secondaryEmail,
            p_home_phone: draft.homePhone,
            p_work_phone: draft.workPhone,
            p_mobile_phone: draft.mobilePhone,
            p_address_line1: draft.addressLine1,
            p_address_line2: draft.addressLine2,
            p_city: draft.city,
            p_state_region: draft.stateRegion,
            p_postal_code: draft.postalCode,
            p_country: draft.country,
            p_secondary_email_visible: draft.secondaryEmailVisible,
            p_home_phone_visible: draft.homePhoneVisible,
            p_work_phone_visible: draft.workPhoneVisible,
            p_mobile_phone_visible: draft.mobilePhoneVisible,
            p_address_listed: draft.addressListed,
            p_expected_profile_version: parsed.data.expectedProfileVersion,
            p_expected_contact_version: parsed.data.expectedContactVersion,
            p_expected_membership_version:
              parsed.data.expectedMembershipVersion,
            p_reason: parsed.data.reason ?? null,
            p_correlation_id: operationContext.correlationId,
            p_operation_id: operationContext.operationId,
          },
        );
        if (error)
          return mapError(error.message, operationContext.correlationId);
        return resolve(operationContext.correlationId);
      } catch {
        return mapError("network_unavailable", operationContext.correlationId);
      }
    },
    async setHandicap(
      input: Readonly<{
        handicapId: string;
        handicap: string;
        asOf: string;
        expectedMembershipVersion: number;
        confirmed: boolean;
        reason: string;
      }>,
      operationContext: MobileMutationOperationContext = contextDefaults(),
    ): Promise<MobileSelfProfileResult> {
      const parsed = handicapInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          code: "validation",
          correlationId: operationContext.correlationId,
          field: String(parsed.error.issues[0]?.path[0] ?? "handicap"),
          message: "Enter a valid handicap, date, confirmation, and reason.",
          ok: false,
        };
      }
      try {
        const { error } = await client.rpc("set_mobile_member_self_handicap", {
          p_handicap_id: parsed.data.handicapId || null,
          p_handicap: parsed.data.handicap,
          p_as_of: parsed.data.asOf,
          p_expected_membership_version: parsed.data.expectedMembershipVersion,
          p_confirmed: parsed.data.confirmed,
          p_reason: parsed.data.reason,
          p_correlation_id: operationContext.correlationId,
          p_operation_id: operationContext.operationId,
        });
        if (error)
          return mapError(error.message, operationContext.correlationId);
        return resolve(operationContext.correlationId);
      } catch {
        return mapError("network_unavailable", operationContext.correlationId);
      }
    },
  };
}

export const mobileSelfProfileApi = createMobileSelfProfileApi(mobileSupabase);
