import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { runVerifiedMutation } from "../mutations/run-verified-mutation";
import type { MutationResult } from "../mutations/result";

const trimmedOrNull = (value: unknown) =>
  value === null || value === undefined
    ? null
    : typeof value === "string"
      ? value.trim() || null
      : value;

const nullableTrimmedString = (max: number) =>
  z.preprocess(trimmedOrNull, z.string().max(max).nullable());

const nullableName = nullableTrimmedString(100);
const nullableReason = nullableTrimmedString(500);

const nullableEmail = z.preprocess(
  trimmedOrNull,
  z.string().max(320).toLowerCase().pipe(z.email()).nullable(),
);

const nullableTeeLocation = z.preprocess(
  (value) =>
    value === null || value === undefined
      ? null
      : typeof value === "string"
        ? value.trim().toLowerCase() || null
        : value,
  z.enum(["pro", "back", "middle", "front"]).nullable(),
);

const pendingMemberProfileInputSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    spouseFirstName: nullableName,
    spouseLastName: nullableName,
    teeLocation: nullableTeeLocation,
    duesPaid: z.preprocess(
      (value) => (value === null || value === undefined ? false : value),
      z.boolean(),
    ),
    secondaryEmail: nullableEmail,
    homePhone: nullableTrimmedString(64),
    workPhone: nullableTrimmedString(64),
    mobilePhone: nullableTrimmedString(64),
    addressLine1: nullableTrimmedString(200),
    addressLine2: nullableTrimmedString(200),
    city: nullableTrimmedString(100),
    stateRegion: nullableTrimmedString(100),
    postalCode: nullableTrimmedString(32),
    country: nullableTrimmedString(100),
    secondaryEmailVisible: z.boolean().default(false),
    homePhoneVisible: z.boolean().default(false),
    workPhoneVisible: z.boolean().default(false),
    mobilePhoneVisible: z.boolean().default(false),
    addressListed: z.boolean().default(false),
    reason: nullableReason,
    operationId: z.uuid(),
  })
  .strict();

export type PendingMemberProfileInput = z.infer<
  typeof pendingMemberProfileInputSchema
>;

export type PendingMemberProfileResult = Readonly<{
  membershipId: string;
  groupId: string;
  profileVersion: number;
  contactVersion: number;
}>;

export type PendingMemberProfileDependencies = Readonly<{
  verifySession: () => Promise<VerifiedMutationSession>;
  executeCreate: (
    actorUserId: string,
    input: PendingMemberProfileInput,
    correlationId: string,
  ) => Promise<PendingMemberProfileResult>;
}>;

export async function runPendingMemberProfileMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: PendingMemberProfileDependencies,
): Promise<MutationResult<PendingMemberProfileResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.executeCreate,
    inputSchema: pendingMemberProfileInputSchema,
    verifySession: dependencies.verifySession,
  });
}
