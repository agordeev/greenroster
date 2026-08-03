import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/mobile-operation-id", () => ({
  createMobileOperationId: vi.fn(() => "40000000-0000-4000-8000-000000000001"),
}));
vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { rpc: vi.fn() },
}));

import { createMobileNotificationPreferencesApi } from "../apps/mobile/src/lib/notifications/mobile-notification-preferences-api";
import {
  applyMobileNotificationPreferenceMutation,
  canChangeMobileNotificationPreference,
  initialMobileNotificationPreferencesState,
  mobileNotificationPreferencesReducer,
} from "../apps/mobile/src/lib/notifications/mobile-notification-preferences-state";

const membershipId = "60000000-0000-4000-8000-000000000001";
const groupId = "70000000-0000-4000-8000-000000000001";
const deviceId = "80000000-0000-4000-8000-000000000001";
const correlationId = "40000000-0000-4000-8000-000000000002";
const operationId = "40000000-0000-4000-8000-000000000003";

const preferenceRow = {
  membership_id: membershipId,
  group_id: groupId,
  category: "round_published",
  mandatory: false,
  email_allowed: true,
  push_allowed: true,
  email_enabled: true,
  push_enabled: false,
  version: 2,
  updated_at: "2026-08-03T09:00:00.000Z",
};

describe("mobile notification preferences API", () => {
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpc = vi.fn();
  });

  it("maps the server-owned preference projection", async () => {
    rpc.mockResolvedValue({ data: [preferenceRow], error: null });

    await expect(
      createMobileNotificationPreferencesApi({ rpc }).resolve(),
    ).resolves.toEqual({
      data: [
        {
          category: "round_published",
          emailAllowed: true,
          emailEnabled: true,
          groupId,
          mandatory: false,
          membershipId,
          pushAllowed: true,
          pushEnabled: false,
          updatedAt: "2026-08-03T09:00:00.000Z",
          version: 2,
        },
      ],
      ok: true,
    });
    expect(rpc).toHaveBeenCalledWith(
      "resolve_mobile_member_notification_preferences",
    );
  });

  it("passes optimistic-concurrency and replay context to the preference RPC", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          membership_id: membershipId,
          group_id: groupId,
          category: "round_published",
          email_enabled: true,
          push_enabled: true,
          version: 3,
          updated_at: "2026-08-03T09:01:00.000Z",
        },
      ],
      error: null,
    });

    await expect(
      createMobileNotificationPreferencesApi({ rpc }).setPreference(
        {
          category: "round_published",
          channel: "push",
          enabled: true,
          expectedPreferenceVersion: 2,
        },
        { correlationId, operationId },
      ),
    ).resolves.toMatchObject({
      data: { pushEnabled: true, version: 3 },
      ok: true,
    });
    expect(rpc).toHaveBeenCalledWith(
      "set_mobile_member_notification_preference",
      {
        p_category: "round_published",
        p_channel: "push",
        p_enabled: true,
        p_expected_preference_version: 2,
        p_correlation_id: correlationId,
        p_operation_id: operationId,
      },
    );
  });

  it("registers and retires only the device identified by the caller", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const api = createMobileNotificationPreferencesApi({ rpc });

    await expect(
      api.registerDevice(
        { deviceId, expoPushToken: "ExponentPushToken[test]", platform: "ios" },
        { correlationId, operationId },
      ),
    ).resolves.toEqual({ data: null, ok: true });
    await expect(
      api.retireDevice({ deviceId }, { correlationId, operationId }),
    ).resolves.toEqual({ data: null, ok: true });
    expect(rpc).toHaveBeenNthCalledWith(1, "register_mobile_push_device", {
      p_correlation_id: correlationId,
      p_device_id: deviceId,
      p_expo_push_token: "ExponentPushToken[test]",
      p_operation_id: operationId,
      p_platform: "ios",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "retire_mobile_push_device", {
      p_correlation_id: correlationId,
      p_device_id: deviceId,
      p_operation_id: operationId,
    });
  });

  it("keeps mandatory channels and stale responses server-authoritative", async () => {
    const mandatory = {
      ...preferenceRow,
      category: "round_cancelled" as const,
      mandatory: true,
    };
    expect(
      canChangeMobileNotificationPreference(
        {
          category: mandatory.category,
          emailAllowed: true,
          emailEnabled: true,
          groupId,
          mandatory: true,
          membershipId,
          pushAllowed: true,
          pushEnabled: true,
          updatedAt: mandatory.updated_at,
          version: 1,
        },
        "push",
      ),
    ).toBe(false);

    const next = applyMobileNotificationPreferenceMutation(
      [
        {
          category: "round_published",
          emailAllowed: true,
          emailEnabled: true,
          groupId,
          mandatory: false,
          membershipId,
          pushAllowed: true,
          pushEnabled: false,
          updatedAt: null,
          version: 0,
        },
      ],
      {
        category: "round_published",
        emailEnabled: false,
        groupId,
        membershipId,
        pushEnabled: true,
        updatedAt: "2026-08-03T09:01:00.000Z",
        version: 1,
      },
    );
    expect(next[0]).toMatchObject({
      emailEnabled: false,
      pushEnabled: true,
      version: 1,
    });

    const loaded = mobileNotificationPreferencesReducer(
      initialMobileNotificationPreferencesState,
      { preferences: next, type: "loaded" },
    );
    expect(loaded.status).toBe("ready");
  });
});
