import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { auth: {} },
}));
vi.mock("../apps/mobile/src/lib/auth/mobile-recovery-api", () => ({
  mobileRecoveryApi: {},
}));

import { createMobileAuthActions } from "../apps/mobile/src/lib/auth/mobile-auth-actions";

type AuthClient = Parameters<typeof createMobileAuthActions>[0];

function createAuthClient() {
  return {
    signInWithPassword: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } as unknown as AuthClient;
}

function createRecoveryClient() {
  return {
    requestPasswordRecovery: vi.fn().mockResolvedValue({
      correlationId: "40000000-0000-4000-8000-000000000101",
      ok: true,
      state: "requested",
    }),
  } as unknown as Parameters<typeof createMobileAuthActions>[1];
}

function createActions(auth: AuthClient, recovery = createRecoveryClient()) {
  return createMobileAuthActions(auth, recovery);
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

    const result = await createActions(auth).signIn(
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
    const actions = createActions(auth);

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
    const actions = createActions(auth);

    await expect(
      actions.signIn("missing@example.com", "wrong"),
    ).resolves.toMatchObject({
      message: "Check your e-mail and password, then try again.",
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
      createActions(auth).signIn("member@example.com", "secret"),
    ).resolves.toMatchObject({
      message: "We couldn't sign you in. Try again.",
      status: "error",
    });
  });

  it("locally signs out an unconfirmed identity", async () => {
    vi.mocked(auth.signInWithPassword).mockResolvedValue({
      data: { session: null, user: { email_confirmed_at: null } },
      error: null,
    } as never);

    await expect(
      createActions(auth).signIn("member@example.com", "secret"),
    ).resolves.toMatchObject({
      message: "Confirm your e-mail address before you sign in.",
      status: "error",
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("uses a connection error when the provider cannot be reached", async () => {
    vi.mocked(auth.signInWithPassword).mockRejectedValue(
      new Error("network details"),
    );

    await expect(
      createActions(auth).signIn("member@example.com", "secret"),
    ).resolves.toMatchObject({
      message: "We couldn't sign you in. Check your connection and try again.",
      status: "error",
    });
  });
});

describe("mobile recovery actions", () => {
  it("normalizes the e-mail and returns neutral success", async () => {
    const auth = createAuthClient();
    const recovery = createRecoveryClient();

    const result = await createActions(auth, recovery).requestPasswordRecovery(
      " MEMBER@Example.COM ",
    );

    expect(recovery.requestPasswordRecovery).toHaveBeenCalledWith(
      "member@example.com",
    );
    expect(result).toMatchObject({
      message: "If you have an account, a recovery link is on its way.",
      status: "success",
    });
  });

  it("distinguishes rate limiting without exposing account existence", async () => {
    const auth = createAuthClient();
    const recovery = createRecoveryClient();
    vi.mocked(recovery.requestPasswordRecovery).mockResolvedValue({
      code: "rate_limited",
      correlationId: "40000000-0000-4000-8000-000000000101",
      ok: false,
    });

    await expect(
      createActions(auth, recovery).requestPasswordRecovery(
        "member@example.com",
      ),
    ).resolves.toMatchObject({
      message: "Too many attempts. Wait a moment and try again.",
      status: "error",
    });
  });

  it("maps provider failures without leaking provider details", async () => {
    const auth = createAuthClient();
    const recovery = createRecoveryClient();
    vi.mocked(recovery.requestPasswordRecovery).mockResolvedValue({
      code: "unavailable",
      correlationId: "40000000-0000-4000-8000-000000000101",
      ok: false,
    });

    await expect(
      createActions(auth, recovery).requestPasswordRecovery(
        "member@example.com",
      ),
    ).resolves.toMatchObject({
      message:
        "We couldn't send your recovery link. Check your connection and try again.",
      status: "error",
    });
  });

  it("reports validation and connection failures safely", async () => {
    const auth = createAuthClient();
    const recovery = createRecoveryClient();
    const actions = createActions(auth, recovery);

    await expect(
      actions.requestPasswordRecovery("invalid"),
    ).resolves.toMatchObject({ field: "email", status: "error" });
    expect(recovery.requestPasswordRecovery).not.toHaveBeenCalled();

    vi.mocked(recovery.requestPasswordRecovery).mockRejectedValue(
      new Error("provider details"),
    );
    await expect(
      actions.requestPasswordRecovery("member@example.com"),
    ).resolves.toMatchObject({
      message:
        "We couldn't send your recovery link. Check your connection and try again.",
      status: "error",
    });
  });
});

describe("mobile sign-out action", () => {
  it("uses local scope so only this device session is cleared", async () => {
    const auth = createAuthClient();

    await expect(createActions(auth).signOut()).resolves.toMatchObject({
      status: "success",
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("returns a safe retry message when local sign-out fails", async () => {
    const auth = createAuthClient();
    vi.mocked(auth.signOut).mockRejectedValue(new Error("provider details"));

    await expect(createActions(auth).signOut()).resolves.toMatchObject({
      message: "We couldn't sign you out. Try again.",
      status: "error",
    });
  });
});
