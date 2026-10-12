import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { resolveCorrelationId } from "../lib/mutations/correlation";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import {
  MutationError,
  mutationFailure,
  type MutationFieldErrors,
  type MutationResult,
} from "../lib/mutations/result";

const uuidSchema = z.uuid();

export const roundCompletionPreviewInputSchema = z
  .object({
    roundId: uuidSchema,
    groupId: uuidSchema,
  })
  .strict();

export const roundCompletionInputSchema = z
  .object({
    roundId: uuidSchema,
    expectedRoundVersion: z.number().int().positive(),
    confirmed: z.literal(true),
    operationId: uuidSchema,
  })
  .strict();

export const roundReopenInputSchema = z
  .object({
    roundId: uuidSchema,
    reason: z
      .string()
      .trim()
      .min(1, "Add a reason between 1 and 500 characters.")
      .max(500, "Add a reason between 1 and 500 characters."),
    expectedRoundVersion: z.number().int().positive(),
    confirmed: z.literal(true),
    operationId: uuidSchema,
  })
  .strict();

export type RoundCompletionPreviewInput = z.infer<
  typeof roundCompletionPreviewInputSchema
>;
export type RoundCompletionInput = z.infer<typeof roundCompletionInputSchema>;
export type RoundReopenInput = z.infer<typeof roundReopenInputSchema>;

export type RoundCompletionReadiness = Readonly<{
  status: "blocked" | "warning" | "server_ready";
  blockerCode: string | null;
  warningCode: string | null;
  participantId: string | null;
  participantKind: "member" | "guest" | null;
  details: Readonly<Record<string, unknown>>;
}>;

export type RoundCompletionParticipant = Readonly<{
  participantId: string;
  participantKind: "member" | "guest";
  participantName: string;
  membershipId: string | null;
  sponsorMembershipId: string | null;
  rankingValue: string | null;
  competitionRank: number | null;
  isWinner: boolean;
  winnerTieSize: number;
  golfPoints: string | null;
  grossScore: string | null;
  netScore: string | null;
  quotaSnapshot: string | null;
  quotaBefore: string | null;
  quotaAfter: string | null;
  plusMinus: string | null;
  scoreRevisionId: string | null;
  standingBefore: number | null;
  standingAfter: number | null;
  standingDelta: number | null;
  merit: Readonly<{
    participation: string;
    placement: string;
    manual: string;
    generated: string;
    total: string;
  }>;
}>;

export type RoundCompletionConsequences = Readonly<{
  winnerCount: number;
  winnerIsTie: boolean;
  participantCount: number;
  memberQuotaImpactCount: number;
  standingImpactCount: number;
}>;

export type RoundCompletionPreview = Readonly<{
  roundId: string;
  groupId: string;
  format: "individual_net" | "individual_gross";
  state: "live";
  snapshotPresent: boolean;
  readiness: readonly RoundCompletionReadiness[];
  serverChecksPassed: boolean;
  warningCount: number;
  mobileSyncCheck: "complete" | "blocked" | "unavailable";
  completionHandshakeRequired: boolean;
  completionAllowed: boolean;
  consequences: RoundCompletionConsequences;
  participants: readonly RoundCompletionParticipant[];
}>;

export type RoundCompletionReceipt = Readonly<{
  roundId: string;
  groupId: string;
  completionId: string;
  completionNumber: number;
  state: "completed";
  version: number;
  completedAt: string;
  outboxJobId: string;
}>;

export type RoundReopenReceipt = Readonly<{
  roundId: string;
  groupId: string;
  completionId: string;
  state: "live";
  version: number;
  reopenedAt: string;
  reopenReason: string;
}>;

export type RoundCompletionPreviewDependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: RoundCompletionPreviewInput,
  ) => Promise<RoundCompletionPreview>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export type RoundCompletionMutationDependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: RoundCompletionInput,
    correlationId: string,
  ) => Promise<RoundCompletionReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export type RoundReopenMutationDependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: RoundReopenInput,
    correlationId: string,
  ) => Promise<RoundReopenReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runRoundCompletionPreview(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundCompletionPreviewDependencies,
): Promise<MutationResult<RoundCompletionPreview>> {
  const correlationId = resolveCorrelationId(correlationCandidate);
  try {
    const session = await dependencies.verifySession();
    const parsed = roundCompletionPreviewInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new MutationError("validation", {
        fieldErrors: fieldErrors(parsed.error.issues),
      });
    }
    const data = await dependencies.execute(session.userId, parsed.data);
    return { ok: true, data, correlationId };
  } catch (error) {
    return mutationFailure(error, correlationId);
  }
}

export async function runRoundCompletionMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundCompletionMutationDependencies,
): Promise<MutationResult<RoundCompletionReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: roundCompletionInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export async function runRoundReopenMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundReopenMutationDependencies,
): Promise<MutationResult<RoundReopenReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: roundReopenInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export function roundCompletionFieldErrors(
  message: string | undefined,
): MutationFieldErrors | undefined {
  switch (message) {
    case "round_completion_confirmation_required":
      return { confirmed: ["Confirm completion after reviewing the preview."] };
    case "round_reopen_confirmation_required":
      return { confirmed: ["Confirm reopening after reviewing the impact."] };
    case "round_reopen_reason_required":
      return { reason: ["Add a reason between 1 and 500 characters."] };
    case "round_version_invalid":
    case "round_version_changed":
      return {
        expectedRoundVersion: ["Refresh the round before trying again."],
      };
    case "round_completion_context_required":
    case "round_not_found":
      return { roundId: ["Select a round in this group and refresh."] };
    default:
      return undefined;
  }
}

function fieldErrors(issues: readonly z.core.$ZodIssue[]): MutationFieldErrors {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string") {
      (errors[field] ??= []).push(issue.message);
    }
  }
  return errors;
}
