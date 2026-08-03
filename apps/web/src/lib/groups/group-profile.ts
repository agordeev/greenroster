import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { runVerifiedMutation } from "../mutations/run-verified-mutation";
import type { MutationResult } from "../mutations/result";

const groupProfileInputSchema = z
  .object({
    expectedGroupVersion: z.number().int().positive(),
    groupName: z.string().trim().min(1),
    groupTimeZone: z.string().trim().refine(isSupportedTimeZone),
    operationId: z.uuid(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type GroupProfileInput = z.infer<typeof groupProfileInputSchema>;

export type GroupProfileResult = Readonly<{
  groupId: string;
  groupName: string;
  groupTimeZone: string;
  groupVersion: number;
}>;

export type GroupProfileDependencies = Readonly<{
  executeUpdate: (
    actorUserId: string,
    input: GroupProfileInput,
    correlationId: string,
  ) => Promise<GroupProfileResult>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runGroupProfileMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: GroupProfileDependencies,
): Promise<MutationResult<GroupProfileResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.executeUpdate,
    inputSchema: groupProfileInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
