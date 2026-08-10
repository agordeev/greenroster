import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { runVerifiedMutation } from "../mutations/run-verified-mutation";
import type { MutationResult } from "../mutations/result";

const createInputSchema = z
  .object({
    roundId: z.uuid(),
    expiresAt: z.string().datetime({ offset: true }),
    operationId: z.uuid(),
  })
  .strict();

const revokeInputSchema = z
  .object({
    accessId: z.uuid(),
    reason: z.string().trim().min(1).max(500),
    operationId: z.uuid(),
  })
  .strict();

export type CreateScoreboardAccessInput = z.infer<typeof createInputSchema>;
export type RevokeScoreboardAccessInput = z.infer<typeof revokeInputSchema>;

export type ScoreboardAccessGrant = Readonly<{
  accessId: string;
  groupId: string;
  roundId: string;
  state: "active" | "revoked";
  expiresAt: string;
  url?: string;
}>;

export type ScoreboardAccessDependencies = Readonly<{
  executeCreate: (
    actorUserId: string,
    input: CreateScoreboardAccessInput,
    correlationId: string,
  ) => Promise<ScoreboardAccessGrant>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export type RevokeScoreboardAccessDependencies = Readonly<{
  executeRevoke: (
    actorUserId: string,
    input: RevokeScoreboardAccessInput,
    correlationId: string,
  ) => Promise<ScoreboardAccessGrant>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export function runCreateScoreboardAccessMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: ScoreboardAccessDependencies,
): Promise<MutationResult<ScoreboardAccessGrant>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.executeCreate,
    inputSchema: createInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export function runRevokeScoreboardAccessMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RevokeScoreboardAccessDependencies,
): Promise<MutationResult<ScoreboardAccessGrant>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.executeRevoke,
    inputSchema: revokeInputSchema,
    verifySession: dependencies.verifySession,
  });
}
