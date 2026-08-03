import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { runVerifiedMutation } from "../mutations/run-verified-mutation";
import type { MutationResult } from "../mutations/result";

import {
  createRoundDraftInputSchema,
  updateRoundDraftInputSchema,
  type CreateRoundDraftInput,
  type RoundDraft,
  type UpdateRoundDraftInput,
} from "../../domain/round-drafts";

export type RoundDraftMutationDependencies<TInput> = Readonly<{
  execute: (
    actorUserId: string,
    input: TInput,
    correlationId: string,
  ) => Promise<RoundDraft>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runCreateRoundDraftMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundDraftMutationDependencies<CreateRoundDraftInput>,
): Promise<MutationResult<RoundDraft>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: createRoundDraftInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export async function runUpdateRoundDraftMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundDraftMutationDependencies<UpdateRoundDraftInput>,
): Promise<MutationResult<RoundDraft>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: updateRoundDraftInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export type RoundDraftListDependencies = Readonly<{
  list: (actorUserId: string) => Promise<readonly RoundDraft[]>;
}>;

export type RoundDraftPageData = Readonly<{
  rounds: readonly RoundDraft[];
}>;

export function selectRoundDraft(
  rounds: readonly RoundDraft[],
  roundId: string | null | undefined,
): RoundDraft | null {
  if (!roundId || !z.uuid().safeParse(roundId).success) return null;
  return rounds.find((round) => round.roundId === roundId) ?? null;
}
