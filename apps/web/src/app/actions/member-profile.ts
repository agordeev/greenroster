"use server";

import { headers } from "next/headers";

import {
  memberSelfHandicapInputSchema,
  memberSelfProfileInputSchema,
} from "@/domain/member-self-profile";
import { resolveCorrelationId } from "@/lib/mutations/correlation";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import {
  executeSetMemberSelfHandicap,
  executeUpdateMemberSelfProfile,
} from "@/lib/member/member-self-profile-data";
import { runVerifiedMutation } from "@/lib/mutations/run-verified-mutation";
import { createServerActionSupabaseClient } from "@/lib/supabase/server-action-client";
import { webFirstRunInputSchema } from "@/lib/profile/web-first-run";

export type MemberFirstRunActionState = Readonly<{
  status: "idle" | "error" | "success";
  message: string;
}>;

export const initialMemberFirstRunActionState: MemberFirstRunActionState = {
  status: "idle",
  message: "",
};

export async function completeMemberFirstRunAction(
  _previousState: MemberFirstRunActionState,
  formData: FormData,
): Promise<MemberFirstRunActionState> {
  try {
    await verifyMutationSession();
  } catch {
    return {
      status: "error",
      message: "Sign in again to finish your profile.",
    };
  }

  const parsed = webFirstRunInputSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    termsVersion: formData.get("termsVersion"),
    privacyVersion: formData.get("privacyVersion"),
    acceptedTerms: formData.get("acceptedTerms") === "on",
    acceptedPrivacy: formData.get("acceptedPrivacy") === "on",
    operationId: formData.get("operationId"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message:
        "Enter your name and accept the current Terms of Use and Privacy Policy to continue.",
    };
  }

  const requestHeaders = await headers();
  const correlationId = resolveCorrelationId(
    requestHeaders.get("x-correlation-id"),
  );
  try {
    const supabase = await createServerActionSupabaseClient();
    const { error } = await supabase.rpc("complete_mobile_first_run", {
      p_first_name: parsed.data.firstName,
      p_last_name: parsed.data.lastName,
      p_terms_version: parsed.data.termsVersion,
      p_privacy_version: parsed.data.privacyVersion,
      p_correlation_id: correlationId,
      p_operation_id: parsed.data.operationId,
    });
    if (error) {
      return {
        status: "error",
        message:
          error.code === "40001"
            ? "The Terms of Use or Privacy Policy changed. Reload this page to review them."
            : "We couldn't finish your profile. Try again in a moment.",
      };
    }
  } catch {
    return {
      status: "error",
      message: "We couldn't finish your profile. Try again in a moment.",
    };
  }

  return {
    status: "success",
    message: "Your profile is ready.",
  };
}

export async function updateMemberSelfProfileAction(input: unknown) {
  const requestHeaders = await headers();
  return runVerifiedMutation(input, requestHeaders.get("x-correlation-id"), {
    execute: executeUpdateMemberSelfProfile,
    inputSchema: memberSelfProfileInputSchema,
    verifySession: verifyMutationSession,
  });
}

export async function setMemberSelfHandicapAction(input: unknown) {
  const requestHeaders = await headers();
  return runVerifiedMutation(input, requestHeaders.get("x-correlation-id"), {
    execute: executeSetMemberSelfHandicap,
    inputSchema: memberSelfHandicapInputSchema,
    verifySession: verifyMutationSession,
  });
}
