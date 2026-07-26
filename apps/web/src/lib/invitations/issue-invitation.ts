import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { runVerifiedMutation } from "../mutations/run-verified-mutation";
import type { MutationResult } from "../mutations/result";

const normalizedEmail = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.email(),
);

export const issueInvitationInputSchema = z
  .object({
    membershipId: z.uuid(),
    invitedEmail: normalizedEmail,
    operationId: z.uuid(),
  })
  .strict();

export type IssueInvitationInput = z.infer<typeof issueInvitationInputSchema>;

export type IssueInvitationResult = Readonly<{
  invitationId: string;
  groupId: string;
  outboxId: string;
  deliveryId: string;
  expiresAt: string;
  invitationUrl: string;
}>;

export type IssueInvitationDependencies = Readonly<{
  verifySession: () => Promise<VerifiedMutationSession>;
  executeIssue: (
    actorUserId: string,
    input: IssueInvitationInput,
    correlationId: string,
  ) => Promise<IssueInvitationResult>;
}>;

export async function runIssueInvitationMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: IssueInvitationDependencies,
): Promise<MutationResult<IssueInvitationResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.executeIssue,
    inputSchema: issueInvitationInputSchema,
    verifySession: dependencies.verifySession,
  });
}
