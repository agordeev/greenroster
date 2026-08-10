import { z } from "zod";

import { runVerifiedMutation } from "@/lib/mutations/run-verified-mutation";
import type { MutationResult } from "@/lib/mutations/result";

export const organizerRegistrationSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(12),
    confirmPassword: z.string().min(1),
    acceptedTerms: z.literal(true),
    acceptedPrivacy: z.literal(true),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type OrganizerRegistrationInput = z.infer<
  typeof organizerRegistrationSchema
>;

const organizerBootstrapInputSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    groupName: z.string().trim().min(1).max(200),
    groupTimeZone: z.string().trim().refine(isSupportedTimeZone),
    acceptedTerms: z.literal(true),
    acceptedPrivacy: z.literal(true),
    operationId: z.uuid(),
  })
  .strict();

export type OrganizerBootstrapInput = z.infer<
  typeof organizerBootstrapInputSchema
>;

export type OrganizerBootstrapResult = Readonly<{
  groupId: string;
  administratorMembershipId: string;
}>;

export type OrganizerBootstrapDependencies = Readonly<{
  verifySession: () => Promise<{
    userId: string;
    emailConfirmedAt: string;
  }>;
  verifyLegalHandoff?: () => Promise<void>;
  executeBootstrap: (
    actorUserId: string,
    input: OrganizerBootstrapInput,
    correlationId: string,
  ) => Promise<OrganizerBootstrapResult>;
}>;

function isSupportedTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export { organizerBootstrapInputSchema };

export async function runOrganizerBootstrapMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: OrganizerBootstrapDependencies,
): Promise<MutationResult<OrganizerBootstrapResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: async (actorUserId, input, correlationId) => {
      await dependencies.verifyLegalHandoff?.();
      return dependencies.executeBootstrap(actorUserId, input, correlationId);
    },
    inputSchema: organizerBootstrapInputSchema,
    verifySession: dependencies.verifySession,
  });
}
