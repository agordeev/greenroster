export const mutationErrorCodes = [
  "authentication_required",
  "forbidden",
  "unavailable",
  "validation",
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
      }>;
    }>;

const safeMessages: Readonly<Record<MutationErrorCode, string>> = {
  authentication_required: "Your session has expired. Sign in and try again.",
  forbidden:
    "Your access changed or you do not have permission for this action.",
  unavailable: "The requested resource is unavailable.",
  validation: "Review the highlighted fields and try again.",
  stale_version: "This information changed. Refresh it before trying again.",
  locked: "This action is not available in the resource's current state.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  transient: "The service is temporarily unavailable. Try again.",
  unexpected: "Something went wrong.",
};

export class MutationError extends Error {
  readonly code: MutationErrorCode;
  readonly fieldErrors?: MutationFieldErrors;

  constructor(
    code: MutationErrorCode,
    options?: Readonly<{
      cause?: unknown;
      fieldErrors?: MutationFieldErrors;
    }>,
  ) {
    super(safeMessages[code], { cause: options?.cause });
    this.name = "MutationError";
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
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
      ? `${baseMessage} Contact support with reference ${correlationId}.`
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
    },
  };
}
