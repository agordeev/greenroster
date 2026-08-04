import "server-only";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { resolvePasswordRecoveryState } from "./password-recovery-registry";
import { resolveVerifiedSessionClaims } from "./verified-session-claims";
import { createServerComponentSupabaseClient } from "../supabase/server-component-client";

type AccountPageSessionResult =
  | Readonly<{ state: "authentication_required" }>
  | Readonly<{ state: "recovery_active" }>
  | Readonly<{ state: "recovery_restricted" }>
  | Readonly<{ state: "unavailable" }>
  | Readonly<{
      state: "ready";
      email: string;
      lastSignInAt: string | null;
    }>;

type AccountPageSessionDependencies = Readonly<{
  createClient: typeof createServerComponentSupabaseClient;
  resolveClaims: typeof resolveVerifiedSessionClaims;
  resolveRecoveryState: typeof resolvePasswordRecoveryState;
}>;

const defaultDependencies: AccountPageSessionDependencies = {
  createClient: createServerComponentSupabaseClient,
  resolveClaims: resolveVerifiedSessionClaims,
  resolveRecoveryState: resolvePasswordRecoveryState,
};

export async function resolveAccountPageSession(
  overrides?: Partial<AccountPageSessionDependencies>,
): Promise<AccountPageSessionResult> {
  const dependencies = { ...defaultDependencies, ...overrides };

  try {
    const client = await dependencies.createClient();
    const userResult = await client.auth.getUser();
    const user = userResult.data.user;

    if (userResult.error && isAuthRetryableFetchError(userResult.error)) {
      return { state: "unavailable" };
    }
    if (userResult.error || !user?.email || !user.email_confirmed_at) {
      return { state: "authentication_required" };
    }

    const claims = await dependencies.resolveClaims(client);
    if (!claims || claims.sub !== user.id) return { state: "unavailable" };

    const recoveryState = await dependencies.resolveRecoveryState(
      claims.session_id,
      claims.sub,
    );
    if (recoveryState === "active") return { state: "recovery_active" };
    if (recoveryState === "unavailable") return { state: "unavailable" };
    if (recoveryState !== "none") return { state: "recovery_restricted" };

    return {
      state: "ready",
      email: user.email,
      lastSignInAt: user.last_sign_in_at ?? null,
    };
  } catch {
    return { state: "unavailable" };
  }
}
