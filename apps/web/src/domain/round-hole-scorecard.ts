import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import type { MutationResult } from "../lib/mutations/result";

const holeFieldSchema = z
  .object({
    strokes: z.number().int().min(0).max(30).nullable().optional(),
    putts: z.number().int().min(0).max(20).nullable().optional(),
    fairway_hit: z.boolean().nullable().optional(),
    green_in_regulation: z.boolean().nullable().optional(),
    sand_save: z.boolean().nullable().optional(),
    hole_comment: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({
        code: "custom",
        message: "Enter at least one hole detail.",
      });
    }
  });

export const roundHoleScoreChangedFieldsSchema = holeFieldSchema;
export type RoundHoleScoreChangedFields = z.infer<
  typeof roundHoleScoreChangedFieldsSchema
>;

export const roundHoleScoreInputSchema = z
  .object({
    participantId: z.uuid(),
    holeNumber: z.number().int().min(1).max(18),
    changedFields: roundHoleScoreChangedFieldsSchema,
    expectedVersion: z.number().int().nonnegative(),
    deviceOperationId: z.uuid(),
    reason: z.string().trim().max(500).nullable().optional(),
    clientChangedAt: z.string().datetime({ offset: true }),
    operationId: z.uuid(),
  })
  .strict();

export type RoundHoleScoreInput = z.infer<typeof roundHoleScoreInputSchema>;

export type RoundHoleScoreRow = Readonly<{
  roundId: string;
  groupId: string;
  participantId: string;
  participantKind: "member" | "guest";
  membershipId: string | null;
  firstName: string | null;
  lastName: string | null;
  holeNumber: number;
  version: number;
  strokes: number | null;
  putts: number | null;
  fairwayHit: boolean | null;
  greenInRegulation: boolean | null;
  sandSave: boolean | null;
  holeComment: string | null;
  updatedAt: string;
  canEdit: boolean;
}>;

export type RoundHoleScoreReceipt = Readonly<
  Pick<
    RoundHoleScoreRow,
    | "roundId"
    | "groupId"
    | "participantId"
    | "holeNumber"
    | "version"
    | "strokes"
    | "putts"
    | "fairwayHit"
    | "greenInRegulation"
    | "sandSave"
    | "holeComment"
    | "updatedAt"
  > & { revisionId: string }
>;

export type RoundHoleScoreDependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: RoundHoleScoreInput,
    correlationId: string,
  ) => Promise<RoundHoleScoreReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runRoundHoleScoreMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundHoleScoreDependencies,
): Promise<MutationResult<RoundHoleScoreReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.execute,
    inputSchema: roundHoleScoreInputSchema,
    verifySession: dependencies.verifySession,
  });
}
