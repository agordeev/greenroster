import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSession: vi.fn(),
}));

vi.mock("../apps/web/src/lib/auth/account-page-session", () => ({
  resolveAccountPageSession: mocks.resolveSession,
}));
vi.mock("../apps/web/src/lib/runtime-env", () => ({
  webRuntimeEnv: { supportEmail: "privacy@example.test" },
}));

import PrivacyRequestsPage from "../apps/web/src/app/account/privacy/page";

describe("privacy requests page", () => {
  it("renders both support-routed requests for a regular authenticated session", async () => {
    mocks.resolveSession.mockResolvedValueOnce({
      state: "ready",
      email: "member@example.test",
      sessionStartedAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const page = await PrivacyRequestsPage();
    const seen = new WeakSet<object>();
    const pageText = JSON.stringify(page, (_key, value: unknown) => {
      if (typeof value !== "object" || value === null) return value;
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      return value;
    });

    expect(pageText).toContain("Privacy requests");
    expect(pageText).toContain("GreenRoster%20data%20access%20request");
    expect(pageText).toContain("GreenRoster%20account%20deletion%20request");
    expect(pageText).toContain("privacy@example.test");
  });
});
