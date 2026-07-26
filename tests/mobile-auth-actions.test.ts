import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { auth: {} },
}));

import { createMobileAuthActions } from "../apps/mobile/src/lib/auth/mobile-auth-actions";

type AuthClient = Parameters<typeof createMobileAuthActions>[0];

function createAuthClient() {
  return {
    resetPasswordForEmail: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } as unknown as AuthClient;
}

describe("mobile sign-in actions", () => {
  let auth: ReturnType<typeof createAuthClient>;

  beforeEach(() => {
    auth = createAuthClient();
  });

  it("normalizes credentials and accepts a confirmed person", async () => {
    vi.mocked(auth.signInWithPassword).mockResolvedValue({
      data: {
        session: null,
        user: { email_confirmed_at: "2026-07-26T00:00:00Z" },
      },
      error: null,
    } as never);

    const result = await createMobileAuthActions(auth).signIn(
      " MEMBER@Example.COM ",
      "secret",
    );

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "secret",
    });
    expect(result.status).toBe("success");
  });

  it("rejects invalid fields before calling Auth", async () => {
    const actions = createMobileAuthActions(auth);

    await expect(actions.signIn("invalid", "secret")).resolves.toMatchObject({
      field: "email",
      status: "error",
    });
    await expect(
      actions.signIn("member@example.com", ""),
    ).resolves.toMatchObject({ field: "password", status: "error" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("uses non-enumerating credential and rate-limit errors", async () => {
    vi.mocked(auth.signInWithPassword)
      .mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { status: 400 },
      } as never)
      .mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { status: 429 },
      } as never);
    const actions = createMobileAuthActions(auth);

    await expect(
      actions.signIn("missing@example.com", "wrong"),
    ).resolves.toMatchObject({
      message: "The e-mail or password could not be verified.",
    });
    await expect(
      actions.signIn("member@example.com", "wrong"),
    ).resolves.toMatchObject({
      message: "Too many attempts. Wait a moment and try again.",
    });
  });

  it("reports sign-in provider failures as service errors", async () => {
    vi.mocked(auth.signInWithPassword).mockResolvedValue({
      data: { session: null, user: null },
      error: { status: 503 },
    } as never);

    await expect(
      createMobileAuthActions(auth).signIn("member@example.com", "secret"),
    ).resolves.toMatchObject({
      message: "The sign-in service could not be reached. Try again.",
      status: "error",
    });
  });

  it("locally signs out an unconfirmed identity", async () => {
    vi.mocked(auth.signInWithPassword).mockResolvedValue({
      data: { session: null, user: { email_confirmed_at: null } },
      error: null,
    } as never);

    await expect(
      createMobileAuthActions(auth).signIn("member@example.com", "secret"),
    ).resolves.toMatchObject({
      message: "Verify your account e-mail before signing in.",
      status: "error",
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("uses a connection error when the provider cannot be reached", async () => {
    vi.mocked(auth.signInWithPassword).mockRejectedValue(
      new Error("network details"),
    );

    await expect(
      createMobileAuthActions(auth).signIn("member@example.com", "secret"),
    ).resolves.toMatchObject({
      message:
        "The sign-in service could not be reached. Check your connection and try again.",
      status: "error",
    });
  });
});

describe("mobile recovery actions", () => {
  it("uses the exact app callback and returns neutral success", async () => {
    const auth = createAuthClient();
    vi.mocked(auth.resetPasswordForEmail).mockResolvedValue({
      data: {},
      error: { status: 400 },
    } as never);

    const result = await createMobileAuthActions(auth).requestPasswordRecovery(
      " MEMBER@Example.COM ",
    );

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "member@example.com",
      { redirectTo: "greenroster://auth/callback" },
    );
    expect(result).toMatchObject({
      message:
        "If the address belongs to an account, password recovery instructions are on the way.",
      status: "success",
    });
  });

  it("distinguishes rate limiting without exposing account existence", async () => {
    const auth = createAuthClient();
    vi.mocked(auth.resetPasswordForEmail).mockResolvedValue({
      data: {},
      error: { status: 429 },
    } as never);

    await expect(
      createMobileAuthActions(auth).requestPasswordRecovery(
        "member@example.com",
      ),
    ).resolves.toMatchObject({
      message: "Too many attempts. Wait a moment and try again.",
      status: "error",
    });
  });

  it("maps provider failures without leaking provider details", async () => {
    const auth = createAuthClient();
    vi.mocked(auth.resetPasswordForEmail).mockResolvedValue({
      data: {},
      error: { status: 503 },
    } as never);

    await expect(
      createMobileAuthActions(auth).requestPasswordRecovery(
        "member@example.com",
      ),
    ).resolves.toMatchObject({
      message: "The recovery service could not be reached. Try again.",
      status: "error",
    });
  });

  it("reports validation and connection failures safely", async () => {
    const auth = createAuthClient();
    const actions = createMobileAuthActions(auth);

    await expect(
      actions.requestPasswordRecovery("invalid"),
    ).resolves.toMatchObject({ field: "email", status: "error" });
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();

    vi.mocked(auth.resetPasswordForEmail).mockRejectedValue(
      new Error("provider details"),
    );
    await expect(
      actions.requestPasswordRecovery("member@example.com"),
    ).resolves.toMatchObject({
      message:
        "The recovery service could not be reached. Check your connection and try again.",
      status: "error",
    });
  });
});

describe("mobile sign-out action", () => {
  it("uses local scope so only this device session is cleared", async () => {
    const auth = createAuthClient();

    await expect(
      createMobileAuthActions(auth).signOut(),
    ).resolves.toMatchObject({ status: "success" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("returns a safe retry message when local sign-out fails", async () => {
    const auth = createAuthClient();
    vi.mocked(auth.signOut).mockRejectedValue(new Error("provider details"));

    await expect(
      createMobileAuthActions(auth).signOut(),
    ).resolves.toMatchObject({
      message: "GreenRoster could not sign out. Try again.",
      status: "error",
    });
  });
});
