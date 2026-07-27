"use server";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import {
  runAccountEmailChange,
  type AccountEmailChangeState,
} from "@/lib/auth/account-email-change";
import { verifyMutationSession } from "@/lib/auth/verify-mutation-session";
import { MutationError } from "@/lib/mutations/result";
import { webRuntimeEnv } from "@/lib/runtime-env";
import { createServerActionSupabaseClient } from "@/lib/supabase/server-action-client";

export async function requestAccountEmailChangeAction(
  _previousState: AccountEmailChangeState,
  formData: FormData,
): Promise<AccountEmailChangeState> {
  return runAccountEmailChange(
    {
      email: formData.get("email"),
      confirmed: formData.get("confirmed") === "true",
    },
    {
      verifySession: verifyMutationSession,
      requestChange: async (email) => {
        const supabase = await createServerActionSupabaseClient();
        let userResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
        try {
          userResult = await supabase.auth.getUser();
        } catch (error) {
          throw new MutationError("transient", { cause: error });
        }
        const user = userResult.data.user;
        if (userResult.error || !user?.email) {
          throw new MutationError(
            isAuthRetryableFetchError(userResult.error)
              ? "transient"
              : "authentication_required",
            { cause: userResult.error },
          );
        }
        if (user.email.toLowerCase() === email) {
          return { currentEmail: user.email, userId: user.id };
        }

        const emailRedirectTo = new URL(
          "/account/email-change-confirmed",
          webRuntimeEnv.appUrl,
        ).toString();
        let updateResult: Awaited<ReturnType<typeof supabase.auth.updateUser>>;
        try {
          updateResult = await supabase.auth.updateUser(
            { email },
            { emailRedirectTo },
          );
        } catch (error) {
          throw new MutationError("transient", { cause: error });
        }
        if (updateResult.error) {
          const status = updateResult.error.status;
          throw new MutationError(
            status === 429
              ? "rate_limited"
              : isAuthRetryableFetchError(updateResult.error) ||
                  (typeof status === "number" && status >= 500)
                ? "transient"
                : "validation",
            { cause: updateResult.error },
          );
        }
        if (!updateResult.data.user || updateResult.data.user.id !== user.id) {
          throw new MutationError("unexpected");
        }
        return { currentEmail: user.email, userId: user.id };
      },
    },
  );
}
