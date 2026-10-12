"use server";

import { cookies, headers } from "next/headers";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/auth-validation";
import { invitationRegistrationSchema } from "@/lib/invitations/invitation-registration";
import { resolveCorrelationId } from "@/lib/mutations/correlation";
import { createServerActionSupabaseClient } from "@/lib/supabase/server-action-client";
import {
  acceptMembershipInvitation,
  InvitationAcceptanceDataError,
} from "@/lib/invitations/invitation-acceptance-data";
import {
  INVITATION_ACCEPTANCE_COOKIE,
  INVITATION_ACCEPTANCE_COOKIE_PATH,
  invitationAcceptanceOperationId,
  readInvitationAcceptanceCookieValue,
} from "@/lib/invitations/invitation-acceptance-state";
import { webRuntimeEnv } from "@/lib/runtime-env";

export type InvitationActionState = Readonly<{
  status: "idle" | "error" | "success";
  message: string;
}>;

export const initialInvitationActionState: InvitationActionState = {
  status: "idle",
  message: "",
};

function invitationErrorMessage(error: InvitationAcceptanceDataError): string {
  switch (error.code) {
    case "expired":
      return "This invitation has expired. Ask a group coordinator to send a new one.";
    case "revoked":
      return "This invitation is no longer available. Ask a group coordinator to send a new one.";
    case "already_used":
      return "This invitation has already been accepted. Sign in to continue to your group.";
    case "identity_already_attached":
      return "This account already belongs to a group, so it can't accept this invitation.";
    case "address_mismatch":
      return "This invitation was sent to a different e-mail address. Sign in with the invited address, or ask a group administrator to fix it.";
    case "not_found":
      return "This invitation link is invalid or no longer available.";
    case "invalid":
      return "We couldn't check this invitation. Start again from the original invitation link.";
    default:
      return "We couldn't accept this invitation. Try again in a moment.";
  }
}

function clearInvitationCookie(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
) {
  cookieStore.set(INVITATION_ACCEPTANCE_COOKIE, "", {
    expires: new Date(0),
    httpOnly: true,
    maxAge: 0,
    path: INVITATION_ACCEPTANCE_COOKIE_PATH,
    sameSite: "lax",
    secure: webRuntimeEnv.appUrl.startsWith("https://"),
  });
}

export async function acceptInvitationAction(
  _previousState: InvitationActionState,
  _formData: FormData,
): Promise<InvitationActionState> {
  void _previousState;
  void _formData;
  const cookieStore = await cookies();
  const invitation = readInvitationAcceptanceCookieValue(
    cookieStore.get(INVITATION_ACCEPTANCE_COOKIE)?.value,
    webRuntimeEnv.invitationTokenSecret,
  );
  if (!invitation) {
    return {
      status: "error",
      message:
        "This invitation link is invalid or has expired. Start again from the original invitation link.",
    };
  }

  let session: Awaited<ReturnType<typeof verifyMutationSession>>;
  try {
    session = await verifyMutationSession();
  } catch {
    return {
      status: "error",
      message:
        "Confirm your e-mail address and sign in to accept this invitation.",
    };
  }

  const requestHeaders = await headers();
  const correlationId = resolveCorrelationId(
    requestHeaders.get("x-correlation-id"),
  );

  try {
    await acceptMembershipInvitation({
      invitationId: invitation.invitationId,
      tokenDigest: invitation.tokenDigest,
      userId: session.userId,
      correlationId,
      operationId: invitationAcceptanceOperationId(invitation),
    });
    clearInvitationCookie(cookieStore);
    return {
      status: "success",
      message: "Invitation accepted. You're now a member of the group.",
    };
  } catch (error) {
    if (error instanceof InvitationAcceptanceDataError) {
      return { status: "error", message: invitationErrorMessage(error) };
    }
    return {
      status: "error",
      message: "We couldn't accept this invitation. Try again in a moment.",
    };
  }
}

export async function registerInvitationAction(
  _previousState: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  const parsed = invitationRegistrationSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues.some((issue) => issue.path[0] === "email")
        ? "Enter a valid account e-mail."
        : parsed.error.issues.some(
              (issue) => issue.path[0] === "confirmPassword",
            )
          ? `Passwords must match and use at least ${MINIMUM_PASSWORD_LENGTH} characters.`
          : `Use a password of at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
    };
  }

  const cookieStore = await cookies();
  const invitation = readInvitationAcceptanceCookieValue(
    cookieStore.get(INVITATION_ACCEPTANCE_COOKIE)?.value,
    webRuntimeEnv.invitationTokenSecret,
  );
  if (!invitation) {
    return {
      status: "error",
      message:
        "This invitation link is invalid or has expired. Start again from the original invitation link.",
    };
  }

  const supabase = await createServerActionSupabaseClient();
  const redirectTo = new URL(
    "/auth/invitation-callback?next=/invitations/accept",
    webRuntimeEnv.appUrl,
  ).toString();
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
      return {
        status: "success",
        message:
          "Check your e-mail for a confirmation link. You can also sign in to accept the invitation.",
      };
    }
    return {
      status: "success",
      message: data.session
        ? "Your account is ready. Continue to accept the invitation."
        : "Check your e-mail for a confirmation link. You can also sign in to accept the invitation.",
    };
  } catch {
    return {
      status: "error",
      message: "We couldn't create your account. Try again in a moment.",
    };
  }
}
