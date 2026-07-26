import { beforeEach, describe, expect, it } from "vitest";

import {
  pendingLinkStorage,
  recoveryHandleStorage,
} from "../apps/mobile/src/lib/auth/secure-session-storage.web";
import {
  hasArrivedAtMobilePendingDestination,
  resumeMobilePendingDestination,
} from "../apps/mobile/src/lib/auth/mobile-pending-destination";

const canonicalOrigin = "https://greenroster.test";

describe("pending mobile link persistence", () => {
  beforeEach(async () => {
    await pendingLinkStorage.clear();
    await recoveryHandleStorage.clear();
  });

  it("survives a later read and is consumed exactly once", async () => {
    const link = "greenroster://rounds";
    await pendingLinkStorage.set(link);

    expect(await pendingLinkStorage.get()).toBe(link);
    expect(await pendingLinkStorage.take()).toBe(link);
    expect(await pendingLinkStorage.take()).toBeNull();
  });

  it("survives sign-in, first-run, and a remount until the destination renders", async () => {
    const link = "greenroster://rounds";
    await pendingLinkStorage.set(link);

    const afterSignIn = await resumeMobilePendingDestination(
      null,
      pendingLinkStorage,
      canonicalOrigin,
    );
    expect(afterSignIn).toBe("/rounds");
    expect(
      hasArrivedAtMobilePendingDestination(afterSignIn, "/auth/first-run"),
    ).toBe(false);
    expect(await pendingLinkStorage.get()).toBe(link);

    const afterFirstRunRemount = await resumeMobilePendingDestination(
      null,
      pendingLinkStorage,
      canonicalOrigin,
    );
    expect(afterFirstRunRemount).toBe("/rounds");
    expect(
      hasArrivedAtMobilePendingDestination(afterFirstRunRemount, "/rounds"),
    ).toBe(true);
    expect(await pendingLinkStorage.get()).toBe(link);

    await pendingLinkStorage.clear();
    expect(await pendingLinkStorage.get()).toBeNull();
  });

  it("provides the same recovery-handle contract as native storage", async () => {
    await recoveryHandleStorage.set("opaque-recovery-handle");

    expect(await recoveryHandleStorage.get()).toBe("opaque-recovery-handle");
    await recoveryHandleStorage.clear();
    expect(await recoveryHandleStorage.get()).toBeNull();
  });
});
