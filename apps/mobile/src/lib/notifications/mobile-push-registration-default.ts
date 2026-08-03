import Constants from "expo-constants";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { secureSessionStorage } from "../auth/secure-session-storage";
import { mobileNotificationPreferencesApi } from "./mobile-notification-preferences-api";
import {
  createMobilePushRegistration,
  getMobilePushPermissionStatus as getPermissionStatus,
  type MobilePushPermissionStatus,
  type MobilePushRegistrationDependencies,
} from "./mobile-push-registration";

export type { MobilePushPermissionStatus } from "./mobile-push-registration";

function projectId() {
  const value = Constants.expoConfig?.extra?.eas?.projectId;
  return typeof value === "string" && value.trim() ? value : null;
}

const dependencies: MobilePushRegistrationDependencies = {
  api: mobileNotificationPreferencesApi,
  notifications: Notifications,
  platform: Platform.OS,
  projectId: projectId(),
  storage: secureSessionStorage,
  fingerprintToken: (token) =>
    digestStringAsync(CryptoDigestAlgorithm.SHA256, token),
  setAndroidNotificationChannel: () =>
    Notifications.setNotificationChannelAsync("greenroster-rounds", {
      importance: Notifications.AndroidImportance.DEFAULT,
      name: "GreenRoster rounds",
      sound: "default",
    }).then(() => undefined),
};

export const mobilePushRegistration =
  createMobilePushRegistration(dependencies);

export function getMobilePushPermissionStatus(): Promise<MobilePushPermissionStatus> {
  return getPermissionStatus(dependencies);
}

export async function retireCurrentMobilePushDevice(userId: string) {
  return mobilePushRegistration.retire(userId);
}
