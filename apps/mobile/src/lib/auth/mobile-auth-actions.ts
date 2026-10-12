import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import { mobileRecoveryApi } from "./mobile-recovery-api";
import { mobileSupabase } from "./mobile-supabase";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
});

const recoverySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

type MobileAuthClient = Pick<
  typeof mobileSupabase.auth,
  "signInWithPassword" | "signOut"
>;
type MobileRecoveryClient = Pick<
  typeof mobileRecoveryApi,
  "requestPasswordRecovery"
>;

export type MobileAuthActionResult = Readonly<{
  field: "email" | "password" | null;
  message: string;
  status: "error" | "success";
}>;

export function createMobileAuthActions(
  auth: MobileAuthClient,
  recovery: MobileRecoveryClient,
) {
  return {
    async requestPasswordRecovery(
      email: string,
    ): Promise<MobileAuthActionResult> {
      const parsed = recoverySchema.safeParse({ email });
      if (!parsed.success) {
        return {
          field: "email",
          message: "Enter a valid account e-mail.",
          status: "error",
        };
      }

      try {
        const result = await recovery.requestPasswordRecovery(
          parsed.data.email,
        );

        if (!result.ok && result.code === "rate_limited") {
          return {
            field: null,
            message: "Too many attempts. Wait a moment and try again.",
            status: "error",
          };
        }

        if (!result.ok) {
          return {
            field: null,
            message:
              "We couldn't send your recovery link. Check your connection and try again.",
            status: "error",
          };
        }

        return {
          field: null,
          message: "If you have an account, a recovery link is on its way.",
          status: "success",
        };
      } catch {
        return {
          field: null,
          message:
            "We couldn't send your recovery link. Check your connection and try again.",
          status: "error",
        };
      }
    },

    async signIn(
      email: string,
      password: string,
    ): Promise<MobileAuthActionResult> {
      const parsed = credentialsSchema.safeParse({ email, password });
      if (!parsed.success) {
        const field = parsed.error.issues.some(
          (issue) => issue.path[0] === "email",
        )
          ? "email"
          : "password";
        return {
          field,
          message:
            field === "email"
              ? "Enter a valid account e-mail."
              : "Enter your password.",
          status: "error",
        };
      }

      try {
        const { data, error } = await auth.signInWithPassword(parsed.data);

        if (error) {
          const message =
            error.status === 429
              ? "Too many attempts. Wait a moment and try again."
              : isAuthRetryableFetchError(error)
                ? "We couldn't sign you in. Check your connection and try again."
                : error.status !== undefined && error.status >= 500
                  ? "We couldn't sign you in. Try again."
                  : "Check your e-mail and password, then try again.";
          return {
            field: null,
            message,
            status: "error",
          };
        }

        if (!data.user?.email_confirmed_at) {
          await auth.signOut({ scope: "local" });
          return {
            field: null,
            message: "Confirm your e-mail address before you sign in.",
            status: "error",
          };
        }

        return { field: null, message: "Signed in.", status: "success" };
      } catch {
        return {
          field: null,
          message:
            "We couldn't sign you in. Check your connection and try again.",
          status: "error",
        };
      }
    },

    async signOut(): Promise<MobileAuthActionResult> {
      try {
        const { error } = await auth.signOut({ scope: "local" });
        if (error) {
          return {
            field: null,
            message: "We couldn't sign you out. Try again.",
            status: "error",
          };
        }

        return { field: null, message: "Signed out.", status: "success" };
      } catch {
        return {
          field: null,
          message: "We couldn't sign you out. Try again.",
          status: "error",
        };
      }
    },
  };
}

export const mobileAuthActions = createMobileAuthActions(
  mobileSupabase.auth,
  mobileRecoveryApi,
);
