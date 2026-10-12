import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { runVerifiedMutation } from "../mutations/run-verified-mutation";
import type { MutationResult } from "../mutations/result";

const memberQuotaBootstrapInputSchema = z
  .object({
    confirmed: z.literal(true, {
      error: "Confirm the starting quota change before saving.",
    }),
    expectedProjectionVersion: z.number().int().nonnegative(),
    expectedSettingsVersion: z.number().int().positive(),
    initialQuota: z.string().trim().min(1).nullable(),
    membershipId: z.uuid(),
    operationId: z.uuid(),
    reason: z.string().trim().min(1).max(500),
    seedTotals: z.array(z.string().trim().min(1)).max(20),
    useInitialQuota: z.boolean().nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.initialQuota === null && input.useInitialQuota === true) {
      context.addIssue({
        code: "custom",
        message:
          "Enter a starting quota before you select “Use this starting quota until enough history builds up.”",
        path: ["useInitialQuota"],
      });
    }
  })
  .transform((input) => ({
    ...input,
    // Supplying an initial quota defaults the bootstrap freeze on while still
    // preserving the administrator's explicit off choice.
    useInitialQuota:
      input.initialQuota === null ? false : (input.useInitialQuota ?? true),
  }));

export type MemberQuotaBootstrapInput = z.infer<
  typeof memberQuotaBootstrapInputSchema
>;

export type MemberQuotaProjectionSource = Readonly<Record<string, unknown>>;

export type MemberQuotaBootstrapContext = Readonly<{
  membershipId: string;
  groupId: string;
  initialQuota: string | null;
  usesInitialQuota: boolean;
  initialQuotaProvenance: string | null;
  seedTotals: readonly Readonly<{
    position: number;
    pointTotal: string;
  }>[];
  projectionVersion: number;
  projectionReady: boolean;
  projectedQuota: string | null;
  projectionSource: MemberQuotaProjectionSource;
  projectionEffectiveAt: string | null;
  settingsVersion: number;
  settingsMethod:
    "moving_average" | "best_10_of_20" | "previous_plus_minus" | null;
  settingsHistoryLength: number | null;
  settingsPrecision: 0 | 1 | 2 | null;
  settingsRoundingRule: "half_away_from_zero" | null;
  adjustmentBands: readonly Readonly<{
    adjustment: string;
    lowerBound: string;
    lowerInclusive: boolean;
    position: number;
    upperBound: string;
    upperInclusive: boolean;
  }>[];
}>;

export type MemberQuotaBootstrapResult = Readonly<{
  groupId: string;
  membershipId: string;
  projectionReady: boolean;
  projectedQuota: string | null;
  projectionSource: MemberQuotaProjectionSource;
  projectionVersion: number;
  settingsVersion: number;
  usesInitialQuota: boolean;
}>;

export type MemberQuotaBootstrapDependencies = Readonly<{
  executeBootstrap: (
    actorUserId: string,
    input: MemberQuotaBootstrapInput,
    correlationId: string,
  ) => Promise<MemberQuotaBootstrapResult>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export async function runMemberQuotaBootstrapMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: MemberQuotaBootstrapDependencies,
): Promise<MutationResult<MemberQuotaBootstrapResult>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: dependencies.executeBootstrap,
    inputSchema: memberQuotaBootstrapInputSchema,
    verifySession: dependencies.verifySession,
  });
}
