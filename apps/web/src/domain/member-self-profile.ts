import { z } from "zod";

const nullableText = (max: number) => z.string().max(max).nullable();

export const memberSelfProfileDraftSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1, "Enter your first name.")
      .max(100, "Keep your first name to 100 characters or fewer."),
    lastName: z
      .string()
      .trim()
      .min(1, "Enter your last name.")
      .max(100, "Keep your last name to 100 characters or fewer."),
    spouseFirstName: nullableText(100),
    spouseLastName: nullableText(100),
    teeLocation: z.enum(["pro", "back", "middle", "front"]).nullable(),
    secondaryEmail: z
      .string()
      .trim()
      .max(320)
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u, "Enter a valid e-mail address.")
      .nullable(),
    homePhone: nullableText(64),
    workPhone: nullableText(64),
    mobilePhone: nullableText(64),
    addressLine1: nullableText(200),
    addressLine2: nullableText(200),
    city: nullableText(100),
    stateRegion: nullableText(100),
    postalCode: nullableText(32),
    country: nullableText(100),
    secondaryEmailVisible: z.boolean(),
    homePhoneVisible: z.boolean(),
    workPhoneVisible: z.boolean(),
    mobilePhoneVisible: z.boolean(),
    addressListed: z.boolean(),
  })
  .strict();

export type MemberSelfProfileDraft = z.infer<
  typeof memberSelfProfileDraftSchema
>;

export const memberSelfProfileInputSchema = memberSelfProfileDraftSchema
  .extend({
    expectedProfileVersion: z.number().int().nonnegative(),
    expectedContactVersion: z.number().int().nonnegative(),
    expectedMembershipVersion: z.number().int().positive(),
    reason: z.string().trim().max(500).nullable().optional(),
    operationId: z.uuid(),
  })
  .strict();

export const memberSelfHandicapInputSchema = z
  .object({
    handicapId: z.string().trim().max(100),
    handicap: z
      .string()
      .trim()
      .regex(/^[+-]?\d+(?:\.\d)?$/u, "Enter a handicap such as 12.4.")
      .refine((value) => {
        const numericValue = Number(value);
        return numericValue >= -10 && numericValue <= 54;
      }, "Enter a handicap from -10 to 54."),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    expectedMembershipVersion: z.number().int().positive(),
    confirmed: z.literal(true),
    reason: z
      .string()
      .trim()
      .min(1, "Add a reason for this handicap change.")
      .max(500, "Keep the reason to 500 characters or fewer."),
    operationId: z.uuid(),
  })
  .strict();

export type MemberSelfProfileInput = z.infer<
  typeof memberSelfProfileInputSchema
>;
export type MemberSelfHandicapInput = z.infer<
  typeof memberSelfHandicapInputSchema
>;

export type MemberSelfProfile = Readonly<{
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
  draft: MemberSelfProfileDraft;
  handicapRecordId: string | null;
  handicapId: string | null;
  handicap: string | null;
  handicapSource: "manual" | "import" | null;
  handicapAsOf: string | null;
  handicapCreatedAt: string | null;
}>;

function nullableTextValue(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

export function normalizeMemberSelfProfileDraft(
  value: Readonly<Partial<MemberSelfProfileDraft>>,
): MemberSelfProfileDraft {
  return memberSelfProfileDraftSchema.parse({
    firstName: value.firstName?.trim() ?? "",
    lastName: value.lastName?.trim() ?? "",
    spouseFirstName: nullableTextValue(value.spouseFirstName ?? null),
    spouseLastName: nullableTextValue(value.spouseLastName ?? null),
    teeLocation: value.teeLocation ?? null,
    secondaryEmail:
      nullableTextValue(value.secondaryEmail ?? null)?.toLowerCase() ?? null,
    homePhone: nullableTextValue(value.homePhone ?? null),
    workPhone: nullableTextValue(value.workPhone ?? null),
    mobilePhone: nullableTextValue(value.mobilePhone ?? null),
    addressLine1: nullableTextValue(value.addressLine1 ?? null),
    addressLine2: nullableTextValue(value.addressLine2 ?? null),
    city: nullableTextValue(value.city ?? null),
    stateRegion: nullableTextValue(value.stateRegion ?? null),
    postalCode: nullableTextValue(value.postalCode ?? null),
    country: nullableTextValue(value.country ?? null),
    secondaryEmailVisible: value.secondaryEmailVisible === true,
    homePhoneVisible: value.homePhoneVisible === true,
    workPhoneVisible: value.workPhoneVisible === true,
    mobilePhoneVisible: value.mobilePhoneVisible === true,
    addressListed: value.addressListed === true,
  });
}
