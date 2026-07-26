import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { resolveCorrelationId } from "./correlation";
import {
  MutationError,
  mutationFailure,
  type MutationFieldErrors,
  type MutationResult,
} from "./result";

export type VerifiedMutationDependencies<TInput, TResult> = Readonly<{
  execute: (
    actorUserId: string,
    input: TInput,
    correlationId: string,
  ) => Promise<TResult>;
  inputSchema: z.ZodType<TInput>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

function fieldErrors(error: z.ZodError): MutationFieldErrors {
  const errors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") {
      (errors[field] ??= []).push(issue.message);
    }
  }

  return errors;
}

/**
 * Shared request boundary for protected mutations.
 *
 * Authentication and safe input parsing happen here. The supplied database
 * transaction must then re-resolve tenant/role, authorize the target, check
 * version and idempotency, execute, and commit audit/outbox state atomically.
 */
export async function runVerifiedMutation<TInput, TResult>(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: VerifiedMutationDependencies<TInput, TResult>,
): Promise<MutationResult<TResult>> {
  const correlationId = resolveCorrelationId(correlationCandidate);

  try {
    // Authenticate before parsing attacker-controlled input so expired sessions
    // receive one neutral response and never reach a protected mutation.
    const session = await dependencies.verifySession();
    const parsedInput = dependencies.inputSchema.safeParse(rawInput);

    if (!parsedInput.success) {
      throw new MutationError("validation", {
        fieldErrors: fieldErrors(parsedInput.error),
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
