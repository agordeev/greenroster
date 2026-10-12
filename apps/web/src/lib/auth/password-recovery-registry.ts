import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service-client";
import {
  passwordRecoveryStateFromRow,
  type PasswordRecoveryState,
} from "@/lib/auth/password-recovery-state";

export async function createPasswordRecoveryIntent(
  stateHash: string,
  emailHash: string,
  codeVerifier: string,
  expiresAt: Date,
) {
  const supabase = createSupabaseServiceClient();
  try {
    const { data, error } = await supabase.rpc(
      "create_password_recovery_intent",
      {
        p_email_hash: emailHash,
        p_code_verifier: codeVerifier,
        p_expires_at: expiresAt.toISOString(),
        p_state_hash: stateHash,
      },
    );
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function resolvePasswordRecoveryIntent(stateHash: string) {
  const supabase = createSupabaseServiceClient();
  try {
    const { data, error } = await supabase
      .from("password_recovery_intents")
      .select("code_verifier,email_hash,expires_at,consumed_at")
      .eq("state_hash", stateHash)
      .maybeSingle();
    if (error) return { ok: false as const };
    if (
      !data ||
      data.consumed_at ||
      new Date(data.expires_at).getTime() <= Date.now()
    ) {
      return { intent: null, ok: true as const };
    }
    return {
      intent: {
        codeVerifier: data.code_verifier,
        emailHash: data.email_hash,
      },
      ok: true as const,
    };
  } catch {
    return { ok: false as const };
  }
}

export async function registerMobilePasswordRecoverySession(
  stateHash: string,
  emailHash: string,
  handleHash: string,
  resetOperationId: string,
  sessionId: string,
  userId: string,
  expiresAt: Date,
) {
  const supabase = createSupabaseServiceClient();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await supabase.rpc(
        "register_mobile_password_recovery_session",
        {
          p_email_hash: emailHash,
          p_expires_at: expiresAt.toISOString(),
          p_handle_hash: handleHash,
          p_reset_operation_id: resetOperationId,
          p_session_id: sessionId,
          p_state_hash: stateHash,
          p_user_id: userId,
        },
      );
      if (!error && data === true) return true;
    } catch {
      // Retry once with the same opaque handle and operation identifier.
    }
  }
  return false;
}

export type PasswordRecoveryHandleResolution =
  | Readonly<{ ok: false }>
  | Readonly<{ handle: null; ok: true }>
  | Readonly<{
      handle: Readonly<{
        claimId: string | null;
        operationId: string;
        sessionId: string;
        state: PasswordRecoveryState;
        userId: string;
      }>;
      ok: true;
    }>;

export async function resolvePasswordRecoveryHandle(
  handleHash: string,
): Promise<PasswordRecoveryHandleResolution> {
  const supabase = createSupabaseServiceClient();
  try {
    const { data, error } = await supabase
      .from("password_recovery_sessions")
      .select(
        "session_id,user_id,expires_at,claim_id,consumed_at,reset_operation_id",
      )
      .eq("handle_hash", handleHash)
      .maybeSingle();
    if (error) return { ok: false };
    if (!data) return { handle: null, ok: true };
    const state = passwordRecoveryStateFromRow(data, new Date());
    if (!data.reset_operation_id || state === "unavailable") {
      return { ok: false };
    }
    return {
      handle: {
        claimId: data.claim_id,
        operationId: data.reset_operation_id,
        sessionId: data.session_id,
        state,
        userId: data.user_id,
      },
      ok: true,
    };
  } catch {
    return { ok: false };
  }
}

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

export async function resolvePasswordRecoveryOperation(
  sessionId: string,
  userId: string,
) {
  const supabase = createSupabaseServiceClient();
  try {
    const { data, error } = await supabase
      .from("password_recovery_sessions")
      .select("expires_at,claim_id,consumed_at,reset_operation_id")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { ok: false as const };
    if (!data) return { ok: true as const, operation: null };
    const state = passwordRecoveryStateFromRow(data, new Date());
    if (!data.reset_operation_id || state === "unavailable") {
      return { ok: false as const };
    }
    return {
      ok: true as const,
      operation: {
        claimId: data.claim_id,
        operationId: data.reset_operation_id,
        state,
      },
    };
  } catch {
    return { ok: false as const };
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
  correlationId: string = crypto.randomUUID(),
) {
  const supabase = createSupabaseServiceClient();
  const consumedAt = new Date().toISOString();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await supabase.rpc(
        "consume_password_recovery_session",
        {
          p_session_id: sessionId,
          p_user_id: userId,
          p_claim_id: claimId,
          p_consumed_at: consumedAt,
          p_correlation_id: correlationId,
        },
      );

      if (!error && data === true) return true;
    } catch {
      // Retry once with the same correlation ID to reconcile a lost response.
    }
  }
  return false;
}
