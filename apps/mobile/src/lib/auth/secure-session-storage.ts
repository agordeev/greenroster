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
const recoveryHandleKey = "greenroster.auth.recovery-handle";
const pendingLinkKey = "greenroster.auth.pending-link";

export const pendingLinkStorage = {
  clear() {
    return secureStoreDriver.removeItem(pendingLinkKey);
  },
  get() {
    return secureStoreDriver.getItem(pendingLinkKey);
  },
  set(url: string) {
    return secureStoreDriver.setItem(pendingLinkKey, url);
  },
  async take() {
    const url = await secureStoreDriver.getItem(pendingLinkKey);
    await secureStoreDriver.removeItem(pendingLinkKey);
    return url;
  },
};

export const recoveryHandleStorage = {
  clear() {
    return secureStoreDriver.removeItem(recoveryHandleKey);
  },
  get() {
    return secureStoreDriver.getItem(recoveryHandleKey);
  },
  set(handle: string) {
    return secureStoreDriver.setItem(recoveryHandleKey, handle);
  },
};

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
