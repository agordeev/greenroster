"use server";

import { cookies, headers } from "next/headers";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
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
      return "This account already belongs to a GreenRoster group. One account can belong to one group in v1.";
    case "address_mismatch":
      return "This invitation could not be attached to the current account. Sign in with a verified account or ask a coordinator to review the invitation.";
    case "not_found":
      return "This invitation link is invalid or no longer available.";
    case "invalid":
      return "This invitation could not be verified. Start again from the original invitation link.";
    default:
      return "The invitation service is temporarily unavailable. Try again in a moment.";
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
        "Sign in with a verified account before accepting this invitation.",
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
      message: "Invitation accepted. Your group access is ready.",
    };
  } catch (error) {
    if (error instanceof InvitationAcceptanceDataError) {
      return { status: "error", message: invitationErrorMessage(error) };
    }
    return {
      status: "error",
      message:
        "The invitation service is temporarily unavailable. Try again in a moment.",
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
          ? "Passwords must match and use at least 12 characters."
          : "Use a password of at least 12 characters.",
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
          message:
            "The account service could not be reached. Try again in a moment.",
        };
      }
      return {
        status: "success",
        message:
          "If this account can be registered, check the account e-mail for confirmation instructions. You can also sign in with a verified account.",
      };
    }
    return {
      status: "success",
      message: data.session
        ? "Your account is ready. Continue to accept the invitation."
        : "If this account can be registered, check the account e-mail for confirmation instructions. You can also sign in with a verified account.",
    };
  } catch {
    return {
      status: "error",
      message:
        "The account service could not be reached. Try again in a moment.",
    };
  }
}
