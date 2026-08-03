import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { runVerifiedMutation } from "../mutations/run-verified-mutation";
import type { MutationResult } from "../mutations/result";

const groupGuestPermissionInputSchema = z
  .object({
    allowMemberGuests: z.boolean(),
    expectedGroupVersion: z.number().int().positive(),
    operationId: z.uuid(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type GroupGuestPermissionInput = z.infer<
  typeof groupGuestPermissionInputSchema
>;

export type GroupGuestPermission = Readonly<{
  groupId: string;
  allowMemberGuests: boolean;
  groupVersion: number;
}>;

export type GroupGuestPermissionDependencies = Readonly<{
  executeUpdate: (
    actorUserId: string,
    input: GroupGuestPermissionInput,
    correlationId: string,
  ) => Promise<GroupGuestPermission>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runGroupGuestPermissionMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: GroupGuestPermissionDependencies,
): Promise<MutationResult<GroupGuestPermission>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.executeUpdate,
    inputSchema: groupGuestPermissionInputSchema,
    verifySession: dependencies.verifySession,
  });
}
