"use server";

import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import type { AuthFormState } from "@/app/actions/auth-state";
import {
  authFieldErrors,
  credentialsSchema,
  passwordResetSchema,
  recoverySchema,
} from "@/lib/auth/auth-validation";
import {
  claimPasswordRecoverySession,
  consumePasswordRecoverySession,
  releasePasswordRecoveryClaim,
  resolvePasswordRecoveryOperation,
} from "@/lib/auth/password-recovery-registry";
import { resolveSafeReturnPath } from "@/lib/auth/safe-return-path";
import { resolveVerifiedSessionClaims } from "@/lib/auth/verified-session-claims";
import { webRuntimeEnv } from "@/lib/runtime-env";
import { createServerActionSupabaseClient } from "@/lib/supabase/server-action-client";

export async function signInAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const returnPath = resolveSafeReturnPath(formData.get("returnPath"));
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted fields.",
      fieldErrors: authFieldErrors(parsed.error),
    };
  }

  const supabase = await createServerActionSupabaseClient();
  let response: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;

  try {
    response = await supabase.auth.signInWithPassword(parsed.data);
  } catch {
    return {
      status: "error",
      message:
        "The sign-in service could not be reached. Check your connection and try again.",
    };
  }

  if (response.error) {
    return {
      status: "error",
      message:
        response.error.status === 429
          ? "Too many attempts. Wait a moment and try again."
          : isAuthRetryableFetchError(response.error)
            ? "The sign-in service could not be reached. Check your connection and try again."
            : "The e-mail or password could not be verified.",
    };
  }

  if (!response.data.user.email_confirmed_at) {
    await supabase.auth.signOut({ scope: "local" });
    return {
      status: "error",
      message: "Verify your account e-mail before signing in.",
    };
  }

  redirect(returnPath);
}

export async function requestPasswordResetAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = recoverySchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a valid account e-mail.",
      fieldErrors: authFieldErrors(parsed.error),
    };
  }

  const supabase = await createServerActionSupabaseClient();
  const redirectTo = new URL(
    "/auth/callback?next=/reset-password",
    webRuntimeEnv.appUrl,
  ).toString();
  let error: Awaited<
    ReturnType<typeof supabase.auth.resetPasswordForEmail>
  >["error"];

  try {
    ({ error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo,
    }));
  } catch {
    return {
      status: "error",
      message:
        "The recovery service could not be reached. Check your connection and try again.",
    };
  }

  if (error?.status === 429) {
    return {
      status: "error",
      message: "Too many attempts. Wait a moment and try again.",
    };
  }

  if (error && isAuthRetryableFetchError(error)) {
    return {
      status: "error",
      message:
        "The recovery service could not be reached. Check your connection and try again.",
    };
  }

  if (error?.status && error.status >= 500) {
    return {
      status: "error",
      message: "The recovery service could not be reached. Try again.",
    };
  }

  return {
    status: "success",
    message:
      "If the address belongs to an account, password recovery instructions are on the way.",
  };
}

export async function signOutAction() {
  const supabase = await createServerActionSupabaseClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/sign-in");
}

export async function updatePasswordAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = passwordResetSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted fields.",
      fieldErrors: authFieldErrors(parsed.error),
    };
  }

  const supabase = await createServerActionSupabaseClient();
  let userResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;

  try {
    userResult = await supabase.auth.getUser();
  } catch {
    return {
      status: "error",
      message:
        "The recovery service could not be reached. Check your connection and try again.",
    };
  }

  const { data: userData, error: userError } = userResult;

  if (userError && isAuthRetryableFetchError(userError)) {
    return {
      status: "error",
      message:
        "The recovery service could not be reached. Check your connection and try again.",
    };
  }

  if (userError || !userData.user) {
    return {
      status: "error",
      message: "This recovery link is expired or has already been used.",
    };
  }

  const claims = await resolveVerifiedSessionClaims(supabase);
  if (!claims || claims.sub !== userData.user.id) {
    return {
      status: "error",
      message: "The recovery service could not be reached. Try again.",
    };
  }

  const recoveryResolution = await resolvePasswordRecoveryOperation(
    claims.session_id,
    userData.user.id,
  );

  if (!recoveryResolution.ok) {
    return {
      status: "error",
      message: "The recovery service could not be reached. Try again.",
    };
  }

  const recoveryOperation = recoveryResolution.operation;
  if (!recoveryOperation) {
    return {
      status: "error",
      message: "This recovery link is expired or has already been used.",
    };
  }

  if (recoveryOperation.state === "consumed") {
    await supabase.auth.signOut({ scope: "local" });
    return {
      status: "success",
      message: "Password updated. Return to sign in with your new password.",
    };
  }

  if (
    recoveryOperation.state !== "active" &&
    recoveryOperation.state !== "claimed"
  ) {
    if (recoveryOperation.claimId) {
      await releasePasswordRecoveryClaim(
        claims.session_id,
        userData.user.id,
        recoveryOperation.claimId,
      );
    }
    return {
      status: "error",
      message: "This recovery link is expired or has already been used.",
    };
  }

  let claimId = recoveryOperation.claimId;
  if (!claimId) {
    const recoveryClaim = await claimPasswordRecoverySession(
      claims.session_id,
      userData.user.id,
    );
    if (!recoveryClaim.ok) {
      return {
        status: "error",
        message:
          recoveryClaim.reason === "unavailable"
            ? "The recovery service could not be reached. Try again."
            : "This recovery link is expired or has already been used.",
      };
    }
    claimId = recoveryClaim.claimId;
  }

  let error: Awaited<ReturnType<typeof supabase.auth.updateUser>>["error"];

  try {
    ({ error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    }));
  } catch {
    await releasePasswordRecoveryClaim(
      claims.session_id,
      userData.user.id,
      claimId,
    );
    return {
      status: "error",
      message:
        "The recovery service could not be reached. Check your connection and try again.",
    };
  }

  if (error) {
    await releasePasswordRecoveryClaim(
      claims.session_id,
      userData.user.id,
      claimId,
    );
    return {
      status: "error",
      message:
        error.status === 429
          ? "Too many attempts. Wait a moment and try again."
          : isAuthRetryableFetchError(error) ||
              (typeof error.status === "number" && error.status >= 500)
            ? "The recovery service could not be reached. Check your connection and try again."
            : "This recovery link is expired or has already been used.",
    };
  }

  // A successful Supabase Auth password update means the database trigger has
  // already consumed the claimed recovery and committed its audit atomically.
  // This RPC is an idempotent confirmation/reconciliation call only.
  const confirmed = await consumePasswordRecoverySession(
    claims.session_id,
    userData.user.id,
    claimId,
    recoveryOperation.operationId,
  );
  if (!confirmed) {
    const reconciled = await resolvePasswordRecoveryOperation(
      claims.session_id,
      userData.user.id,
    );
    if (
      !reconciled.ok ||
      reconciled.operation?.state !== "consumed" ||
      reconciled.operation.claimId !== claimId ||
      reconciled.operation.operationId !== recoveryOperation.operationId
    ) {
      return {
        status: "error",
        message:
          "The password changed, but recovery confirmation is still pending. Try again.",
      };
    }
  }
  await supabase.auth.signOut({ scope: "local" });
  return {
    status: "success",
    message: "Password updated. Return to sign in with your new password.",
  };
}
