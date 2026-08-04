import { describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/lib/auth/password-recovery-registry", () => ({
  resolvePasswordRecoveryState: vi.fn(),
}));
vi.mock("../apps/web/src/lib/auth/verified-session-claims", () => ({
  resolveVerifiedSessionClaims: vi.fn(),
}));
vi.mock("../apps/web/src/lib/supabase/server-component-client", () => ({
  createServerComponentSupabaseClient: vi.fn(),
}));

import { resolveAccountPageSession } from "../apps/web/src/lib/auth/account-page-session";

const user = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "member@example.test",
  email_confirmed_at: "2026-07-27T00:00:00.000Z",
  last_sign_in_at: "2026-08-04T12:00:00.000Z",
};
const claims = { session_id: "session-1", sub: user.id };

function client() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  };
}

describe("account page session boundary", () => {
  it.each(["active", "expired", "consumed", "claimed"] as const)(
    "blocks %s recovery sessions before rendering account controls",
    async (recoveryState) => {
      const result = await resolveAccountPageSession({
        createClient: vi.fn().mockResolvedValue(client()) as never,
        resolveClaims: vi.fn().mockResolvedValue(claims),
        resolveRecoveryState: vi.fn().mockResolvedValue(recoveryState),
      });

      expect(result.state).toBe(
        recoveryState === "active" ? "recovery_active" : "recovery_restricted",
      );
    },
  );

  it("returns the verified e-mail only for a regular session", async () => {
    const result = await resolveAccountPageSession({
      createClient: vi.fn().mockResolvedValue(client()) as never,
      resolveClaims: vi.fn().mockResolvedValue(claims),
      resolveRecoveryState: vi.fn().mockResolvedValue("none"),
    });

    expect(result).toEqual({
      state: "ready",
      email: user.email,
      lastSignInAt: user.last_sign_in_at,
    });
  });

  it("fails closed when verified claims do not match the Auth user", async () => {
    const result = await resolveAccountPageSession({
      createClient: vi.fn().mockResolvedValue(client()) as never,
      resolveClaims: vi
        .fn()
        .mockResolvedValue({ ...claims, sub: "other-user" }),
      resolveRecoveryState: vi.fn(),
    });

    expect(result).toEqual({ state: "unavailable" });
  });
});
