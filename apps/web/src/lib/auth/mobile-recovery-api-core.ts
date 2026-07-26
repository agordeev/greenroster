import type { Session } from "@supabase/supabase-js";
import { z } from "zod";

import { passwordResetSchema, recoverySchema } from "./auth-validation";
import type {
  PasswordRecoveryClaim,
  PasswordRecoveryHandleResolution,
} from "./password-recovery-registry";
import type { VerifiedMobileRecoverySession } from "./mobile-recovery-session";
import { resolveCorrelationId } from "../mutations/correlation";

type RecoveryApiCode =
  | "authentication_required"
  | "expired"
  | "rate_limited"
  | "unavailable"
  | "validation";
type RecoveryApiState = "active" | "complete" | "requested";

const recoveryExchangeSchema = z.object({
  code: z.string().trim().min(1),
  recoveryState: z.uuid(),
});

export type MobileRecoveryApiDependencies = Readonly<{
  claim(sessionId: string, userId: string): Promise<PasswordRecoveryClaim>;
  consume(
    sessionId: string,
    userId: string,
    claimId: string,
    correlationId: string,
  ): Promise<boolean>;
  createHandle(): string;
  createIntent(
    stateHash: string,
    emailHash: string,
    codeVerifier: string,
    expiresAt: Date,
  ): Promise<boolean>;
  createOperationId(): string;
  createState(): string;
  exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<
    | Readonly<{ ok: true; session: Session }>
    | Readonly<{
        ok: false;
        reason: "invalid" | "rate_limited" | "unavailable";
      }>
  >;
  hash(value: string): string;
  now(): Date;
  registerProof(
    stateHash: string,
    emailHash: string,
    handleHash: string,
    operationId: string,
    sessionId: string,
    userId: string,
    expiresAt: Date,
  ): Promise<boolean>;
  release(sessionId: string, userId: string, claimId: string): Promise<void>;
  resolveHandle(handleHash: string): Promise<PasswordRecoveryHandleResolution>;
  resolveIntent(stateHash: string): Promise<
    | Readonly<{
        intent: Readonly<{ codeVerifier: string; emailHash: string }> | null;
        ok: true;
      }>
    | Readonly<{ ok: false }>
  >;
  sendRecovery(
    email: string,
    redirectTo: string,
  ): Promise<{
    codeVerifier: string | null;
    error: { retryable: boolean; status?: number } | null;
  }>;
  updatePassword(
    userId: string,
    password: string,
  ): Promise<{ error: Readonly<{ status?: number }> | null }>;
  verify(
    authorization: string | null,
  ): Promise<VerifiedMobileRecoverySession | null>;
}>;

function response(
  correlationId: string,
  status: number,
  body:
    | Readonly<{
        ok: true;
        recoveryHandle?: string;
        state: RecoveryApiState;
      }>
    | Readonly<{
        code: RecoveryApiCode;
        fieldErrors?: Readonly<Record<string, readonly string[]>>;
        ok: false;
      }>,
) {
  return Response.json(
    { ...body, correlationId },
    { headers: { "Cache-Control": "no-store" }, status },
  );
}

function failure(
  correlationId: string,
  code: RecoveryApiCode,
  status: number,
  fieldErrors?: Readonly<Record<string, readonly string[]>>,
) {
  return response(correlationId, status, {
    code,
    ...(fieldErrors ? { fieldErrors } : {}),
    ok: false,
  });
}

function correlationId(request: Request) {
  return resolveCorrelationId(request.headers.get("x-correlation-id"));
}

function recoveryHandle(authorization: string | null) {
  return (
    authorization?.match(/^Recovery ([A-Za-z0-9_-]{43,128})$/)?.[1] ?? null
  );
}

async function jsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function fieldErrors(
  issues: readonly Readonly<{ path: PropertyKey[]; message: string }>[],
) {
  const result: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string") (result[field] ??= []).push(issue.message);
  }
  return result;
}

async function resolveRequestHandle(
  request: Request,
  dependencies: MobileRecoveryApiDependencies,
) {
  const handle = recoveryHandle(request.headers.get("authorization"));
  if (!handle) return { kind: "unauthenticated" as const };
  const resolved = await dependencies.resolveHandle(dependencies.hash(handle));
  if (!resolved.ok) return { kind: "unavailable" as const };
  if (!resolved.handle) return { kind: "unauthenticated" as const };
  return { handle: resolved.handle, kind: "resolved" as const };
}

export async function requestMobileRecoveryWithDependencies(
  request: Request,
  dependencies: MobileRecoveryApiDependencies,
) {
  const id = correlationId(request);
  const parsed = recoverySchema.safeParse(await jsonBody(request));
  if (!parsed.success) {
    return failure(id, "validation", 400, fieldErrors(parsed.error.issues));
  }

  const state = dependencies.createState();
  const redirectTo = `greenroster://auth/callback?recovery_state=${encodeURIComponent(state)}`;
  const { codeVerifier, error } = await dependencies.sendRecovery(
    parsed.data.email,
    redirectTo,
  );
  if (error?.status === 429) return failure(id, "rate_limited", 429);
  if (
    error?.retryable ||
    (error?.status !== undefined && error.status >= 500)
  ) {
    return failure(id, "unavailable", 503);
  }
  if (error) return response(id, 200, { ok: true, state: "requested" });
  if (!codeVerifier) return failure(id, "unavailable", 503);

  const expiresAt = new Date(dependencies.now().getTime() + 15 * 60 * 1000);
  const stored = await dependencies.createIntent(
    dependencies.hash(state),
    dependencies.hash(parsed.data.email),
    codeVerifier,
    expiresAt,
  );
  return stored
    ? response(id, 200, { ok: true, state: "requested" })
    : failure(id, "unavailable", 503);
}

export async function exchangeMobileRecoveryCodeWithDependencies(
  request: Request,
  dependencies: MobileRecoveryApiDependencies,
) {
  const id = correlationId(request);
  const exchange = recoveryExchangeSchema.safeParse(await jsonBody(request));
  if (!exchange.success) return failure(id, "validation", 400);

  const stateHash = dependencies.hash(exchange.data.recoveryState);
  const resolvedIntent = await dependencies.resolveIntent(stateHash);
  if (!resolvedIntent.ok) return failure(id, "unavailable", 503);
  if (!resolvedIntent.intent) return failure(id, "expired", 409);
  const intent = resolvedIntent.intent;
  const exchanged = await dependencies.exchangeCode(
    exchange.data.code,
    intent.codeVerifier,
  );
  if (!exchanged.ok) {
    if (exchanged.reason === "rate_limited") {
      return failure(id, "rate_limited", 429);
    }
    return failure(
      id,
      exchanged.reason === "unavailable" ? "unavailable" : "expired",
      exchanged.reason === "unavailable" ? 503 : 409,
    );
  }

  const verified = await dependencies.verify(
    `Bearer ${exchanged.session.access_token}`,
  );
  if (!verified || dependencies.hash(verified.email) !== intent.emailHash) {
    return failure(id, "expired", 409);
  }

  const handle = dependencies.createHandle();
  const handleHash = dependencies.hash(handle);
  const operationId = dependencies.createOperationId();
  const registered = await dependencies.registerProof(
    stateHash,
    intent.emailHash,
    handleHash,
    operationId,
    verified.sessionId,
    verified.userId,
    verified.expiresAt,
  );
  if (!registered) {
    const reconciled = await dependencies.resolveHandle(handleHash);
    if (!reconciled.ok || !reconciled.handle) {
      // The Auth code is already single-use; the caller must request a new link.
      return failure(id, "expired", 409);
    }
  }

  return response(id, 200, {
    ok: true,
    recoveryHandle: handle,
    state: "active",
  });
}

export async function resolveMobileRecoveryStatusWithDependencies(
  request: Request,
  dependencies: MobileRecoveryApiDependencies,
) {
  const id = correlationId(request);
  const resolved = await resolveRequestHandle(request, dependencies);
  if (resolved.kind === "unauthenticated") {
    return failure(id, "authentication_required", 401);
  }
  if (resolved.kind === "unavailable") return failure(id, "unavailable", 503);
  if (resolved.handle.state === "consumed") {
    return response(id, 200, { ok: true, state: "complete" });
  }
  return resolved.handle.state === "active" ||
    resolved.handle.state === "claimed"
    ? response(id, 200, { ok: true, state: "active" })
    : failure(id, "expired", 409);
}

export async function resetMobileRecoveryPasswordWithDependencies(
  request: Request,
  dependencies: MobileRecoveryApiDependencies,
) {
  const id = correlationId(request);
  const parsed = passwordResetSchema.safeParse(await jsonBody(request));
  if (!parsed.success) {
    return failure(id, "validation", 400, fieldErrors(parsed.error.issues));
  }
  const resolved = await resolveRequestHandle(request, dependencies);
  if (resolved.kind === "unauthenticated") {
    return failure(id, "authentication_required", 401);
  }
  if (resolved.kind === "unavailable") return failure(id, "unavailable", 503);
  const recovery = resolved.handle;
  const operationCorrelationId = recovery.operationId;
  if (recovery.state === "consumed") {
    return response(operationCorrelationId, 200, {
      ok: true,
      state: "complete",
    });
  }
  if (recovery.state !== "active" && recovery.state !== "claimed") {
    return failure(operationCorrelationId, "expired", 409);
  }

  let claimId = recovery.claimId;
  if (!claimId) {
    const claim = await dependencies.claim(recovery.sessionId, recovery.userId);
    if (!claim.ok) {
      return failure(
        operationCorrelationId,
        claim.reason === "unavailable" ? "unavailable" : "expired",
        claim.reason === "unavailable" ? 503 : 409,
      );
    }
    claimId = claim.claimId;
  }

  try {
    const { error } = await dependencies.updatePassword(
      recovery.userId,
      parsed.data.password,
    );
    if (error) {
      await dependencies.release(recovery.sessionId, recovery.userId, claimId);
      return failure(
        operationCorrelationId,
        error.status === 429 ? "rate_limited" : "unavailable",
        error.status === 429 ? 429 : 503,
      );
    }
  } catch {
    await dependencies.release(recovery.sessionId, recovery.userId, claimId);
    return failure(operationCorrelationId, "unavailable", 503);
  }

  const consumed = await dependencies.consume(
    recovery.sessionId,
    recovery.userId,
    claimId,
    recovery.operationId,
  );
  if (consumed) {
    return response(operationCorrelationId, 200, {
      ok: true,
      state: "complete",
    });
  }

  const reconciled = await dependencies.resolveHandle(
    dependencies.hash(recoveryHandle(request.headers.get("authorization"))!),
  );
  return reconciled.ok && reconciled.handle?.state === "consumed"
    ? response(operationCorrelationId, 200, {
        ok: true,
        state: "complete",
      })
    : failure(operationCorrelationId, "unavailable", 503);
}
