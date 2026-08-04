import { describe, expect, it } from "vitest";

import {
  hasRecentPrivacyAuthentication,
  PRIVACY_REQUEST_RECENT_AUTH_WINDOW_MS,
} from "../apps/web/src/lib/privacy/privacy-request-auth";

describe("privacy request authentication freshness", () => {
  const now = Date.parse("2026-08-04T12:15:00.000Z");

  it("accepts a verified sign-in inside the fifteen-minute window", () => {
    expect(
      hasRecentPrivacyAuthentication("2026-08-04T12:00:00.000Z", now),
    ).toBe(true);
    expect(PRIVACY_REQUEST_RECENT_AUTH_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  it.each([
    null,
    "not-a-timestamp",
    "2026-08-04T11:59:59.999Z",
    "2026-08-04T12:16:00.000Z",
  ])("rejects stale or invalid sign-in %s", (lastSignInAt) => {
    expect(hasRecentPrivacyAuthentication(lastSignInAt, now)).toBe(false);
  });
});
