import { z } from "zod";

const nullableTextSchema = (max: number) => z.string().max(max).nullable();

export const mobileSelfProfileDraftSchema = z
  .object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    spouseFirstName: nullableTextSchema(100),
    spouseLastName: nullableTextSchema(100),
    teeLocation: z.enum(["pro", "back", "middle", "front"]).nullable(),
    secondaryEmail: z
      .string()
      .max(320)
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
      .nullable(),
    homePhone: nullableTextSchema(64),
    workPhone: nullableTextSchema(64),
    mobilePhone: nullableTextSchema(64),
    addressLine1: nullableTextSchema(200),
    addressLine2: nullableTextSchema(200),
    city: nullableTextSchema(100),
    stateRegion: nullableTextSchema(100),
    postalCode: nullableTextSchema(32),
    country: nullableTextSchema(100),
    secondaryEmailVisible: z.boolean(),
    homePhoneVisible: z.boolean(),
    workPhoneVisible: z.boolean(),
    mobilePhoneVisible: z.boolean(),
    addressListed: z.boolean(),
  })
  .strict();

export type MobileSelfProfileDraft = z.infer<
  typeof mobileSelfProfileDraftSchema
>;

export type MobileMutationOperationContext = Readonly<{
  correlationId: string;
  operationId: string;
}>;

export type MobileMutationRetryContext = MobileMutationOperationContext &
  Readonly<{ fingerprint: string }>;

export function getMobileMutationRetryContext(
  current: MobileMutationRetryContext | null,
  fingerprint: string,
  createContext: () => MobileMutationOperationContext,
) {
  if (current?.fingerprint === fingerprint) return current;
  return { ...createContext(), fingerprint };
}

const nullableText = (value: string | null | undefined) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized === "" ? null : normalized;
};

export function normalizeMobileSelfProfileDraft(
  value: Readonly<Partial<MobileSelfProfileDraft>>,
): MobileSelfProfileDraft {
  return mobileSelfProfileDraftSchema.parse({
    firstName:
      typeof value.firstName === "string" ? value.firstName.trim() : "",
    lastName: typeof value.lastName === "string" ? value.lastName.trim() : "",
    spouseFirstName: nullableText(value.spouseFirstName),
    spouseLastName: nullableText(value.spouseLastName),
    teeLocation:
      typeof value.teeLocation === "string"
        ? value.teeLocation.trim().toLowerCase() || null
        : null,
    secondaryEmail: nullableText(value.secondaryEmail)?.toLowerCase() ?? null,
    homePhone: nullableText(value.homePhone),
    workPhone: nullableText(value.workPhone),
    mobilePhone: nullableText(value.mobilePhone),
    addressLine1: nullableText(value.addressLine1),
    addressLine2: nullableText(value.addressLine2),
    city: nullableText(value.city),
    stateRegion: nullableText(value.stateRegion),
    postalCode: nullableText(value.postalCode),
    country: nullableText(value.country),
    secondaryEmailVisible: value.secondaryEmailVisible === true,
    homePhoneVisible: value.homePhoneVisible === true,
    workPhoneVisible: value.workPhoneVisible === true,
    mobilePhoneVisible: value.mobilePhoneVisible === true,
    addressListed: value.addressListed === true,
  });
}

export function mobileSelfProfileDraftFingerprint(
  value: MobileSelfProfileDraft,
) {
  return JSON.stringify(value);
}

export function isMobileSelfProfileDraftDirty(
  initial: MobileSelfProfileDraft | null,
  current: MobileSelfProfileDraft,
) {
  return (
    initial === null ||
    mobileSelfProfileDraftFingerprint(initial) !==
      mobileSelfProfileDraftFingerprint(current)
  );
}
