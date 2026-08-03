import { z } from "zod";

import { mobileSupabase } from "../auth/mobile-supabase";
import { createMobileOperationId } from "../mobile-operation-id";

export const mobileNotificationPreferenceCategories = [
  "membership_invitation",
  "round_published",
  "rsvp_reminder",
  "round_details_changed",
  "round_cancelled",
  "scoring_opened",
  "results_published",
  "round_awaiting_completion",
  "invitation_delivery_failed",
  "role_changed",
] as const;

export type MobileNotificationPreferenceCategory =
  (typeof mobileNotificationPreferenceCategories)[number];
export type MobileNotificationPreferenceChannel = "email" | "push";
export type MobilePushDevicePlatform = "ios" | "android";

export type MobileNotificationPreference = Readonly<{
  membershipId: string;
  groupId: string;
  category: MobileNotificationPreferenceCategory;
  mandatory: boolean;
  emailAllowed: boolean;
  pushAllowed: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  version: number;
  updatedAt: string | null;
}>;

export type MobileNotificationPreferenceMutation = Readonly<{
  membershipId: string;
  groupId: string;
  category: MobileNotificationPreferenceCategory;
  emailEnabled: boolean;
  pushEnabled: boolean;
  version: number;
  updatedAt: string;
}>;

export type MobileNotificationOperationContext = Readonly<{
  correlationId: string;
  operationId: string;
}>;

export type MobileNotificationResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{
      ok: false;
      code: "permission_denied" | "stale" | "validation" | "unavailable";
      correlationId?: string;
      message: string;
    }>;

export type MobileNotificationPreferencesClient = Pick<
  typeof mobileSupabase,
  "rpc"
>;

const categorySchema = z.enum(mobileNotificationPreferenceCategories);
const channelSchema = z.enum(["email", "push"]);
const platformSchema = z.enum(["ios", "android"]);
const uuidSchema = z.uuid();

const preferenceRowSchema = z
  .object({
    membership_id: uuidSchema,
    group_id: uuidSchema,
    category: categorySchema,
    mandatory: z.boolean(),
    email_allowed: z.boolean(),
    push_allowed: z.boolean(),
    email_enabled: z.boolean(),
    push_enabled: z.boolean(),
    version: z.number().int().nonnegative(),
    updated_at: z.string().nullable(),
  })
  .strict();

const mutationRowSchema = z
  .object({
    membership_id: uuidSchema,
    group_id: uuidSchema,
    category: categorySchema,
    email_enabled: z.boolean(),
    push_enabled: z.boolean(),
    version: z.number().int().positive(),
    updated_at: z.string(),
  })
  .strict();

const preferenceInputSchema = z.object({
  category: categorySchema,
  channel: channelSchema,
  enabled: z.boolean(),
  expectedPreferenceVersion: z.number().int().nonnegative(),
});

const registerDeviceInputSchema = z.object({
  deviceId: uuidSchema,
  expoPushToken: z.string().trim().min(1).max(512),
  platform: platformSchema,
});

const retireDeviceInputSchema = z.object({ deviceId: uuidSchema });

function mapPreference(row: z.infer<typeof preferenceRowSchema>) {
  return {
    membershipId: row.membership_id,
    groupId: row.group_id,
    category: row.category,
    mandatory: row.mandatory,
    emailAllowed: row.email_allowed,
    pushAllowed: row.push_allowed,
    emailEnabled: row.email_enabled,
    pushEnabled: row.push_enabled,
    version: row.version,
    updatedAt: row.updated_at,
  } satisfies MobileNotificationPreference;
}

function mapMutation(row: z.infer<typeof mutationRowSchema>) {
  return {
    membershipId: row.membership_id,
    groupId: row.group_id,
    category: row.category,
    emailEnabled: row.email_enabled,
    pushEnabled: row.push_enabled,
    version: row.version,
    updatedAt: row.updated_at,
  } satisfies MobileNotificationPreferenceMutation;
}

function mapError(message: string, correlationId?: string) {
  const normalized = message.toLowerCase();
  const supportReference = correlationId ? { correlationId } : {};
  if (
    normalized.includes("version_changed") ||
    normalized.includes("stale") ||
    normalized.includes("operation_id_reused")
  ) {
    return {
      code: "stale" as const,
      ...supportReference,
      message:
        "These notification settings changed elsewhere. Reload them before trying again.",
      ok: false as const,
    };
  }
  if (
    normalized.includes("identity_context") ||
    normalized.includes("actor_not_authorized") ||
    normalized.includes("membership_inactive") ||
    normalized.includes("member_not_found") ||
    normalized.includes("permission")
  ) {
    return {
      code: "permission_denied" as const,
      ...supportReference,
      message:
        "This account cannot change notification settings. Contact a group administrator.",
      ok: false as const,
    };
  }
  if (
    normalized.includes("invalid") ||
    normalized.includes("required") ||
    normalized.includes("not_allowed") ||
    normalized.includes("mandatory")
  ) {
    return {
      code: "validation" as const,
      ...supportReference,
      message: "That notification setting is not available for this account.",
      ok: false as const,
    };
  }
  return {
    code: "unavailable" as const,
    ...supportReference,
    message:
      "GreenRoster could not update notification settings. Check your connection and try again.",
    ok: false as const,
  };
}

function contextDefaults(): MobileNotificationOperationContext {
  return {
    correlationId: createMobileOperationId(),
    operationId: createMobileOperationId(),
  };
}

export function createMobileNotificationPreferencesApi(
  client: MobileNotificationPreferencesClient,
) {
  return {
    async resolve(): Promise<
      MobileNotificationResult<readonly MobileNotificationPreference[]>
    > {
      try {
        const { data, error } = await client.rpc(
          "resolve_mobile_member_notification_preferences",
        );
        if (error) return mapError(error.message);
        const parsed = z.array(preferenceRowSchema).safeParse(data);
        if (!parsed.success) {
          return {
            code: "unavailable",
            message:
              "GreenRoster returned invalid notification settings. Check your connection and try again.",
            ok: false,
          };
        }
        return { data: parsed.data.map(mapPreference), ok: true };
      } catch {
        return mapError("network_unavailable");
      }
    },

    async setPreference(
      input: Readonly<{
        category: MobileNotificationPreferenceCategory;
        channel: MobileNotificationPreferenceChannel;
        enabled: boolean;
        expectedPreferenceVersion: number;
      }>,
      operationContext: MobileNotificationOperationContext = contextDefaults(),
    ): Promise<MobileNotificationResult<MobileNotificationPreferenceMutation>> {
      const parsed = preferenceInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          code: "validation",
          correlationId: operationContext.correlationId,
          message: "That notification setting is not available.",
          ok: false,
        };
      }
      try {
        const { data, error } = await client.rpc(
          "set_mobile_member_notification_preference",
          {
            p_category: parsed.data.category,
            p_channel: parsed.data.channel,
            p_enabled: parsed.data.enabled,
            p_expected_preference_version:
              parsed.data.expectedPreferenceVersion,
            p_correlation_id: operationContext.correlationId,
            p_operation_id: operationContext.operationId,
          },
        );
        if (error)
          return mapError(error.message, operationContext.correlationId);
        const row = z.array(mutationRowSchema).safeParse(data);
        if (!row.success || !row.data[0]) {
          return {
            code: "unavailable",
            correlationId: operationContext.correlationId,
            message:
              "GreenRoster returned invalid notification settings. Check your connection and try again.",
            ok: false,
          };
        }
        return { data: mapMutation(row.data[0]), ok: true };
      } catch {
        return mapError("network_unavailable", operationContext.correlationId);
      }
    },

    async registerDevice(
      input: Readonly<{
        deviceId: string;
        expoPushToken: string;
        platform: MobilePushDevicePlatform;
      }>,
      operationContext: MobileNotificationOperationContext = contextDefaults(),
    ): Promise<MobileNotificationResult<null>> {
      const parsed = registerDeviceInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          code: "validation",
          correlationId: operationContext.correlationId,
          message: "This device could not be registered for notifications.",
          ok: false,
        };
      }
      try {
        const { error } = await client.rpc("register_mobile_push_device", {
          p_device_id: parsed.data.deviceId,
          p_expo_push_token: parsed.data.expoPushToken,
          p_platform: parsed.data.platform,
          p_correlation_id: operationContext.correlationId,
          p_operation_id: operationContext.operationId,
        });
        if (error)
          return mapError(error.message, operationContext.correlationId);
        return { data: null, ok: true };
      } catch {
        return mapError("network_unavailable", operationContext.correlationId);
      }
    },

    async retireDevice(
      input: Readonly<{ deviceId: string }>,
      operationContext: MobileNotificationOperationContext = contextDefaults(),
    ): Promise<MobileNotificationResult<null>> {
      const parsed = retireDeviceInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          code: "validation",
          correlationId: operationContext.correlationId,
          message: "This device could not be retired.",
          ok: false,
        };
      }
      try {
        const { error } = await client.rpc("retire_mobile_push_device", {
          p_device_id: parsed.data.deviceId,
          p_correlation_id: operationContext.correlationId,
          p_operation_id: operationContext.operationId,
        });
        if (error)
          return mapError(error.message, operationContext.correlationId);
        return { data: null, ok: true };
      } catch {
        return mapError("network_unavailable", operationContext.correlationId);
      }
    },
  };
}

export const mobileNotificationPreferencesApi =
  createMobileNotificationPreferencesApi(mobileSupabase);
