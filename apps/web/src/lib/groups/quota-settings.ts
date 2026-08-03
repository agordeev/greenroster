import { z } from "zod";

import {
  validateAdjustmentBands,
  type QuotaAdjustmentBand,
  type QuotaMethod,
  type PlacementMeritRow,
  validateParticipationMerit,
  validatePlacementMeritRows,
  validateStandingsResetDate,
} from "../../domain/quota-rules";
import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { runVerifiedMutation } from "../mutations/run-verified-mutation";
import type { MutationResult } from "../mutations/result";

const quotaPrecisionSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
]);

const quotaBandSchema = z
  .object({
    adjustment: z.string().trim().min(1),
    lowerBound: z.string().trim().min(1),
    lowerInclusive: z.boolean(),
    upperBound: z.string().trim().min(1),
    upperInclusive: z.boolean(),
  })
  .strict();

const sharedQuotaSettingsFields = {
  expectedSettingsVersion: z.number().int().nonnegative(),
  operationId: z.uuid(),
  precision: quotaPrecisionSchema,
  reason: z.string().trim().min(1).max(500),
  roundingRule: z.literal("half_away_from_zero"),
  participationMerit: z
    .string()
    .trim()
    .refine((value) => {
      try {
        validateParticipationMerit(value);
        return true;
      } catch {
        return false;
      }
    }, "Participation merit must be between 0 and 100 with at most two decimals."),
  placementMerit: z
    .array(
      z
        .object({
          rank: z.number().int().positive(),
          points: z.string().trim().min(1),
        })
        .strict(),
    )
    .superRefine((rows, context) => {
      try {
        validatePlacementMeritRows(rows);
      } catch (error) {
        context.addIssue({
          code: "custom",
          message:
            error instanceof Error
              ? error.message
              : "Review the ordered placement merit rows.",
          path: ["placementMerit"],
        });
      }
    }),
  standingsResetDate: z
    .string()
    .trim()
    .nullable()
    .refine((value) => {
      try {
        validateStandingsResetDate(value);
        return true;
      } catch {
        return false;
      }
    }, "Standings reset date must be a valid group-local date.")
    .transform((value) => (value === "" ? null : value)),
};

const emptyBandsSchema = z.array(z.never()).length(0);

const movingAverageInputSchema = z
  .object({
    ...sharedQuotaSettingsFields,
    bands: emptyBandsSchema,
    historyLength: z.number().int().min(4).max(20),
    method: z.literal("moving_average"),
  })
  .strict();

const bestOfTwentyInputSchema = z
  .object({
    ...sharedQuotaSettingsFields,
    bands: emptyBandsSchema,
    historyLength: z.null(),
    method: z.literal("best_10_of_20"),
  })
  .strict();

const methodCInputSchema = z
  .object({
    ...sharedQuotaSettingsFields,
    bands: z.array(quotaBandSchema).min(1),
    historyLength: z.null(),
    method: z.literal("previous_plus_minus"),
  })
  .strict()
  .superRefine((input, context) => {
    try {
      validateAdjustmentBands(input.bands);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "Review the complete Method C adjustment bands.",
        path: ["bands"],
      });
    }
  });

const quotaSettingsInputSchema = z.discriminatedUnion("method", [
  movingAverageInputSchema,
  bestOfTwentyInputSchema,
  methodCInputSchema,
]);

export type QuotaSettingsInput = z.infer<typeof quotaSettingsInputSchema>;

export type QuotaSettingsResult = Readonly<{
  groupId: string;
  historyLength: number | null;
  method: QuotaMethod;
  precision: 0 | 1 | 2;
  roundingRule: "half_away_from_zero";
  participationMerit: string;
  placementMerit: readonly PlacementMeritRow[];
  standingsResetDate: string | null;
  settingsVersion: number;
}>;

export type QuotaSettingsDependencies = Readonly<{
  executeConfigure: (
    actorUserId: string,
    input: QuotaSettingsInput,
    correlationId: string,
  ) => Promise<QuotaSettingsResult>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runQuotaSettingsMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: QuotaSettingsDependencies,
): Promise<MutationResult<QuotaSettingsResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.executeConfigure,
    inputSchema: quotaSettingsInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export type { QuotaAdjustmentBand };
