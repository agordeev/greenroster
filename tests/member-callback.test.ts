import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  resolveClaims: vi.fn(),
}));

vi.mock("../apps/web/src/lib/supabase/server-action-client", () => ({
  createServerActionSupabaseClient: async () => ({
    auth: {
      verifyOtp: mocks.verifyOtp,
      signOut: mocks.signOut,
    },
  }),
}));
vi.mock("../apps/web/src/lib/auth/verified-session-claims", () => ({
  resolveVerifiedSessionClaims: mocks.resolveClaims,
}));
vi.mock("../apps/web/src/lib/runtime-env", () => ({
  webRuntimeEnv: { appUrl: "https://greenroster.example" },
}));

import { GET, POST } from "../apps/web/src/app/auth/member-callback/route";

const userId = "70000000-0000-4000-8000-000000000006";
const roundId = "70000000-0000-4000-8000-000000000004";
const tokenHash = "hash-member-example-1234567890";
const destination = `/member/results?round_id=${roundId}`;

function postRequest(payload: Record<string, unknown> = {}) {
  return new Request("https://greenroster.example/auth/member-callback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token_hash: tokenHash,
      type: "magiclink",
      next: destination,
      ...payload,
    }),
  });
}

describe("member magic-link callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyOtp.mockResolvedValue({
      data: {
        session: { access_token: "access-token" },
        user: { id: userId, email_confirmed_at: "2026-08-10T12:00:00.000Z" },
      },
      error: null,
    });
    mocks.resolveClaims.mockResolvedValue({
      exp: 1_900_000_000,
      session_id: "70000000-0000-4000-8000-000000000008",
      sub: userId,
    });
  });

  it("does not consume the fragment token on the initial GET", async () => {
    const response = await GET();
    const html = await response.text();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain('method: "POST"');
    expect(html).not.toContain(tokenHash);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("verifies the one-time token only after the same-origin POST", async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      redirectTo: `https://greenroster.example${destination}`,
    });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: tokenHash,
      type: "magiclink",
    });
    expect(mocks.resolveClaims).toHaveBeenCalledWith(
      expect.anything(),
      "access-token",
    );
  });

  it("rejects replay/wrong-type links without invoking Auth", async () => {
    const response = await POST(postRequest({ type: "recovery" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      redirectTo: `https://greenroster.example/sign-in?status=member-link-expired&next=${encodeURIComponent(destination)}`,
    });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("preserves a safe member destination on verification failure", async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "expired" },
    });
    const response = await POST(postRequest());

    expect(await response.json()).toEqual({
      ok: false,
      redirectTo: `https://greenroster.example/sign-in?status=member-link-expired&next=${encodeURIComponent(destination)}`,
    });
  });

  it("does not redirect when verified claims do not match the Auth user", async () => {
    mocks.resolveClaims.mockResolvedValue(null);
    const response = await POST(postRequest());

    expect(await response.json()).toEqual({
      ok: false,
      redirectTo: `https://greenroster.example/sign-in?status=member-link-unavailable&next=${encodeURIComponent(destination)}`,
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("rejects hostile destinations before token verification", async () => {
    const response = await POST(
      postRequest({ next: "https://attacker.example/member/results" }),
    );

    expect(await response.json()).toEqual({
      ok: false,
      redirectTo:
        "https://greenroster.example/sign-in?status=member-link-expired",
    });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});
