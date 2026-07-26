import { z } from "zod";

import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import { resolveCorrelationId } from "../mutations/correlation";
import {
  MutationError,
  mutationFailure,
  type MutationFieldErrors,
  type MutationResult,
} from "../mutations/result";

const groupBootstrapInputSchema = z
  .object({
    groupName: z.string().trim().min(1),
    groupTimeZone: z.string().trim().refine(isSupportedTimeZone),
    operationId: z.uuid(),
  })
  .strict();

export type GroupBootstrapInput = z.infer<typeof groupBootstrapInputSchema>;

export type GroupBootstrapResult = Readonly<{
  groupId: string;
  administratorMembershipId: string;
}>;

export type GroupBootstrapDependencies = Readonly<{
  verifySession: () => Promise<VerifiedMutationSession>;
  executeBootstrap: (
    actorUserId: string,
    input: GroupBootstrapInput,
    correlationId: string,
  ) => Promise<GroupBootstrapResult>;
}>;

function isSupportedTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

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

export async function runGroupBootstrapMutation(
  rawInput: unknown,
  correlationCandidate: string | null | undefined,
  dependencies: GroupBootstrapDependencies,
): Promise<MutationResult<GroupBootstrapResult>> {
  const correlationId = resolveCorrelationId(correlationCandidate);

  try {
    // Authenticate before parsing attacker-controlled input so expired sessions
    // receive one neutral response and never reach a protected mutation.
    const session = await dependencies.verifySession();
    const parsedInput = groupBootstrapInputSchema.safeParse(rawInput);

    if (!parsedInput.success) {
      throw new MutationError("validation", {
        fieldErrors: fieldErrors(parsedInput.error),
      });
    }

    const data = await dependencies.executeBootstrap(
      session.userId,
      parsedInput.data,
      correlationId,
    );

    return { ok: true, data, correlationId };
  } catch (error) {
    return mutationFailure(error, correlationId);
  }
}
