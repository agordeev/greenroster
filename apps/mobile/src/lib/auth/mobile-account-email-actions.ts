import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";

import { createMobileOperationId } from "../mobile-operation-id";
import { mobileAccountEmailApi } from "./mobile-account-email-api";
import { mobileSupabase } from "./mobile-supabase";

const accountEmailSchema = z
  .string()
  .trim()
  .max(320)
  .toLowerCase()
  .pipe(z.email());

export type MobileAccountEmailActionResult = Readonly<{
  correlationId?: string;
  field: "email" | "confirmation" | null;
  message: string;
  status: "error" | "pending" | "success";
}>;

type MobileAccountEmailAuth = Pick<
  typeof mobileSupabase.auth,
  "getSession" | "refreshSession"
>;
type MobileAccountEmailClient = Pick<
  typeof mobileAccountEmailApi,
  "requestEmailChange"
>;

function connectionErrorMessage(): string {
  return "The account e-mail service could not be reached. Check your connection and try again.";
}

function authenticationErrorMessage(): string {
  return "Your signed-in session is unavailable. Sign in again and try again.";
}

export function createMobileAccountEmailActions(
  auth: MobileAccountEmailAuth,
  api: MobileAccountEmailClient = mobileAccountEmailApi,
) {
  return {
    async requestEmailChange(
      currentEmail: string,
      nextEmail: string,
      confirmed: boolean,
    ): Promise<MobileAccountEmailActionResult> {
      const parsedCurrent = accountEmailSchema.safeParse(currentEmail);
      const parsedNext = accountEmailSchema.safeParse(nextEmail);

      if (!parsedNext.success) {
        return {
          field: "email",
          message: "Enter a valid account e-mail.",
          status: "error",
        };
      }

      if (!parsedCurrent.success) {
        return {
          field: null,
          message:
            "Your signed-in account e-mail is unavailable. Refresh the session and try again.",
          status: "error",
        };
      }

      if (parsedCurrent.data === parsedNext.data) {
        return {
          field: "email",
          message: "Enter a different account e-mail.",
          status: "error",
        };
      }

      if (!confirmed) {
        return {
          field: "confirmation",
          message:
            "Confirm that you understand the provider's required verification step or steps must be completed.",
          status: "error",
        };
      }

      const correlationId = createMobileOperationId();
      let requestSent = false;
      try {
        const sessionResult = await auth.getSession();
        if (sessionResult.error) {
          return {
            field: null,
            message: isAuthRetryableFetchError(sessionResult.error)
              ? connectionErrorMessage()
              : authenticationErrorMessage(),
            status: "error",
          };
        }

        const accessToken = sessionResult.data.session?.access_token;
        if (!accessToken) {
          return {
            field: null,
            message: authenticationErrorMessage(),
            status: "error",
          };
        }

        const resultPromise = api.requestEmailChange(
          accessToken,
          parsedNext.data,
          confirmed,
          correlationId,
        );
        requestSent = true;
        const result = await resultPromise;
        if (result.ok) {
          return {
            correlationId: result.correlationId ?? correlationId,
            field: null,
            message:
              "Secure confirmation messages were requested. Your signed-in address stays unchanged until the provider completes the required verification flow.",
            status: "pending",
          };
        }

        if (result.code === "authentication_required") {
          return {
            correlationId: result.correlationId ?? correlationId,
            field: null,
            message: authenticationErrorMessage(),
            status: "error",
          };
        }
        if (result.code === "forbidden") {
          return {
            correlationId: result.correlationId ?? correlationId,
            field: null,
            message:
              "Password recovery sessions cannot change account e-mail. Sign in normally and submit the change again.",
            status: "error",
          };
        }
        if (result.code === "rate_limited") {
          return {
            correlationId: result.correlationId ?? correlationId,
            field: null,
            message: "Too many attempts. Wait a moment and try again.",
            status: "error",
          };
        }
        if (result.code === "validation") {
          const field = result.fieldErrors?.email ? "email" : null;
          return {
            correlationId: result.correlationId ?? correlationId,
            field,
            message:
              field === "email"
                ? (result.fieldErrors?.email?.[0] ??
                  "Enter another account e-mail.")
                : "The account e-mail could not be changed. Check the address and try again.",
            status: "error",
          };
        }

        return {
          correlationId: result.correlationId ?? correlationId,
          field: null,
          message: connectionErrorMessage(),
          status: "error",
        };
      } catch {
        return {
          ...(requestSent ? { correlationId } : {}),
          field: null,
          message: connectionErrorMessage(),
          status: "error",
        };
      }
    },

    async refreshSession(): Promise<MobileAccountEmailActionResult> {
      try {
        const { error } = await auth.refreshSession();

        if (error) {
          return {
            field: null,
            message: isAuthRetryableFetchError(error)
              ? connectionErrorMessage()
              : "Your signed-in session is unavailable. Sign in again and try again.",
            status: "error",
          };
        }

        return {
          field: null,
          message: "Account e-mail status refreshed.",
          status: "success",
        };
      } catch {
        return {
          field: null,
          message: connectionErrorMessage(),
          status: "error",
        };
      }
    },
  };
}

export const mobileAccountEmailActions = createMobileAccountEmailActions(
  mobileSupabase.auth,
);
