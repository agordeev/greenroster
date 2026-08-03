import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import type { MutationResult } from "../lib/mutations/result";

export const liveRoundParticipantNotPlayingInputSchema = z
  .object({
    roundId: z.uuid(),
    participantId: z.uuid(),
    expectedParticipantVersion: z.number().int().positive(),
    confirmed: z.literal(true),
    reason: z.string().trim().min(1).max(500),
    operationId: z.uuid(),
  })
  .strict();

export type LiveRoundParticipantNotPlayingInput = z.infer<
  typeof liveRoundParticipantNotPlayingInputSchema
>;
export type LiveRoundParticipantNotPlayingSource = "portal";
export type LiveRoundParticipantNotPlayingExecutionInput =
  LiveRoundParticipantNotPlayingInput & {
    source: LiveRoundParticipantNotPlayingSource;
  };

export type LiveRoundParticipantNotPlayingReceipt = Readonly<{
  roundId: string;
  groupId: string;
  participantId: string;
  membershipId: string | null;
  rsvpStatus: "not_playing";
  version: number;
  scoreInvalidated: boolean;
  changedAt: string;
}>;

export type LiveRoundParticipantNotPlayingDependencies = Readonly<{
  source: LiveRoundParticipantNotPlayingSource;
  execute: (
    actorUserId: string,
    input: LiveRoundParticipantNotPlayingExecutionInput,
    correlationId: string,
  ) => Promise<LiveRoundParticipantNotPlayingReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runLiveRoundParticipantNotPlayingMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: LiveRoundParticipantNotPlayingDependencies,
): Promise<MutationResult<LiveRoundParticipantNotPlayingReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: (actorUserId, input, correlationId) =>
      dependencies.execute(
        actorUserId,
        { ...input, source: dependencies.source },
        correlationId,
      ),
    inputSchema: liveRoundParticipantNotPlayingInputSchema,
    verifySession: dependencies.verifySession,
  });
}
