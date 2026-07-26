import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service-client";
import {
  passwordRecoveryStateFromRow,
  type PasswordRecoveryState,
} from "@/lib/auth/password-recovery-state";

export async function registerPasswordRecoverySession(
  sessionId: string,
  userId: string,
  expiresAt: Date,
) {
  const supabase = createSupabaseServiceClient();

  try {
    const { data, error } = await supabase.rpc(
      "register_password_recovery_session",
      {
        p_session_id: sessionId,
        p_user_id: userId,
        p_expires_at: expiresAt.toISOString(),
      },
    );
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function resolvePasswordRecoveryState(
  sessionId: string,
  userId: string,
  now: Date = new Date(),
): Promise<PasswordRecoveryState> {
  const supabase = createSupabaseServiceClient();

  try {
    const { data, error } = await supabase
      .from("password_recovery_sessions")
      .select("expires_at,claim_id,consumed_at")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return "unavailable";
    return passwordRecoveryStateFromRow(data, now);
  } catch {
    return "unavailable";
  }
}

export type PasswordRecoveryClaim =
  | Readonly<{ ok: true; claimId: string }>
  | Readonly<{ ok: false; reason: "not_active" | "unavailable" }>;

export async function claimPasswordRecoverySession(
  sessionId: string,
  userId: string,
): Promise<PasswordRecoveryClaim> {
  const supabase = createSupabaseServiceClient();
  const claimId = crypto.randomUUID();
  const claimedAt = new Date().toISOString();

  try {
    const { data, error } = await supabase.rpc(
      "claim_password_recovery_session",
      {
        p_session_id: sessionId,
        p_user_id: userId,
        p_claim_id: claimId,
        p_claimed_at: claimedAt,
      },
    );

    if (error) return { ok: false, reason: "unavailable" };
    return data === true
      ? { ok: true, claimId }
      : { ok: false, reason: "not_active" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function releasePasswordRecoveryClaim(
  sessionId: string,
  userId: string,
  claimId: string,
) {
  const supabase = createSupabaseServiceClient();
  try {
    await supabase.rpc("release_password_recovery_claim", {
      p_session_id: sessionId,
      p_user_id: userId,
      p_claim_id: claimId,
    });
  } catch {
    // A new recovery request creates a new session if releasing fails.
  }
}

export async function consumePasswordRecoverySession(
  sessionId: string,
  userId: string,
  claimId: string,
) {
  const supabase = createSupabaseServiceClient();
  try {
    const { data, error } = await supabase.rpc(
      "consume_password_recovery_session",
      {
        p_session_id: sessionId,
        p_user_id: userId,
        p_claim_id: claimId,
        p_consumed_at: new Date().toISOString(),
      },
    );

    return !error && data === true;
  } catch {
    return false;
  }
}
