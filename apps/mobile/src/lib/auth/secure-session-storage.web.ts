import { createChunkedSessionStorage } from "./chunked-session-storage";

const sessionValues = new Map<string, string>();

const memoryDriver = {
  async getItem(key: string) {
    return sessionValues.get(key) ?? null;
  },
  async removeItem(key: string) {
    sessionValues.delete(key);
  },
  async setItem(key: string, value: string) {
    sessionValues.set(key, value);
  },
};

export const secureSessionStorage = createChunkedSessionStorage(memoryDriver);

const recoveryRequirementKey = "greenroster.auth.recovery-required";
const pendingLinkKey = "greenroster.auth.pending-link";

export const pendingLinkStorage = {
  clear() {
    return memoryDriver.removeItem(pendingLinkKey);
  },
  get() {
    return memoryDriver.getItem(pendingLinkKey);
  },
  set(url: string) {
    return memoryDriver.setItem(pendingLinkKey, url);
  },
  async take() {
    const url = await memoryDriver.getItem(pendingLinkKey);
    await memoryDriver.removeItem(pendingLinkKey);
    return url;
  },
};

export const recoveryRequirementStorage = {
  async clear() {
    await memoryDriver.removeItem(recoveryRequirementKey);
  },
  async isRequired() {
    return (await memoryDriver.getItem(recoveryRequirementKey)) === "required";
  },
  async require() {
    await memoryDriver.setItem(recoveryRequirementKey, "required");
  },
};
