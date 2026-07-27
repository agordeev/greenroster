import { z } from "zod";

import { resolveCorrelationId } from "../mutations/correlation";
import type { PasswordRecoveryState } from "./password-recovery-state";

const accountEmailSchema = z
  .string()
  .trim()
  .max(320)
  .pipe(z.email())
  .transform((email) => email.toLowerCase());

const requestSchema = z
  .object({
    confirmed: z.literal(true),
    email: accountEmailSchema,
  })
  .strict();

export type AccountEmailApiCode =
  | "authentication_required"
  | "forbidden"
  | "rate_limited"
  | "unavailable"
  | "validation";

export type VerifiedAccountEmailSession = Readonly<{
  accessToken: string;
  currentEmail: string;
  sessionId: string;
  userId: string;
}>;

export type AccountEmailApiResult =
  | Readonly<{
      correlationId: string;
      ok: true;
      status: "pending";
    }>
  | Readonly<{
      code: AccountEmailApiCode;
      correlationId: string;
      fieldErrors?: Readonly<Record<string, readonly string[]>>;
      ok: false;
    }>;

export type AccountEmailApiDependencies = Readonly<{
  requestProviderUpdate: (
    input: Readonly<{
      accessToken: string;
      email: string;
    }>,
  ) => Promise<Readonly<{ status: number }>>;
  resolveRecoveryState: (
    sessionId: string,
    userId: string,
  ) => Promise<PasswordRecoveryState>;
  verifyAccessToken: (
    authorization: string | null,
  ) => Promise<
    | Readonly<{ kind: "verified"; session: VerifiedAccountEmailSession }>
    | Readonly<{ kind: "authentication_required" }>
    | Readonly<{ kind: "unavailable" }>
  >;
}>;

function response(
  correlationId: string,
  status: number,
  body:
    | Readonly<{ ok: true; status: "pending" }>
    | Readonly<{
        code: AccountEmailApiCode;
        fieldErrors?: Readonly<Record<string, readonly string[]>>;
        ok: false;
      }>,
): Response {
  return Response.json(
    { ...body, correlationId },
    { headers: { "Cache-Control": "no-store" }, status },
  );
}

function failure(
  correlationId: string,
  code: AccountEmailApiCode,
  status: number,
  fieldErrors?: Readonly<Record<string, readonly string[]>>,
): Response {
  return response(correlationId, status, {
    code,
    ...(fieldErrors ? { fieldErrors } : {}),
    ok: false,
  });
}

function validationFieldErrors(
  issues: readonly Readonly<{ path: PropertyKey[]; message: string }>[],
) {
  const result: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string") (result[field] ??= []).push(issue.message);
  }
  return result;
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function handleAccountEmailRequest(
  request: Request,
  dependencies: AccountEmailApiDependencies,
): Promise<Response> {
  const correlationId = resolveCorrelationId(
    request.headers.get("x-correlation-id"),
  );

  let verified:
    | Readonly<{ kind: "verified"; session: VerifiedAccountEmailSession }>
    | Readonly<{ kind: "authentication_required" }>
    | Readonly<{ kind: "unavailable" }>;
  try {
    verified = await dependencies.verifyAccessToken(
      request.headers.get("authorization"),
    );
  } catch {
    return failure(correlationId, "unavailable", 503);
  }

  if (verified.kind === "authentication_required") {
    return failure(correlationId, "authentication_required", 401);
  }
  if (verified.kind === "unavailable") {
    return failure(correlationId, "unavailable", 503);
  }

  let recoveryState: PasswordRecoveryState;
  try {
    recoveryState = await dependencies.resolveRecoveryState(
      verified.session.sessionId,
      verified.session.userId,
    );
  } catch {
    return failure(correlationId, "unavailable", 503);
  }
  if (recoveryState === "unavailable") {
    return failure(correlationId, "unavailable", 503);
  }
  if (recoveryState !== "none") {
    return failure(correlationId, "forbidden", 403);
  }

  const parsed = requestSchema.safeParse(await parseJson(request));
  if (!parsed.success) {
    return failure(
      correlationId,
      "validation",
      400,
      validationFieldErrors(parsed.error.issues),
    );
  }
  const parsedCurrent = accountEmailSchema.safeParse(
    verified.session.currentEmail,
  );
  if (!parsedCurrent.success) {
    return failure(correlationId, "authentication_required", 401);
  }
  if (parsed.data.email === parsedCurrent.data) {
    return failure(correlationId, "validation", 400, {
      email: ["Enter a different account e-mail."],
    });
  }

  let provider: Readonly<{ status: number }>;
  try {
    provider = await dependencies.requestProviderUpdate({
      accessToken: verified.session.accessToken,
      email: parsed.data.email,
    });
  } catch {
    return failure(correlationId, "unavailable", 503);
  }

  if (provider.status === 429) {
    return failure(correlationId, "rate_limited", 429);
  }
  if (provider.status === 401) {
    return failure(correlationId, "authentication_required", 401);
  }
  if (provider.status >= 500) {
    return failure(correlationId, "unavailable", 503);
  }
  // Provider 403 responses deny the requested address operation rather than
  // proving this session came from GreenRoster's recovery registry. Keep them
  // in the neutral validation bucket instead of showing recovery-only copy.
  if (provider.status === 403) {
    return failure(correlationId, "validation", 400);
  }
  if (provider.status < 200 || provider.status >= 300) {
    return failure(correlationId, "validation", 400);
  }

  return response(correlationId, 200, { ok: true, status: "pending" });
}
