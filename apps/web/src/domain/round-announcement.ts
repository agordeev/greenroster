import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import type { MutationResult } from "../lib/mutations/result";

export const roundAnnouncementInputSchema = z
  .object({
    roundId: z.uuid(),
    body: z
      .string()
      .trim()
      .min(1, "Write an update before posting.")
      .max(300, "Keep your update to 300 characters or fewer."),
    operationId: z.uuid(),
  })
  .strict();

export type RoundAnnouncementInput = z.infer<
  typeof roundAnnouncementInputSchema
>;

export type RoundAnnouncementReceipt = Readonly<{
  announcementId: string;
  groupId: string;
  roundId: string;
  body: string;
  authorDisplayName: string;
  authorRole: "member" | "coordinator" | "administrator";
  createdAt: string;
  outboxJobId: string;
  inboxCount: number;
}>;

export type RoundAnnouncementMutationDependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: RoundAnnouncementInput,
    correlationId: string,
  ) => Promise<RoundAnnouncementReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runRoundAnnouncementMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundAnnouncementMutationDependencies,
): Promise<MutationResult<RoundAnnouncementReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: roundAnnouncementInputSchema,
    verifySession: dependencies.verifySession,
  });
}
