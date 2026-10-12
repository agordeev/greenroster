import { z } from "zod";

import { mobileSupabase } from "../auth/mobile-supabase";
import { createMobileOperationId } from "../mobile-operation-id";

const firstRunRowSchema = z.object({
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  current_terms_version: z.string().min(1),
  current_privacy_version: z.string().min(1),
  accepted_terms_at: z.string().nullable(),
  accepted_privacy_at: z.string().nullable(),
  is_complete: z.boolean(),
});

const completionInputSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name."),
  lastName: z.string().trim().min(1, "Enter your last name."),
});

export type MobileFirstRunState = Readonly<{
  acceptedPrivacyAt: string | null;
  acceptedTermsAt: string | null;
  currentPrivacyVersion: string;
  currentTermsVersion: string;
  firstName: string;
  isComplete: boolean;
  lastName: string;
}>;

export type MobileFirstRunErrorCode =
  | "configuration_unavailable"
  | "legal_documents_changed"
  | "permission_denied"
  | "unavailable"
  | "validation";

export type MobileFirstRunResult =
  | Readonly<{ ok: true; state: MobileFirstRunState }>
  | Readonly<{
      code: MobileFirstRunErrorCode;
      field?: "firstName" | "lastName";
      message: string;
      ok: false;
    }>;

type FirstRunClient = Pick<typeof mobileSupabase, "rpc">;

function mapFirstRunError(message: string): MobileFirstRunResult {
  if (message.includes("legal_document_versions_changed")) {
    return {
      code: "legal_documents_changed",
      message:
        "The Terms of Use or Privacy Policy changed while this screen was open. Review the updated documents and accept them again.",
      ok: false,
    };
  }

  if (message.includes("legal_document_versions_unavailable")) {
    return {
      code: "configuration_unavailable",
      message:
        "The current Terms of Use and Privacy Policy aren't available. Contact support before you continue.",
      ok: false,
    };
  }

  if (message.includes("identity_context_unavailable")) {
    return {
      code: "permission_denied",
      message:
        "You aren't an active member of a group. Contact a group administrator.",
      ok: false,
    };
  }

  return {
    code: "unavailable",
    message:
      "We couldn't check your profile. Check your connection and try again.",
    ok: false,
  };
}

function parseState(data: unknown): MobileFirstRunResult {
  const parsed = z.array(firstRunRowSchema).safeParse(data);
  if (!parsed.success) return mapFirstRunError("invalid_response");
  const row = parsed.data[0];

  if (!row) return mapFirstRunError("identity_context_unavailable");

  return {
    ok: true,
    state: {
      acceptedPrivacyAt: row.accepted_privacy_at,
      acceptedTermsAt: row.accepted_terms_at,
      currentPrivacyVersion: row.current_privacy_version,
      currentTermsVersion: row.current_terms_version,
      firstName: row.first_name ?? "",
      isComplete: row.is_complete,
      lastName: row.last_name ?? "",
    },
  };
}

export function createMobileFirstRunApi(client: FirstRunClient) {
  const resolve = async (): Promise<MobileFirstRunResult> => {
    try {
      const { data, error } = await client.rpc("resolve_mobile_first_run");
      if (error) return mapFirstRunError(error.message);
      return parseState(data);
    } catch {
      return mapFirstRunError("network_unavailable");
    }
  };

  return {
    async complete(
      firstName: string,
      lastName: string,
      observedVersions: Readonly<{
        privacyVersion: string;
        termsVersion: string;
      }>,
      operationContext: Readonly<{
        correlationId: string;
        operationId: string;
      }> = {
        correlationId: createMobileOperationId(),
        operationId: createMobileOperationId(),
      },
    ): Promise<MobileFirstRunResult> {
      const parsed = completionInputSchema.safeParse({ firstName, lastName });
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path[0] as
          "firstName" | "lastName";
        return {
          code: "validation",
          field,
          message:
            field === "firstName"
              ? "Enter your first name."
              : "Enter your last name.",
          ok: false,
        };
      }

      try {
        const { error } = await client.rpc("complete_mobile_first_run", {
          p_correlation_id: operationContext.correlationId,
          p_first_name: parsed.data.firstName,
          p_last_name: parsed.data.lastName,
          p_operation_id: operationContext.operationId,
          p_privacy_version: observedVersions.privacyVersion,
          p_terms_version: observedVersions.termsVersion,
        });

        if (error) return mapFirstRunError(error.message);
        return resolve();
      } catch {
        return mapFirstRunError("network_unavailable");
      }
    },
    resolve,
  };
}

export const mobileFirstRunApi = createMobileFirstRunApi(mobileSupabase);
