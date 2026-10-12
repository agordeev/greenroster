import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import type { MutationResult } from "../lib/mutations/result";

export const roundCancellationInputSchema = z
  .object({
    roundId: z.uuid(),
    reason: z
      .string()
      .trim()
      .min(1, "Add a reason for cancelling this round.")
      .max(500, "Keep the reason to 500 characters or fewer."),
    expectedRoundVersion: z.number().int().positive(),
    operationId: z.uuid(),
  })
  .strict();

export type RoundCancellationInput = z.infer<
  typeof roundCancellationInputSchema
>;

export function roundCancellationBlockedByDraftChanges(
  state: "draft" | "published" | "live",
  draftDirty: boolean,
): boolean {
  return state === "draft" && draftDirty;
}

export type RoundCancellationReceipt = Readonly<{
  roundId: string;
  groupId: string;
  state: "cancelled";
  version: number;
  cancelledAt: string;
  cancellationReason: string;
  participantCount: number;
  notificationCount: number;
}>;

export type RoundCancellationDependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: RoundCancellationInput,
    correlationId: string,
  ) => Promise<RoundCancellationReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runRoundCancellationMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundCancellationDependencies,
): Promise<MutationResult<RoundCancellationReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: roundCancellationInputSchema,
    verifySession: dependencies.verifySession,
  });
}
