import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import type { MutationResult } from "../lib/mutations/result";

const scoreFieldNames = [
  "golf_points",
  "gross_score",
  "net_score",
  "manual_merit",
] as const;

export type RoundScoreField = (typeof scoreFieldNames)[number];

const scoreFieldValueSchemas = {
  golf_points: z.number().finite().min(0).max(100).multipleOf(0.01).nullable(),
  gross_score: z.number().finite().int().min(0).max(300).nullable(),
  net_score: z.number().finite().int().min(0).max(300).nullable(),
  manual_merit: z
    .number()
    .finite()
    .min(-1000)
    .max(1000)
    .multipleOf(0.01)
    .nullable(),
} as const;

const scoreFieldValueSchema = z.number().finite().nullable();

export const roundScoreChangedFieldsSchema = z
  .record(z.string(), scoreFieldValueSchema)
  .superRefine((fields, context) => {
    const keys = Object.keys(fields);
    if (keys.length === 0) {
      context.addIssue({
        code: "custom",
        message: "At least one score field is required.",
      });
    }
    for (const key of keys) {
      if (!(scoreFieldNames as readonly string[]).includes(key)) {
        context.addIssue({
          code: "custom",
          message: "Only enabled authored score fields may be changed.",
          path: [key],
        });
        continue;
      }
      const fieldSchema =
        scoreFieldValueSchemas[key as keyof typeof scoreFieldValueSchemas];
      if (!fieldSchema.safeParse(fields[key]).success) {
        context.addIssue({
          code: "custom",
          message: "The score value is outside the supported range or scale.",
          path: [key],
        });
      }
    }
  });

export type RoundScoreChangedFields = z.infer<
  typeof roundScoreChangedFieldsSchema
>;

export const roundScoreInputSchema = z
  .object({
    participantId: z.uuid(),
    changedFields: roundScoreChangedFieldsSchema,
    expectedScoreVersion: z.number().int().nonnegative(),
    deviceOperationId: z.uuid(),
    reason: z.string().trim().max(500).nullable().optional(),
    clientChangedAt: z.string().datetime({ offset: true }),
    operationId: z.uuid(),
  })
  .strict();

export type RoundScoreCurrentState = Readonly<{
  participantId: string;
  version: number;
  revisionId: string | null;
  grossScore: string | null;
  netScore: string | null;
  golfPoints: string | null;
  manualMerit: string | null;
  plusMinus: string | null;
  rankingValue: string | null;
  changedAt: string | null;
}>;

export type RoundScoreInput = z.infer<typeof roundScoreInputSchema>;
export type RoundScoreSource = "mobile" | "portal";
export type RoundScoreExecutionInput = RoundScoreInput & {
  source: RoundScoreSource;
};

export type RoundScoreReceipt = Readonly<{
  participantId: string;
  roundId: string;
  groupId: string;
  version: number;
  revisionId: string;
  grossScore: string | null;
  netScore: string | null;
  golfPoints: string | null;
  manualMerit: string | null;
  plusMinus: string | null;
  rankingValue: string | null;
  changedAt: string;
}>;

export type RoundScoreCapabilities = Readonly<{
  golfPoints: true;
  grossScore: boolean;
  netScore: boolean;
}>;

export type LiveRoundScoreParticipant = Readonly<{
  roundId: string;
  groupId: string;
  format: "individual_net" | "individual_gross";
  scheduledAt: string | null;
  groupTimeZone: string;
  roundVersion: number;
  participantId: string;
  participantKind: "member" | "guest";
  membershipId: string | null;
  sponsorMembershipId: string | null;
  firstName: string | null;
  lastName: string | null;
  rsvpStatus: "no_response" | "playing" | "not_playing";
  participantVersion: number;
  quotaSnapshot: string | null;
  handicapSnapshot: string | null;
  teeSnapshot: "pro" | "back" | "middle" | "front" | null;
  enabledFields: RoundScoreCapabilities;
  score: RoundScoreCurrentState;
  canEdit: boolean;
  canAuthorManualMerit: boolean;
}>;

export type RoundScoreDependencies = Readonly<{
  source: RoundScoreSource;
  execute: (
    actorUserId: string,
    input: RoundScoreExecutionInput,
    correlationId: string,
  ) => Promise<RoundScoreReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runRoundScoreMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundScoreDependencies,
): Promise<MutationResult<RoundScoreReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: (actorUserId, input, correlationId) =>
      dependencies.execute(
        actorUserId,
        { ...input, source: dependencies.source },
        correlationId,
      ),
    inputSchema: roundScoreInputSchema,
    verifySession: dependencies.verifySession,
  });
}
