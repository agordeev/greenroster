import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Session } from "@supabase/supabase-js";

import {
  exchangeMobileRecoveryCodeWithDependencies,
  requestMobileRecoveryWithDependencies,
  resetMobileRecoveryPasswordWithDependencies,
  resolveMobileRecoveryStatusWithDependencies,
  type MobileRecoveryApiDependencies,
} from "@/lib/auth/mobile-recovery-api-core";
import {
  claimPasswordRecoverySession,
  consumePasswordRecoverySession,
  createPasswordRecoveryIntent,
  registerMobilePasswordRecoverySession,
  releasePasswordRecoveryClaim,
  resolvePasswordRecoveryHandle,
  resolvePasswordRecoveryIntent,
} from "@/lib/auth/password-recovery-registry";
import { verifyMobileRecoverySession } from "@/lib/auth/mobile-recovery-session";
import { webRuntimeEnv } from "@/lib/runtime-env";
import { createSupabaseServiceClient } from "@/lib/supabase/service-client";

function authHeaders() {
  return {
    apikey: webRuntimeEnv.supabasePublishableKey,
    authorization: `Bearer ${webRuntimeEnv.supabasePublishableKey}`,
    "content-type": "application/json",
  };
}

const dependencies: MobileRecoveryApiDependencies = {
  claim: claimPasswordRecoverySession,
  consume: consumePasswordRecoverySession,
  createHandle: () => randomBytes(32).toString("base64url"),
  createIntent: createPasswordRecoveryIntent,
  createOperationId: randomUUID,
  createState: randomUUID,
  async exchangeCode(code, codeVerifier) {
    try {
      const response = await fetch(
        `${webRuntimeEnv.supabaseUrl}/auth/v1/token?grant_type=pkce`,
        {
          body: JSON.stringify({
            auth_code: code,
            code_verifier: codeVerifier,
          }),
          headers: authHeaders(),
          method: "POST",
        },
      );
      if (!response.ok) {
        return {
          ok: false as const,
          reason:
            response.status === 429
              ? ("rate_limited" as const)
              : response.status >= 500
                ? ("unavailable" as const)
                : ("invalid" as const),
        };
      }
      const value: unknown = await response.json();
      if (
        !value ||
        typeof value !== "object" ||
        !("access_token" in value) ||
        typeof value.access_token !== "string" ||
        !("refresh_token" in value) ||
        typeof value.refresh_token !== "string"
      ) {
        return { ok: false as const, reason: "unavailable" as const };
      }
      return { ok: true as const, session: value as Session };
    } catch {
      return { ok: false as const, reason: "unavailable" as const };
    }
  },
  hash(value) {
    return createHash("sha256").update(value).digest("hex");
  },
  now: () => new Date(),
  registerProof: registerMobilePasswordRecoverySession,
  release: releasePasswordRecoveryClaim,
  resolveHandle: resolvePasswordRecoveryHandle,
  resolveIntent: resolvePasswordRecoveryIntent,
  async sendRecovery(email, redirectTo) {
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    try {
      const url = new URL(`${webRuntimeEnv.supabaseUrl}/auth/v1/recover`);
      url.searchParams.set("redirect_to", redirectTo);
      const response = await fetch(url, {
        body: JSON.stringify({
          code_challenge: codeChallenge,
          code_challenge_method: "s256",
          email,
          gotrue_meta_security: {},
        }),
        headers: authHeaders(),
        method: "POST",
      });
      return {
        codeVerifier: response.ok ? codeVerifier : null,
        error: response.ok
          ? null
          : { retryable: response.status >= 500, status: response.status },
      };
    } catch {
      return { codeVerifier: null, error: { retryable: true } };
    }
  },
  async updatePassword(userId, password) {
    const { error } =
      await createSupabaseServiceClient().auth.admin.updateUserById(userId, {
        password,
      });
    return { error };
  },
  verify: verifyMobileRecoverySession,
};

export const exchangeMobileRecoveryCode = (request: Request) =>
  exchangeMobileRecoveryCodeWithDependencies(request, dependencies);
export const requestMobileRecovery = (request: Request) =>
  requestMobileRecoveryWithDependencies(request, dependencies);
export const resetMobileRecoveryPassword = (request: Request) =>
  resetMobileRecoveryPasswordWithDependencies(request, dependencies);
export const resolveMobileRecoveryStatus = (request: Request) =>
  resolveMobileRecoveryStatusWithDependencies(request, dependencies);
