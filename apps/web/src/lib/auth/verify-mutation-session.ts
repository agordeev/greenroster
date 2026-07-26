import "server-only";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { MutationError } from "@/lib/mutations/result";
import { resolvePasswordRecoveryState } from "@/lib/auth/password-recovery-registry";
import { resolveVerifiedSessionClaims } from "@/lib/auth/verified-session-claims";
import { createServerActionSupabaseClient } from "@/lib/supabase/server-action-client";

export type VerifiedMutationSession = Readonly<{
  userId: string;
  emailConfirmedAt: string;
}>;

export async function verifyMutationSession(): Promise<VerifiedMutationSession> {
  const supabase = await createServerActionSupabaseClient();
  let userResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;

  try {
    userResult = await supabase.auth.getUser();
  } catch (error) {
    throw new MutationError("transient", { cause: error });
  }

  const { data, error } = userResult;
  const emailConfirmedAt = data.user?.email_confirmed_at;

  if (error && isAuthRetryableFetchError(error)) {
    throw new MutationError("transient", { cause: error });
  }

  if (error || !data.user || !emailConfirmedAt) {
    throw new MutationError("authentication_required", { cause: error });
  }

  const claims = await resolveVerifiedSessionClaims(supabase);
  if (!claims || claims.sub !== data.user.id) {
    throw new MutationError("transient");
  }

  const recoveryState = await resolvePasswordRecoveryState(
    claims.session_id,
    claims.sub,
  );
  if (recoveryState === "unavailable") {
    throw new MutationError("transient");
  }
  if (recoveryState !== "none") {
    throw new MutationError("forbidden");
  }

  return {
    userId: data.user.id,
    emailConfirmedAt,
  };
}
