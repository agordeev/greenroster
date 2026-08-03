import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/mobile-operation-id", () => ({
  createMobileOperationId: vi
    .fn()
    .mockReturnValue("40000000-0000-4000-8000-000000000001"),
}));

import { createMobilePushRegistration } from "../apps/mobile/src/lib/notifications/mobile-push-registration";

const userId = "50000000-0000-4000-8000-000000000001";
const deviceId = "60000000-0000-4000-8000-000000000001";

function createDependencies() {
  return {
    api: {
      registerDevice: vi.fn(),
      retireDevice: vi.fn(),
    },
    notifications: {
      getExpoPushTokenAsync: vi.fn(),
      getPermissionsAsync: vi.fn(),
      requestPermissionsAsync: vi.fn(),
    },
    platform: "ios" as const,
    projectId: "ad2ba667-146c-4072-bef0-575c05f2cce9",
    storage: {
      getItem: vi.fn(),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    },
    fingerprintToken: vi.fn(async () => "fingerprint"),
    setAndroidNotificationChannel: vi.fn().mockResolvedValue(undefined),
  };
}

describe("mobile push registration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not request a token or call the RPC after permission is declined", async () => {
    const dependencies = createDependencies();
    dependencies.notifications.getPermissionsAsync.mockResolvedValue({
      status: "denied",
    });
    const registration = createMobilePushRegistration(dependencies);

    await expect(registration.register(userId)).resolves.toEqual({
      status: "permission_denied",
    });
    expect(
      dependencies.notifications.getExpoPushTokenAsync,
    ).not.toHaveBeenCalled();
    expect(dependencies.api.registerDevice).not.toHaveBeenCalled();
  });

  it("is a no-op on web", async () => {
    const dependencies = createDependencies();
    dependencies.platform = "web";
    const registration = createMobilePushRegistration(dependencies);

    await expect(
      registration.register(userId, { requestPermission: true }),
    ).resolves.toEqual({ status: "unsupported" });
    expect(
      dependencies.notifications.getPermissionsAsync,
    ).not.toHaveBeenCalled();
    expect(dependencies.api.registerDevice).not.toHaveBeenCalled();
    expect(dependencies.storage.setItem).not.toHaveBeenCalled();
  });

  it("prepares the Android notification channel before registration", async () => {
    const dependencies = createDependencies();
    dependencies.platform = "android";
    dependencies.notifications.getPermissionsAsync.mockResolvedValue({
      status: "denied",
    });
    const registration = createMobilePushRegistration(dependencies);

    await registration.register(userId);

    expect(dependencies.setAndroidNotificationChannel).toHaveBeenCalledOnce();
  });

  it("explains the request context, registers the Expo token, and persists its device id", async () => {
    const dependencies = createDependencies();
    dependencies.notifications.getPermissionsAsync.mockResolvedValue({
      status: "undetermined",
    });
    dependencies.notifications.requestPermissionsAsync.mockResolvedValue({
      status: "granted",
    });
    dependencies.notifications.getExpoPushTokenAsync.mockResolvedValue({
      data: "ExponentPushToken[test]",
    });
    dependencies.api.registerDevice.mockResolvedValue({ data: null, ok: true });
    dependencies.storage.getItem.mockResolvedValue(null);
    const registration = createMobilePushRegistration(dependencies);

    await expect(
      registration.register(userId, { requestPermission: true }),
    ).resolves.toEqual({ status: "registered" });
    expect(
      dependencies.notifications.requestPermissionsAsync,
    ).toHaveBeenCalledOnce();
    expect(
      dependencies.notifications.getExpoPushTokenAsync,
    ).toHaveBeenCalledWith({
      projectId: "ad2ba667-146c-4072-bef0-575c05f2cce9",
    });
    expect(dependencies.api.registerDevice).toHaveBeenCalledWith(
      {
        deviceId: expect.any(String),
        expoPushToken: "ExponentPushToken[test]",
        platform: "ios",
      },
      { correlationId: expect.any(String), operationId: expect.any(String) },
    );
    expect(dependencies.storage.setItem).toHaveBeenCalledWith(
      "greenroster.notifications.device",
      expect.stringContaining(`"userId":"${userId}"`),
    );
    expect(dependencies.storage.setItem.mock.calls[0]?.[1]).not.toContain(
      "ExponentPushToken[test]",
    );
  });

  it("reuses the stored device id when the same member registers again", async () => {
    const dependencies = createDependencies();
    dependencies.notifications.getPermissionsAsync.mockResolvedValue({
      status: "granted",
    });
    dependencies.notifications.getExpoPushTokenAsync.mockResolvedValue({
      data: "ExponentPushToken[rotated]",
    });
    dependencies.api.registerDevice.mockResolvedValue({ data: null, ok: true });
    dependencies.storage.getItem.mockResolvedValue(
      JSON.stringify({
        deviceId,
        pendingRegistration: null,
        pendingRetirement: null,
        userId,
      }),
    );
    const registration = createMobilePushRegistration(dependencies);

    await registration.register(userId);

    expect(dependencies.api.registerDevice).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId }),
      expect.anything(),
    );
  });

  it("retires the stored device without failing local sign-out callers", async () => {
    const dependencies = createDependencies();
    dependencies.storage.getItem.mockResolvedValue(
      JSON.stringify({ deviceId, userId }),
    );
    dependencies.api.retireDevice.mockResolvedValue({
      message: "offline",
      ok: false,
    });
    const registration = createMobilePushRegistration(dependencies);

    await expect(registration.retire(userId)).resolves.toMatchObject({
      status: "unavailable",
    });
    expect(dependencies.api.retireDevice).toHaveBeenCalledWith(
      { deviceId },
      { correlationId: expect.any(String), operationId: expect.any(String) },
    );
    expect(dependencies.storage.removeItem).not.toHaveBeenCalled();
  });

  it("keeps the install device id after successful retirement", async () => {
    const dependencies = createDependencies();
    dependencies.storage.getItem.mockResolvedValue(
      JSON.stringify({
        deviceId,
        pendingRegistration: null,
        pendingRetirement: null,
        userId,
      }),
    );
    dependencies.api.retireDevice.mockResolvedValue({ data: null, ok: true });
    const registration = createMobilePushRegistration(dependencies);

    await expect(registration.retire(userId)).resolves.toMatchObject({
      status: "retired",
    });
    expect(dependencies.storage.setItem).toHaveBeenLastCalledWith(
      "greenroster.notifications.device",
      expect.stringContaining(`"deviceId":"${deviceId}"`),
    );
    expect(dependencies.storage.setItem).toHaveBeenLastCalledWith(
      "greenroster.notifications.device",
      expect.stringContaining('"userId":null'),
    );
  });

  it("reuses a pending operation after an ambiguous registration failure", async () => {
    const dependencies = createDependencies();
    dependencies.notifications.getPermissionsAsync.mockResolvedValue({
      status: "granted",
    });
    dependencies.notifications.getExpoPushTokenAsync.mockResolvedValue({
      data: "ExponentPushToken[pending]",
    });
    dependencies.storage.getItem
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        JSON.stringify({
          deviceId,
          pendingRegistration: {
            correlationId: "correlation-pending",
            deviceId,
            operationId: "operation-pending",
            platform: "ios",
            tokenFingerprint: "fingerprint",
          },
          pendingRetirement: null,
          userId,
        }),
      );
    dependencies.api.registerDevice
      .mockResolvedValueOnce({ message: "offline", ok: false })
      .mockResolvedValueOnce({ data: null, ok: true });
    const registration = createMobilePushRegistration(dependencies);

    await registration.register(userId);
    await registration.register(userId);

    expect(dependencies.api.registerDevice).toHaveBeenLastCalledWith(
      expect.objectContaining({ deviceId }),
      {
        correlationId: "correlation-pending",
        operationId: "operation-pending",
      },
    );
  });
});
