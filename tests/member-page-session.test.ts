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

import { resolveMemberPageSession } from "../apps/web/src/lib/auth/member-page-session";

const user = {
  id: "10000000-0000-4000-8000-000000000001",
  email_confirmed_at: "2026-07-26T00:00:00.000Z",
};
const claims = { session_id: "session-1", sub: user.id };

function client(role: "member" | "coordinator" | "administrator" = "member") {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    rpc: vi.fn().mockResolvedValue({
      data: [
        {
          group_id: "20000000-0000-4000-8000-000000000001",
          role,
        },
      ],
      error: null,
    }),
  };
}

describe("member page session boundary", () => {
  it.each(["active", "expired", "consumed", "claimed"] as const)(
    "blocks %s recovery sessions before resolving membership context",
    async (recoveryState) => {
      const supabase = client();
      const result = await resolveMemberPageSession({
        createClient: () => supabase as never,
        resolveClaims: vi.fn().mockResolvedValue(claims),
        resolveRecoveryState: vi.fn().mockResolvedValue(recoveryState),
      });

      expect(result.state).toBe(
        recoveryState === "active" ? "recovery_active" : "recovery_restricted",
      );
      expect(supabase.rpc).not.toHaveBeenCalled();
    },
  );

  it.each(["coordinator", "administrator"] as const)(
    "redirects the %s role to the portal",
    async (role) => {
      const supabase = client(role);
      const result = await resolveMemberPageSession({
        createClient: () => supabase as never,
        resolveClaims: vi.fn().mockResolvedValue(claims),
        resolveRecoveryState: vi.fn().mockResolvedValue("none"),
      });

      expect(result).toEqual({ state: "role_redirect" });
      expect(supabase.rpc).toHaveBeenCalledWith("resolve_identity_context");
    },
  );

  it("returns the trusted group only for a regular member session", async () => {
    const supabase = client("member");
    const result = await resolveMemberPageSession({
      createClient: () => supabase as never,
      resolveClaims: vi.fn().mockResolvedValue(claims),
      resolveRecoveryState: vi.fn().mockResolvedValue("none"),
    });

    expect(result.state).toBe("ready");
    if (result.state === "ready") {
      expect(result.groupId).toBe("20000000-0000-4000-8000-000000000001");
    }
  });
});
