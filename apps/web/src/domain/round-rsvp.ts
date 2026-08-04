import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import type { MutationResult } from "../lib/mutations/result";

export const roundRsvpInputSchema = z
  .object({
    roundId: z.uuid(),
    rsvpStatus: z.enum(["playing", "not_playing"]),
    expectedParticipantVersion: z.number().int().positive(),
    operationId: z.uuid(),
  })
  .strict();

export type RoundRsvpInput = z.infer<typeof roundRsvpInputSchema>;
export type RoundRsvpSource = "mobile" | "member_web";
export type RoundRsvpExecutionInput = RoundRsvpInput & {
  source: RoundRsvpSource;
};

export type RoundRsvpReceipt = Readonly<{
  roundId: string;
  groupId: string;
  participantId: string;
  membershipId: string;
  rsvpStatus: "playing" | "not_playing";
  version: number;
  changedAt: string;
}>;

export type RoundParticipantRead = Readonly<{
  roundId: string;
  participantId: string;
  groupId: string;
  participantKind: "member" | "guest";
  membershipId: string | null;
  sponsorMembershipId: string | null;
  firstName: string | null;
  lastName: string | null;
  rsvpStatus: "no_response" | "playing" | "not_playing";
  version: number;
  quotaSnapshot: string | null;
  quotaSnapshotSource: Record<string, unknown> | null;
  handicapSnapshot: string | null;
  handicapSnapshotSource: "manual" | "import" | null;
  handicapSnapshotAsOf: string | null;
  teeSnapshot: string | null;
}>;

export type RoundRsvpDependencies = Readonly<{
  source: RoundRsvpSource;
  execute: (
    actorUserId: string,
    input: RoundRsvpExecutionInput,
    correlationId: string,
  ) => Promise<RoundRsvpReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runRoundRsvpMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundRsvpDependencies,
): Promise<MutationResult<RoundRsvpReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: (actorUserId, input, correlationId) =>
      dependencies.execute(
        actorUserId,
        { ...input, source: dependencies.source },
        correlationId,
      ),
    inputSchema: roundRsvpInputSchema,
    verifySession: dependencies.verifySession,
  });
}
