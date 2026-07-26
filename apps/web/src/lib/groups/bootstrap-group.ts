import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { runVerifiedMutation } from "../mutations/run-verified-mutation";
import type { MutationResult } from "../mutations/result";

const groupBootstrapInputSchema = z
  .object({
    groupName: z.string().trim().min(1),
    groupTimeZone: z.string().trim().refine(isSupportedTimeZone),
    operationId: z.uuid(),
  })
  .strict();

export type GroupBootstrapInput = z.infer<typeof groupBootstrapInputSchema>;

export type GroupBootstrapResult = Readonly<{
  groupId: string;
  administratorMembershipId: string;
}>;

export type GroupBootstrapDependencies = Readonly<{
  verifySession: () => Promise<VerifiedMutationSession>;
  executeBootstrap: (
    actorUserId: string,
    input: GroupBootstrapInput,
    correlationId: string,
  ) => Promise<GroupBootstrapResult>;
}>;

function isSupportedTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function runGroupBootstrapMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: GroupBootstrapDependencies,
): Promise<MutationResult<GroupBootstrapResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.executeBootstrap,
    inputSchema: groupBootstrapInputSchema,
    verifySession: dependencies.verifySession,
  });
}
