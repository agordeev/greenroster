import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { runVerifiedMutation } from "../mutations/run-verified-mutation";
import type { MutationResult } from "../mutations/result";

const confirmation = z.literal(true, {
  error: "Confirm the invitation change before continuing.",
});

const lifecycleInput = z.object({
  invitationId: z.uuid(),
  confirmed: confirmation,
  reason: z.string().trim().min(1).max(500),
  operationId: z.uuid(),
});

const normalizedEmail = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.email(),
);

export const regenerateInvitationInputSchema = lifecycleInput.strict();

export const correctInvitationInputSchema = lifecycleInput
  .extend({ invitedEmail: normalizedEmail })
  .strict();

export const revokeInvitationInputSchema = lifecycleInput.strict();

export type RegenerateInvitationInput = z.infer<
  typeof regenerateInvitationInputSchema
>;
export type CorrectInvitationInput = z.infer<
  typeof correctInvitationInputSchema
>;
export type RevokeInvitationInput = z.infer<typeof revokeInvitationInputSchema>;

export type InvitationLifecycleResult = Readonly<{
  previousInvitationId: string;
  invitationId: string;
  membershipId: string;
  groupId: string;
  outboxId: string;
  deliveryId: string;
  invitedEmail: string;
  expiresAt: string;
  invitationUrl: string;
}>;

export type RevokeInvitationResult = Readonly<{
  invitationId: string;
  membershipId: string;
  groupId: string;
  status: "revoked";
  version: number;
  revokedAt: string;
}>;

export type ManageableInvitation = Readonly<{
  invitationId: string;
  membershipId: string;
  memberFirstName: string;
  memberLastName: string;
  invitedEmail: string;
  status: "pending" | "expired" | "accepted" | "revoked";
  expiresAt: string;
  version: number;
  deliveryState:
    | "queued"
    | "sending"
    | "sent"
    | "retryable"
    | "failed_permanent"
    | "suppressed"
    | "cancelled"
    | null;
  deliveryFailureReason: string | null;
}>;

export type InvitationLifecycleDependencies = Readonly<{
  verifySession: () => Promise<VerifiedMutationSession>;
  executeRegenerate: (
    actorUserId: string,
    input: RegenerateInvitationInput,
    correlationId: string,
  ) => Promise<InvitationLifecycleResult>;
}>;

export type CorrectInvitationDependencies = Readonly<{
  verifySession: () => Promise<VerifiedMutationSession>;
  executeCorrect: (
    actorUserId: string,
    input: CorrectInvitationInput,
    correlationId: string,
  ) => Promise<InvitationLifecycleResult>;
}>;

export type RevokeInvitationDependencies = Readonly<{
  verifySession: () => Promise<VerifiedMutationSession>;
  executeRevoke: (
    actorUserId: string,
    input: RevokeInvitationInput,
    correlationId: string,
  ) => Promise<RevokeInvitationResult>;
}>;

export async function runRegenerateInvitationMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: InvitationLifecycleDependencies,
): Promise<MutationResult<InvitationLifecycleResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.executeRegenerate,
    inputSchema: regenerateInvitationInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export async function runCorrectInvitationMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: CorrectInvitationDependencies,
): Promise<MutationResult<InvitationLifecycleResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.executeCorrect,
    inputSchema: correctInvitationInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export async function runRevokeInvitationMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RevokeInvitationDependencies,
): Promise<MutationResult<RevokeInvitationResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.executeRevoke,
    inputSchema: revokeInvitationInputSchema,
    verifySession: dependencies.verifySession,
  });
}
