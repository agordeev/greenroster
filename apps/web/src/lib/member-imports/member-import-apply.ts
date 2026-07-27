import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { runVerifiedMutation } from "../mutations/run-verified-mutation";
import type { MutationResult } from "../mutations/result";

const inputSchema = z
  .object({
    jobId: z.uuid(),
    expectedRevision: z.number().int().positive(),
    confirmed: z.literal(true),
    reason: z.string().trim().min(1).max(500),
    operationId: z.uuid(),
  })
  .strict();

export type MemberImportApplyInput = z.infer<typeof inputSchema>;
export type MemberImportApplyReceipt = Readonly<{
  jobId: string;
  state: "uploaded" | "applying" | "completed";
  revision: number;
}>;

type Dependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: MemberImportApplyInput,
    correlationId: string,
  ) => Promise<MemberImportApplyReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export function runMemberImportApplyRequest(
  input: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: Dependencies,
): Promise<MutationResult<MemberImportApplyReceipt>> {
  return runVerifiedMutation(input, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema,
    verifySession: dependencies.verifySession,
  });
}
