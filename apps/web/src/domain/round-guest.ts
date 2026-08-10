import { z } from "zod";

import type { VerifiedMutationSession } from "../lib/auth/verify-mutation-session";
import { runVerifiedMutation } from "../lib/mutations/run-verified-mutation";
import type { MutationResult } from "../lib/mutations/result";

const numericInput = z.union([
  z.number().finite(),
  z.string().regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/u),
]);

const quotaInput = numericInput
  .transform((value) => Number(value))
  .refine(
    (value) => value >= 0 && value <= 100 && Number.isInteger(value * 100),
  );

const handicapInput = numericInput
  .transform((value) => Number(value))
  .refine(
    (value) => value >= -10 && value <= 54 && Number.isInteger(value * 10),
  );

const guestName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !/\s{2,}/u.test(value));

export const createRoundGuestInputSchema = z
  .object({
    roundId: z.uuid(),
    sponsorMembershipId: z.uuid().nullable().optional(),
    firstName: guestName,
    lastName: guestName,
    quotaSnapshot: quotaInput.nullable(),
    handicapSnapshot: handicapInput.nullable(),
    teeSnapshot: z.enum(["pro", "back", "middle", "front"]).nullable(),
    operationId: z.uuid(),
  })
  .strict();

export type CreateRoundGuestInput = z.infer<typeof createRoundGuestInputSchema>;
export type CreateRoundGuestSource = "mobile" | "portal";
export type CreateRoundGuestExecutionInput = CreateRoundGuestInput & {
  source: CreateRoundGuestSource;
};

export const updateRoundGuestInputSchema = z
  .object({
    participantId: z.uuid(),
    firstName: guestName,
    lastName: guestName,
    quotaSnapshot: quotaInput.nullable(),
    handicapSnapshot: handicapInput.nullable(),
    teeSnapshot: z.enum(["pro", "back", "middle", "front"]).nullable(),
    expectedParticipantVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500).nullable().optional(),
    operationId: z.uuid(),
  })
  .strict();

export type UpdateRoundGuestInput = z.infer<typeof updateRoundGuestInputSchema>;
export type UpdateRoundGuestSource = "mobile" | "portal";
export type UpdateRoundGuestExecutionInput = UpdateRoundGuestInput & {
  source: UpdateRoundGuestSource;
};

export const withdrawRoundGuestInputSchema = z
  .object({
    roundId: z.uuid(),
    participantId: z.uuid(),
    expectedParticipantVersion: z.number().int().positive(),
    confirmed: z.literal(true),
    reason: z.string().trim().min(1).max(500),
    operationId: z.uuid(),
  })
  .strict();

export type WithdrawRoundGuestInput = z.infer<
  typeof withdrawRoundGuestInputSchema
>;
export type WithdrawRoundGuestSource = "mobile" | "portal";
export type WithdrawRoundGuestExecutionInput = WithdrawRoundGuestInput & {
  source: WithdrawRoundGuestSource;
};

export type RoundGuestReceipt = Readonly<{
  roundId: string;
  groupId: string;
  participantId: string;
  participantKind: "guest";
  membershipId: null;
  sponsorMembershipId: string;
  firstName: string;
  lastName: string;
  rsvpStatus: "playing" | "not_playing";
  version: number;
  quotaSnapshot: string | null;
  quotaSnapshotSource: Record<string, unknown> | null;
  handicapSnapshot: string | null;
  handicapSnapshotSource: "manual" | "import" | null;
  handicapSnapshotAsOf: string | null;
  teeSnapshot: string | null;
  duplicateLike: boolean;
  changedAt: string;
}>;

export type WithdrawRoundGuestReceipt = Pick<
  RoundGuestReceipt,
  | "roundId"
  | "groupId"
  | "participantId"
  | "participantKind"
  | "membershipId"
  | "sponsorMembershipId"
  | "rsvpStatus"
  | "version"
  | "changedAt"
> &
  Readonly<{ scoreInvalidated: boolean }>;

type GuestMutationDependencies<Input, Receipt> = Readonly<{
  source: "mobile" | "portal";
  execute: (
    actorUserId: string,
    input: Input,
    correlationId: string,
  ) => Promise<Receipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export function runCreateRoundGuestMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: GuestMutationDependencies<
    CreateRoundGuestExecutionInput,
    RoundGuestReceipt
  >,
): Promise<MutationResult<RoundGuestReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: (actorUserId, input, correlationId) =>
      dependencies.execute(
        actorUserId,
        { ...input, source: dependencies.source },
        correlationId,
      ),
    inputSchema: createRoundGuestInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export function runUpdateRoundGuestMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: GuestMutationDependencies<
    UpdateRoundGuestExecutionInput,
    RoundGuestReceipt
  >,
): Promise<MutationResult<RoundGuestReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: (actorUserId, input, correlationId) =>
      dependencies.execute(
        actorUserId,
        { ...input, source: dependencies.source },
        correlationId,
      ),
    inputSchema: updateRoundGuestInputSchema,
    verifySession: dependencies.verifySession,
  });
}

export function runWithdrawRoundGuestMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: GuestMutationDependencies<
    WithdrawRoundGuestExecutionInput,
    WithdrawRoundGuestReceipt
  >,
): Promise<MutationResult<WithdrawRoundGuestReceipt>> {
  return runVerifiedMutation(rawInput, correlationCandidate, {
    execute: (actorUserId, input, correlationId) =>
      dependencies.execute(
        actorUserId,
        { ...input, source: dependencies.source },
        correlationId,
      ),
    inputSchema: withdrawRoundGuestInputSchema,
    verifySession: dependencies.verifySession,
  });
}
