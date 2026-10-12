import { createMobileOperationId } from "../mobile-operation-id";
import type { secureSessionStorage } from "../auth/secure-session-storage";
import type { mobileNotificationPreferencesApi } from "./mobile-notification-preferences-api";
import type * as Notifications from "expo-notifications";

const deviceStorageKey = "greenroster.notifications.device";

type StoredDeviceRegistration = Readonly<{
  deviceId: string;
  userId: string | null;
  pendingRegistration: PendingRegistration | null;
  pendingRetirement: PendingRetirement | null;
}>;

type PendingRegistration = Readonly<{
  deviceId: string;
  correlationId: string;
  operationId: string;
  platform: string;
  tokenFingerprint: string;
}>;

type PendingRetirement = Readonly<{
  deviceId: string;
  correlationId: string;
  operationId: string;
}>;

export type MobilePushPermissionStatus =
  "granted" | "denied" | "undetermined" | "unsupported";

export type MobilePushRegistrationResult = Readonly<{
  status:
    | "registered"
    | "retired"
    | "permission_denied"
    | "unsupported"
    | "unavailable"
    | "no_device";
  message?: string;
}>;

type NotificationModule = Pick<
  typeof Notifications,
  "getPermissionsAsync" | "requestPermissionsAsync" | "getExpoPushTokenAsync"
>;

type DeviceRegistrationApi = Pick<
  typeof mobileNotificationPreferencesApi,
  "registerDevice" | "retireDevice"
>;

type DeviceStorage = Pick<
  typeof secureSessionStorage,
  "getItem" | "setItem" | "removeItem"
>;

export type MobilePushRegistrationDependencies = Readonly<{
  api: DeviceRegistrationApi;
  notifications: NotificationModule;
  platform: string;
  storage: DeviceStorage;
  projectId: string | null;
  fingerprintToken?: (token: string) => Promise<string>;
  setAndroidNotificationChannel?: () => Promise<void>;
}>;

async function readStoredDevice(storage: DeviceStorage) {
  try {
    const raw = await storage.getItem(deviceStorageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const record = parsed as {
      deviceId?: unknown;
      userId?: unknown;
      pendingRegistration?: unknown;
      pendingRetirement?: unknown;
    };
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof record.deviceId !== "string" ||
      (record.userId !== null && typeof record.userId !== "string")
    ) {
      return null;
    }
    const pendingRegistration = record.pendingRegistration;
    const pendingRetirement = record.pendingRetirement;
    if (
      pendingRegistration !== null &&
      pendingRegistration !== undefined &&
      (typeof pendingRegistration !== "object" ||
        pendingRegistration === null ||
        typeof (pendingRegistration as PendingRegistration).deviceId !==
          "string" ||
        typeof (pendingRegistration as PendingRegistration).correlationId !==
          "string" ||
        typeof (pendingRegistration as PendingRegistration).operationId !==
          "string" ||
        typeof (pendingRegistration as PendingRegistration).platform !==
          "string" ||
        typeof (pendingRegistration as PendingRegistration).tokenFingerprint !==
          "string")
    ) {
      return null;
    }
    if (
      pendingRetirement !== null &&
      pendingRetirement !== undefined &&
      (typeof pendingRetirement !== "object" ||
        pendingRetirement === null ||
        typeof (pendingRetirement as PendingRetirement).deviceId !== "string" ||
        typeof (pendingRetirement as PendingRetirement).correlationId !==
          "string" ||
        typeof (pendingRetirement as PendingRetirement).operationId !==
          "string")
    ) {
      return null;
    }
    return {
      deviceId: record.deviceId,
      userId: record.userId ?? null,
      pendingRegistration: (pendingRegistration ??
        null) as PendingRegistration | null,
      pendingRetirement: (pendingRetirement ??
        null) as PendingRetirement | null,
    } satisfies StoredDeviceRegistration;
  } catch {
    return null;
  }
}

async function writeStoredDevice(
  storage: DeviceStorage,
  registration: StoredDeviceRegistration,
) {
  try {
    await storage.setItem(deviceStorageKey, JSON.stringify(registration));
    return true;
  } catch {
    return false;
  }
}

function isNativePlatform(platform: string) {
  return platform === "ios" || platform === "android";
}

export async function getMobilePushPermissionStatus(
  dependencies: Pick<
    MobilePushRegistrationDependencies,
    "notifications" | "platform"
  >,
): Promise<MobilePushPermissionStatus> {
  if (!isNativePlatform(dependencies.platform)) return "unsupported";
  try {
    const permission = await dependencies.notifications.getPermissionsAsync();
    return permission.status === "granted"
      ? "granted"
      : permission.status === "denied"
        ? "denied"
        : "undetermined";
  } catch {
    return "undetermined";
  }
}

export function createMobilePushRegistration(
  dependencies: MobilePushRegistrationDependencies,
) {
  return {
    async register(
      userId: string,
      options: Readonly<{ requestPermission?: boolean }> = {},
    ): Promise<MobilePushRegistrationResult> {
      if (!isNativePlatform(dependencies.platform))
        return { status: "unsupported" };
      if (!dependencies.projectId) {
        return {
          message: "Notifications aren't available in this version of the app.",
          status: "unavailable",
        };
      }

      if (
        dependencies.platform === "android" &&
        dependencies.setAndroidNotificationChannel
      ) {
        try {
          await dependencies.setAndroidNotificationChannel();
        } catch {
          return {
            message: "We couldn't set up notifications on this device.",
            status: "unavailable",
          };
        }
      }

      let permission = await getMobilePushPermissionStatus(dependencies);
      if (permission !== "granted" && options.requestPermission) {
        try {
          const requested =
            await dependencies.notifications.requestPermissionsAsync();
          permission = requested.status === "granted" ? "granted" : "denied";
        } catch {
          return {
            message: "We couldn't ask for permission to send notifications.",
            status: "unavailable",
          };
        }
      }
      if (permission !== "granted") return { status: "permission_denied" };

      let expoPushToken: string;
      try {
        const token = await dependencies.notifications.getExpoPushTokenAsync({
          projectId: dependencies.projectId,
        });
        expoPushToken = token.data;
      } catch {
        return {
          message:
            "We couldn't turn on notifications on this device. Try again later.",
          status: "unavailable",
        };
      }

      const stored = await readStoredDevice(dependencies.storage);
      const deviceId = stored?.deviceId ?? createMobileOperationId();
      let tokenFingerprint: string;
      try {
        tokenFingerprint = dependencies.fingerprintToken
          ? await dependencies.fingerprintToken(expoPushToken)
          : `${expoPushToken.length}`;
      } catch {
        return {
          message:
            "We couldn't turn on notifications on this device. Try again later.",
          status: "unavailable",
        };
      }
      const pendingRegistration = stored?.pendingRegistration;
      const pending =
        stored?.userId === userId &&
        pendingRegistration?.deviceId === deviceId &&
        pendingRegistration.platform === dependencies.platform &&
        pendingRegistration.tokenFingerprint === tokenFingerprint
          ? pendingRegistration
          : {
              correlationId: createMobileOperationId(),
              deviceId,
              operationId: createMobileOperationId(),
              platform: dependencies.platform,
              tokenFingerprint,
            };
      const persistedPending = await writeStoredDevice(dependencies.storage, {
        deviceId,
        pendingRegistration: pending,
        pendingRetirement: null,
        userId,
      });
      if (!persistedPending) {
        return {
          message:
            "We couldn't turn on notifications on this device. Try again.",
          status: "unavailable",
        };
      }
      const result = await dependencies.api.registerDevice(
        {
          deviceId,
          expoPushToken,
          platform: dependencies.platform,
        },
        {
          correlationId: pending.correlationId,
          operationId: pending.operationId,
        },
      );
      if (!result.ok) return { message: result.message, status: "unavailable" };

      await writeStoredDevice(dependencies.storage, {
        deviceId,
        pendingRegistration: null,
        pendingRetirement: null,
        userId,
      });
      return { status: "registered" };
    },

    async retire(userId: string): Promise<MobilePushRegistrationResult> {
      if (!isNativePlatform(dependencies.platform))
        return { status: "unsupported" };
      const stored = await readStoredDevice(dependencies.storage);
      if (!stored || stored.userId !== userId) return { status: "no_device" };

      const pending =
        stored.pendingRetirement?.deviceId === stored.deviceId
          ? stored.pendingRetirement
          : {
              correlationId: createMobileOperationId(),
              deviceId: stored.deviceId,
              operationId: createMobileOperationId(),
            };
      const persistedPending = await writeStoredDevice(dependencies.storage, {
        deviceId: stored.deviceId,
        pendingRegistration: null,
        pendingRetirement: pending,
        userId,
      });
      if (!persistedPending) {
        return {
          message:
            "We couldn't turn off notifications on this device. Try again.",
          status: "unavailable",
        };
      }

      const result = await dependencies.api.retireDevice(
        { deviceId: stored.deviceId },
        {
          correlationId: pending.correlationId,
          operationId: pending.operationId,
        },
      );
      if (result.ok) {
        await writeStoredDevice(dependencies.storage, {
          deviceId: stored.deviceId,
          pendingRegistration: null,
          pendingRetirement: null,
          userId: null,
        });
      }
      return result.ok
        ? { status: "retired" }
        : { message: result.message, status: "unavailable" };
    },
  };
}
