import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import type { MutationResult } from "../lib/mutations/result";

export const roundScoringInputSchema = z
  .object({
    roundId: z.uuid(),
    expectedRoundVersion: z.number().int().positive(),
    confirmed: z.literal(true),
    operationId: z.uuid(),
  })
  .strict();

export type RoundScoringInput = z.infer<typeof roundScoringInputSchema>;

export function roundScoringBlockedByDraftChanges(
  draftDirty: boolean,
): boolean {
  return draftDirty;
}

export type RoundScoringReceipt = Readonly<{
  roundId: string;
  groupId: string;
  state: "live";
  version: number;
  openedAt: string;
}>;

export type RoundScoringDependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: RoundScoringInput,
    correlationId: string,
  ) => Promise<RoundScoringReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runRoundScoringMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundScoringDependencies,
): Promise<MutationResult<RoundScoringReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: roundScoringInputSchema,
    verifySession: dependencies.verifySession,
  });
}
