import { resolveCorrelationId } from "../mutations/correlation";
import {
  MutationError,
  mutationFailure,
  type MutationResult,
} from "../mutations/result";
import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import {
  roundPublicationInputSchema,
  roundPublicationPreviewInputSchema,
  type RoundPublicationInput,
  type RoundPublicationPreviewInput,
  type RoundPublicationReceipt,
  type RoundPublicationReview,
} from "../../domain/round-publication";

export type RoundPublicationPreviewDependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: RoundPublicationPreviewInput,
  ) => Promise<RoundPublicationReview>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

export type RoundPublicationMutationDependencies = Readonly<{
  execute: (
    actorUserId: string,
    input: RoundPublicationInput,
    correlationId: string,
  ) => Promise<RoundPublicationReceipt>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

/**
 * Preview is a protected read, but it still uses the same auth-before-parse
 * boundary and correlation-safe error envelope as other server actions.
 */
export async function runRoundPublicationPreview(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundPublicationPreviewDependencies,
): Promise<MutationResult<RoundPublicationReview>> {
  const correlationId = resolveCorrelationId(correlationCandidate);
  try {
    const session = await dependencies.verifySession();
    const parsedInput = roundPublicationPreviewInputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
      throw new MutationError("validation", {
        fieldErrors: fieldErrors(parsedInput.error.issues),
      });
    }
    const data = await dependencies.execute(session.userId, parsedInput.data);
    return { ok: true, data, correlationId };
  } catch (error) {
    return mutationFailure(error, correlationId);
  }
}

export async function runRoundPublicationMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: RoundPublicationMutationDependencies,
): Promise<MutationResult<RoundPublicationReceipt>> {
  const correlationId = resolveCorrelationId(correlationCandidate);
  try {
    const session = await dependencies.verifySession();
    const parsedInput = roundPublicationInputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
      throw new MutationError("validation", {
        fieldErrors: fieldErrors(parsedInput.error.issues),
      });
    }
    const data = await dependencies.execute(
      session.userId,
      parsedInput.data,
      correlationId,
    );
    return { ok: true, data, correlationId };
  } catch (error) {
    return mutationFailure(error, correlationId);
  }
}

function fieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
) {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string") (errors[field] ??= []).push(issue.message);
  }
  return errors;
}
