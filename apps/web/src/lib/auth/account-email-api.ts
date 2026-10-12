import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

import type {
  AccountEmailApiDependencies,
  VerifiedAccountEmailSession,
} from "./account-email-api-core";

function bearerToken(authorization: string | null): string | null {
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  return match?.[1] ?? null;
}

export async function verifyAccountEmailAccessToken(
  authorization: string | null,
): Promise<
  | Readonly<{ kind: "verified"; session: VerifiedAccountEmailSession }>
  | Readonly<{ kind: "authentication_required" }>
  | Readonly<{ kind: "unavailable" }>
> {
  const accessToken = bearerToken(authorization);
  if (!accessToken) return { kind: "authentication_required" };

  try {
    const [{ webRuntimeEnv }, { resolveVerifiedSessionClaims }] =
      await Promise.all([
        import("../runtime-env"),
        import("./verified-session-claims"),
      ]);
    const supabase = createClient(
      webRuntimeEnv.supabaseUrl,
      webRuntimeEnv.supabasePublishableKey,
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
    const [{ data, error }, claims] = await Promise.all([
      supabase.auth.getUser(accessToken),
      resolveVerifiedSessionClaims(supabase, accessToken),
    ]);

    if (error && isAuthRetryableFetchError(error)) {
      return { kind: "unavailable" };
    }
    if (
      error ||
      !data.user?.email ||
      !data.user.email_confirmed_at ||
      !claims ||
      claims.sub !== data.user.id
    ) {
      return { kind: "authentication_required" };
    }

    return {
      kind: "verified",
      session: {
        accessToken,
        currentEmail: data.user.email,
        sessionId: claims.session_id,
        userId: data.user.id,
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export function createAccountEmailProviderUpdater(
  config: Readonly<{
    appUrl: string;
    createCodeVerifier?: () => string;
    fetchImplementation?: typeof fetch;
    publishableKey: string;
    supabaseUrl: string;
  }>,
) {
  const fetchImplementation = config.fetchImplementation ?? fetch;
  const createCodeVerifier =
    config.createCodeVerifier ?? (() => randomBytes(32).toString("base64url"));

  return async function requestProviderUpdate(
    input: Readonly<{
      accessToken: string;
      email: string;
    }>,
  ): Promise<Readonly<{ status: number }>> {
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const url = new URL("/auth/v1/user", config.supabaseUrl);
    url.searchParams.set(
      "redirect_to",
      new URL("/account/email-change-confirmed", config.appUrl).toString(),
    );
    const response = await fetchImplementation(url, {
      body: JSON.stringify({
        code_challenge: codeChallenge,
        code_challenge_method: "s256",
        email: input.email,
      }),
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        apikey: config.publishableKey,
        "Content-Type": "application/json",
      },
      method: "PUT",
    });
    return { status: response.status };
  };
}

export async function requestAccountEmailProviderUpdate(
  input: Readonly<{
    accessToken: string;
    email: string;
  }>,
): Promise<Readonly<{ status: number }>> {
  const { webRuntimeEnv } = await import("../runtime-env");
  return createAccountEmailProviderUpdater({
    appUrl: webRuntimeEnv.appUrl,
    publishableKey: webRuntimeEnv.supabasePublishableKey,
    supabaseUrl: webRuntimeEnv.supabaseUrl,
  })(input);
}

const defaultDependencies: AccountEmailApiDependencies = {
  requestProviderUpdate: requestAccountEmailProviderUpdate,
  resolveRecoveryState: async (sessionId, userId) => {
    const { resolvePasswordRecoveryState } =
      await import("./password-recovery-registry");
    return resolvePasswordRecoveryState(sessionId, userId);
  },
  verifyAccessToken: verifyAccountEmailAccessToken,
};

export const accountEmailApiDependencies = defaultDependencies;

export type AccountEmailAccessTokenVerification = Awaited<
  ReturnType<typeof verifyAccountEmailAccessToken>
>;
