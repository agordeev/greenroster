"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import type { AuthFormState } from "@/app/actions/auth-state";
import {
  authFieldErrors,
  credentialsSchema,
  passwordResetSchema,
  recoverySchema,
} from "@/lib/auth/auth-validation";
import {
  organizerRegistrationSchema,
  runOrganizerBootstrapMutation,
} from "@/lib/auth/organizer-signup";
import {
  createOrganizerSignupCookieValue,
  ORGANIZER_SIGNUP_COOKIE,
  ORGANIZER_SIGNUP_COOKIE_MAX_AGE_SECONDS,
  ORGANIZER_SIGNUP_COOKIE_PATH,
  readOrganizerSignupCookieValue,
} from "@/lib/auth/organizer-signup-state";
import {
  executeOrganizerBootstrap,
  resolveCurrentLegalDocuments,
} from "@/lib/auth/organizer-signup-data";
import {
  claimPasswordRecoverySession,
  consumePasswordRecoverySession,
  releasePasswordRecoveryClaim,
  resolvePasswordRecoveryOperation,
} from "@/lib/auth/password-recovery-registry";
import { resolveSafeReturnPath } from "@/lib/auth/safe-return-path";
import { parseSignupSource } from "@/lib/auth/signup-source";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { resolveVerifiedSessionClaims } from "@/lib/auth/verified-session-claims";
import { MutationError } from "@/lib/mutations/result";
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
      message: "Check the highlighted fields.",
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
      message: "We couldn't sign you in. Check your connection and try again.",
    };
  }

  if (response.error) {
    return {
      status: "error",
      message:
        response.error.status === 429
          ? "Too many attempts. Wait a moment and try again."
          : isAuthRetryableFetchError(response.error)
            ? "We couldn't sign you in. Check your connection and try again."
            : "Check your e-mail and password, then try again.",
    };
  }

  if (!response.data.user.email_confirmed_at) {
    await supabase.auth.signOut({ scope: "local" });
    return {
      status: "error",
      message: "Confirm your e-mail address before you sign in.",
    };
  }

  redirect(returnPath);
}

export async function registerOrganizerAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = organizerRegistrationSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    acceptedTerms: formData.get("acceptedTerms") === "on",
    acceptedPrivacy: formData.get("acceptedPrivacy") === "on",
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: authFieldErrors(parsed.error),
    };
  }

  let legal: Awaited<ReturnType<typeof resolveCurrentLegalDocuments>>;
  try {
    legal = await resolveCurrentLegalDocuments();
  } catch {
    legal = null;
  }
  if (!legal) {
    return {
      status: "error",
      message: "We couldn't create your account. Try again in a moment.",
    };
  }

  const supabase = await createServerActionSupabaseClient();
  const redirectTo = new URL(
    "/auth/organizer-callback",
    webRuntimeEnv.appUrl,
  ).toString();

  const storeSignupHandoff = async () => {
    const cookieStore = await cookies();
    cookieStore.set(
      ORGANIZER_SIGNUP_COOKIE,
      createOrganizerSignupCookieValue(
        {
          termsVersion: legal.termsVersion,
          privacyVersion: legal.privacyVersion,
          source: parseSignupSource(formData.get("source")),
        },
        webRuntimeEnv.invitationTokenSecret,
      ),
      {
        httpOnly: true,
        maxAge: ORGANIZER_SIGNUP_COOKIE_MAX_AGE_SECONDS,
        path: ORGANIZER_SIGNUP_COOKIE_PATH,
        sameSite: "lax",
        secure: webRuntimeEnv.appUrl.startsWith("https://"),
      },
    );
  };

  try {
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      if (error.status === 429) {
        return {
          status: "error",
          message: "Too many attempts. Wait a moment and try again.",
        };
      }
      if (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500) {
        return {
          status: "error",
          message: "We couldn't create your account. Try again in a moment.",
        };
      }

      await storeSignupHandoff();
      return {
        status: "success",
        message:
          "Check your e-mail and confirm your address, then continue setting up your group.",
      };
    }

    await storeSignupHandoff();

    return {
      status: "success",
      message: data.session
        ? "Your account is ready. Continue setting up your group."
        : "Check your e-mail and confirm your address, then continue setting up your group.",
    };
  } catch {
    return {
      status: "error",
      message: "We couldn't create your account. Try again in a moment.",
    };
  }
}

export async function bootstrapOrganizerAction(input: unknown) {
  const requestHeaders = await headers();
  const correlationCandidate = requestHeaders.get("x-correlation-id");
  const handoff = readOrganizerSignupCookieValue(
    (await cookies()).get(ORGANIZER_SIGNUP_COOKIE)?.value,
    webRuntimeEnv.invitationTokenSecret,
  );

  const result = await runOrganizerBootstrapMutation(
    input,
    correlationCandidate,
    {
      executeBootstrap: (actorUserId, bootstrapInput, correlationId) =>
        executeOrganizerBootstrap(
          actorUserId,
          bootstrapInput,
          correlationId,
          parseSignupSource(handoff?.source),
        ),
      verifySession: verifyMutationSession,
      verifyLegalHandoff: async () => {
        const legal = await resolveCurrentLegalDocuments();

        if (!legal) throw new MutationError("transient");
        if (
          !handoff ||
          handoff.termsVersion !== legal.termsVersion ||
          handoff.privacyVersion !== legal.privacyVersion
        ) {
          throw new MutationError("validation", {
            fieldErrors: {
              legal: [
                "Start your account setup again to accept the current Terms of Use and Privacy Policy.",
              ],
            },
          });
        }
      },
    },
  );

  if (result.ok) {
    const cookieStore = await cookies();
    cookieStore.set(ORGANIZER_SIGNUP_COOKIE, "", {
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      path: ORGANIZER_SIGNUP_COOKIE_PATH,
      sameSite: "lax",
      secure: webRuntimeEnv.appUrl.startsWith("https://"),
    });
  }

  return result;
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
        "We couldn't send your recovery link. Check your connection and try again.",
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
        "We couldn't send your recovery link. Check your connection and try again.",
    };
  }

  if (error?.status && error.status >= 500) {
    return {
      status: "error",
      message: "We couldn't send your recovery link. Try again.",
    };
  }

  return {
    status: "success",
    message: "If you have an account, a recovery link is on its way.",
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
      message: "Check the highlighted fields.",
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
        "We couldn't update your password. Check your connection and try again.",
    };
  }

  const { data: userData, error: userError } = userResult;

  if (userError && isAuthRetryableFetchError(userError)) {
    return {
      status: "error",
      message:
        "We couldn't update your password. Check your connection and try again.",
    };
  }

  if (userError || !userData.user) {
    return {
      status: "error",
      message:
        "This recovery link has expired or was already used. Request a new link.",
    };
  }

  const claims = await resolveVerifiedSessionClaims(supabase);
  if (!claims || claims.sub !== userData.user.id) {
    return {
      status: "error",
      message: "We couldn't update your password. Try again.",
    };
  }

  const recoveryResolution = await resolvePasswordRecoveryOperation(
    claims.session_id,
    userData.user.id,
  );

  if (!recoveryResolution.ok) {
    return {
      status: "error",
      message: "We couldn't update your password. Try again.",
    };
  }

  const recoveryOperation = recoveryResolution.operation;
  if (!recoveryOperation) {
    return {
      status: "error",
      message:
        "This recovery link has expired or was already used. Request a new link.",
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
      message:
        "This recovery link has expired or was already used. Request a new link.",
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
            ? "We couldn't update your password. Try again."
            : "This recovery link has expired or was already used. Request a new link.",
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
        "We couldn't update your password. Check your connection and try again.",
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
            ? "We couldn't update your password. Check your connection and try again."
            : "This recovery link has expired or was already used. Request a new link.",
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
          "Your password was changed, but we couldn't finish. Sign in with your new password.",
      };
    }
  }
  await supabase.auth.signOut({ scope: "local" });
  return {
    status: "success",
    message: "Password updated. Return to sign in with your new password.",
  };
}
