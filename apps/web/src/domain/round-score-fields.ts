import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import type { MutationResult } from "../lib/mutations/result";

export const roundScoreFieldsInputSchema = z
  .object({
    roundId: z.uuid(),
    enableGrossScore: z.boolean(),
    enableNetScore: z.boolean(),
    expectedRoundVersion: z.number().int().positive(),
    operationId: z.uuid(),
  })
  .strict();

export type RoundScoreFieldsInput = z.infer<typeof roundScoreFieldsInputSchema>;

export type RoundScoreFieldsReceipt = Readonly<{
  roundId: string;
  groupId: string;
  format: "individual_net" | "individual_gross";
  enableGrossScore: boolean;
  enableNetScore: boolean;
  version: number;
}>;

export type RoundScoreFieldsDependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: RoundScoreFieldsInput,
    correlationId: string,
  ) => Promise<RoundScoreFieldsReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runRoundScoreFieldsMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundScoreFieldsDependencies,
): Promise<MutationResult<RoundScoreFieldsReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: roundScoreFieldsInputSchema,
    verifySession: dependencies.verifySession,
  });
}
