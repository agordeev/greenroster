import * as SecureStore from "expo-secure-store";

import { createChunkedSessionStorage } from "./chunked-session-storage";

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const secureStoreDriver = {
  getItem(key: string) {
    return SecureStore.getItemAsync(key, secureStoreOptions);
  },
  removeItem(key: string) {
    return SecureStore.deleteItemAsync(key, secureStoreOptions);
  },
  setItem(key: string, value: string) {
    return SecureStore.setItemAsync(key, value, secureStoreOptions);
  },
};

export const secureSessionStorage =
  createChunkedSessionStorage(secureStoreDriver);

const recoveryRequirementKey = "greenroster.auth.recovery-required";

export const recoveryRequirementStorage = {
  async clear() {
    await secureStoreDriver.removeItem(recoveryRequirementKey);
  },
  async isRequired() {
    return (
      (await secureStoreDriver.getItem(recoveryRequirementKey)) === "required"
    );
  },
  async require() {
    await secureStoreDriver.setItem(recoveryRequirementKey, "required");
  },
};
