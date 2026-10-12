export const mutationErrorCodes = [
  "authentication_required",
  "forbidden",
  "unavailable",
  "validation",
  "operation_reused",
  "stale_version",
  "locked",
  "rate_limited",
  "transient",
  "unexpected",
] as const;

export type MutationErrorCode = (typeof mutationErrorCodes)[number];
export type MutationFieldErrors = Readonly<Record<string, readonly string[]>>;

export type MutationResult<T> =
  | Readonly<{
      ok: true;
      data: T;
      correlationId: string;
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: MutationErrorCode;
        message: string;
        correlationId: string;
        fieldErrors?: MutationFieldErrors;
        details?: unknown;
      }>;
    }>;

const safeMessages: Readonly<Record<MutationErrorCode, string>> = {
  authentication_required: "You've been signed out. Sign in again to continue.",
  forbidden: "You don't have permission to do this.",
  unavailable: "We couldn't find that. Refresh the page to see what's current.",
  validation: "Check the highlighted fields and try again.",
  operation_reused:
    "This change was already submitted with different details. Refresh the page and try again.",
  stale_version:
    "This has changed since you opened it. Refresh the page to see the latest, then try again.",
  locked: "You can't change this right now.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  transient: "We couldn't save your changes. Try again.",
  unexpected: "We couldn't save your changes.",
};

export class MutationError extends Error {
  readonly code: MutationErrorCode;
  readonly fieldErrors?: MutationFieldErrors;
  readonly details?: unknown;

  constructor(
    code: MutationErrorCode,
    options?: Readonly<{
      cause?: unknown;
      fieldErrors?: MutationFieldErrors;
      details?: unknown;
    }>,
  ) {
    super(safeMessages[code], { cause: options?.cause });
    this.name = "MutationError";
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
    this.details = options?.details;
  }
}

export function mutationFailure(
  error: unknown,
  correlationId: string,
): MutationResult<never> {
  const mutationError =
    error instanceof MutationError
      ? error
      : new MutationError("unexpected", { cause: error });
  const baseMessage = safeMessages[mutationError.code];
  const message =
    mutationError.code === "unexpected"
      ? `${baseMessage} Try again, or contact support with reference ${correlationId}.`
      : baseMessage;

  return {
    ok: false,
    error: {
      code: mutationError.code,
      message,
      correlationId,
      ...(mutationError.fieldErrors
        ? { fieldErrors: mutationError.fieldErrors }
        : {}),
      ...(mutationError.details !== undefined
        ? { details: mutationError.details }
        : {}),
    },
  };
}
