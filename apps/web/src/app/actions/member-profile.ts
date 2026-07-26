"use server";

import { headers } from "next/headers";

import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { resolveCorrelationId } from "@/lib/mutations/correlation";
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
      message: "Your session is unavailable. Sign in again before continuing.",
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
        "Confirm your name and both current legal documents before continuing.",
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
            ? "The legal documents changed. Reload this page and review the current versions."
            : "Your profile could not be completed. Try again in a moment.",
      };
    }
  } catch {
    return {
      status: "error",
      message: "Your profile could not be completed. Try again in a moment.",
    };
  }

  return {
    status: "success",
    message: "Profile confirmed. Your member experience is ready.",
  };
}
