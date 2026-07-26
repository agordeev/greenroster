import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { runVerifiedMutation } from "../mutations/run-verified-mutation";
import type { MutationResult } from "../mutations/result";

const administratorRoleTransferInputSchema = z
  .object({
    replacementMembershipId: z.uuid(),
    expectedGroupVersion: z.number().int().positive(),
    confirmed: z.boolean().refine((confirmed) => confirmed, {
      message: "Confirm the administrator transfer.",
    }),
    reason: z.string().trim().min(1).max(500),
    operationId: z.uuid(),
  })
  .strict();

export type AdministratorRoleTransferInput = z.infer<
  typeof administratorRoleTransferInputSchema
>;

export type AdministratorRoleTransferResult = Readonly<{
  groupId: string;
  groupVersion: number;
  previousAdministratorMembershipId: string;
  previousAdministratorRole: "coordinator";
  replacementMembershipId: string;
  replacementRole: "administrator";
}>;

export type AdministratorRoleTransferDependencies = Readonly<{
  verifySession: () => Promise<VerifiedMutationSession>;
  executeTransfer: (
    actorUserId: string,
    input: AdministratorRoleTransferInput,
    correlationId: string,
  ) => Promise<AdministratorRoleTransferResult>;
}>;

export async function runAdministratorRoleTransferMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: AdministratorRoleTransferDependencies,
): Promise<MutationResult<AdministratorRoleTransferResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.executeTransfer,
    inputSchema: administratorRoleTransferInputSchema,
    verifySession: dependencies.verifySession,
  });
}
