import { beforeEach, describe, expect, it } from "vitest";

import { pendingLinkStorage } from "../apps/mobile/src/lib/auth/secure-session-storage.web";

describe("pending mobile link persistence", () => {
  beforeEach(async () => {
    await pendingLinkStorage.clear();
  });

  it("survives a later read and is consumed exactly once", async () => {
    const link = "greenroster://rounds";
    await pendingLinkStorage.set(link);

    expect(await pendingLinkStorage.get()).toBe(link);
    expect(await pendingLinkStorage.take()).toBe(link);
    expect(await pendingLinkStorage.take()).toBeNull();
  });
});
