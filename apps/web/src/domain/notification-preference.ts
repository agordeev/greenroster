import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import type { MutationResult } from "../lib/mutations/result";

// Members choose e-mail per category on the web. Push needs a phone that
// registered with the app, so it is not offered here.
export const emailPreferenceInputSchema = z
  .object({
    category: z.string().regex(/^[a-z_]{1,64}$/u),
    enabled: z.boolean(),
    expectedVersion: z.number().int().nonnegative(),
    operationId: z.uuid(),
  })
  .strict();

export type EmailPreferenceInput = z.infer<typeof emailPreferenceInputSchema>;

export type EmailPreferenceReceipt = Readonly<{
  category: string;
  emailEnabled: boolean;
  version: number;
}>;

export function runSetEmailPreferenceMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: Readonly<{
    execute: (
      actorUserId: string,
      input: EmailPreferenceInput,
      correlationId: string,
    ) => Promise<EmailPreferenceReceipt>;
    verifySession: () => Promise<VerifiedMutationSession>;
  }>,
): Promise<MutationResult<EmailPreferenceReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    ...dependencies,
    inputSchema: emailPreferenceInputSchema,
  });
}
