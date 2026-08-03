import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/mobile-operation-id", () => ({
  createMobileOperationId: vi.fn(() => "40000000-0000-4000-8000-000000000001"),
}));
vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { auth: {} },
}));
vi.mock("../apps/mobile/src/lib/runtime-env", () => ({
  mobileRuntimeEnv: { appUrl: "https://greenroster.rapidlabs.dev" },
}));

import { createMobileAccountEmailActions } from "../apps/mobile/src/lib/auth/mobile-account-email-actions";

type AuthClient = Parameters<typeof createMobileAccountEmailActions>[0];
type ApiClient = Parameters<typeof createMobileAccountEmailActions>[1];

const correlationId = "40000000-0000-4000-8000-000000000001";

function createAuthClient() {
  return {
    getSession: vi.fn(),
    refreshSession: vi.fn(),
  } as unknown as AuthClient;
}

function createApiClient() {
  return {
    requestEmailChange: vi.fn(),
  } as unknown as ApiClient;
}

describe("mobile account e-mail actions", () => {
  let auth: ReturnType<typeof createAuthClient>;
  let api: ReturnType<typeof createApiClient>;

  beforeEach(() => {
    auth = createAuthClient();
    api = createApiClient();
  });

  it("normalizes the address and sends only the access token to the API client", async () => {
    vi.mocked(auth.getSession).mockResolvedValue({
      data: { session: { access_token: "private-access-token" } },
      error: null,
    } as never);
    vi.mocked(api.requestEmailChange).mockResolvedValue({
      correlationId,
      ok: true,
      status: "pending",
    });

    const result = await createMobileAccountEmailActions(
      auth,
      api,
    ).requestEmailChange(" Old@Example.COM ", " New@Example.COM ", true);

    expect(api.requestEmailChange).toHaveBeenCalledWith(
      "private-access-token",
      "new@example.com",
      true,
      expect.any(String),
    );
    expect(result).toMatchObject({ status: "pending", field: null });
    expect(result.message).toContain("verification flow");
    expect(result.message).toContain("stays unchanged");
    expect("updateUser" in auth).toBe(false);
  });

  it("validates the address, prevents same-address changes, and requires confirmation", async () => {
    const actions = createMobileAccountEmailActions(auth, api);

    await expect(
      actions.requestEmailChange("member@example.com", "invalid", true),
    ).resolves.toMatchObject({ field: "email", status: "error" });
    await expect(
      actions.requestEmailChange(
        " Member@Example.COM ",
        "member@example.com",
        true,
      ),
    ).resolves.toMatchObject({ field: "email", status: "error" });
    await expect(
      actions.requestEmailChange(
        "member@example.com",
        "new@example.com",
        false,
      ),
    ).resolves.toMatchObject({ field: "confirmation", status: "error" });

    expect(auth.getSession).not.toHaveBeenCalled();
    expect(api.requestEmailChange).not.toHaveBeenCalled();
  });

  it("maps safe API statuses without exposing provider details", async () => {
    vi.mocked(auth.getSession).mockResolvedValue({
      data: { session: { access_token: "private-access-token" } },
      error: null,
    } as never);
    const actions = createMobileAccountEmailActions(auth, api);

    vi.mocked(api.requestEmailChange).mockResolvedValueOnce({
      code: "rate_limited",
      correlationId,
      ok: false,
    });
    await expect(
      actions.requestEmailChange("old@example.com", "one@example.com", true),
    ).resolves.toMatchObject({
      message: "Too many attempts. Wait a moment and try again.",
      status: "error",
    });

    vi.mocked(api.requestEmailChange).mockResolvedValueOnce({
      code: "validation",
      correlationId,
      fieldErrors: { email: ["Enter another account e-mail."] },
      ok: false,
    });
    const duplicateAddressResult = actions.requestEmailChange(
      "old@example.com",
      "two@example.com",
      true,
    );
    await expect(duplicateAddressResult).resolves.toMatchObject({
      message: "Enter another account e-mail.",
      status: "error",
    });
    expect((await duplicateAddressResult).message).not.toMatch(
      /already registered|old@example.com|two@example.com/i,
    );

    vi.mocked(api.requestEmailChange).mockResolvedValueOnce({
      code: "forbidden",
      correlationId,
      ok: false,
    });
    await expect(
      actions.requestEmailChange("old@example.com", "three@example.com", true),
    ).resolves.toMatchObject({
      message: expect.stringContaining("Password recovery sessions"),
      status: "error",
    });

    vi.mocked(api.requestEmailChange).mockRejectedValueOnce(
      new Error("provider connection details"),
    );
    await expect(
      actions.requestEmailChange("old@example.com", "four@example.com", true),
    ).resolves.toMatchObject({
      correlationId,
      message:
        "The account e-mail service could not be reached. Check your connection and try again.",
      status: "error",
    });
  });

  it("does not expose a support reference before an Auth request is sent", async () => {
    vi.mocked(auth.getSession).mockRejectedValueOnce(
      new Error("session unavailable"),
    );

    const result = await createMobileAccountEmailActions(
      auth,
      api,
    ).requestEmailChange("old@example.com", "new@example.com", true);
    expect(result).toMatchObject({
      message:
        "The account e-mail service could not be reached. Check your connection and try again.",
      status: "error",
    });
    expect(result).not.toHaveProperty("correlationId");
    expect(api.requestEmailChange).not.toHaveBeenCalled();
  });

  it("refreshes the real Auth session and reports safe refresh failures", async () => {
    const actions = createMobileAccountEmailActions(auth, api);
    vi.mocked(auth.refreshSession)
      .mockResolvedValueOnce({
        data: { session: { user: { email: "new@example.com" } } },
        error: null,
      } as never)
      .mockResolvedValueOnce({
        data: { session: null },
        error: { status: 503 },
      } as never);

    await expect(actions.refreshSession()).resolves.toMatchObject({
      message: "Account e-mail status refreshed.",
      status: "success",
    });
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    await expect(actions.refreshSession()).resolves.toMatchObject({
      message:
        "Your signed-in session is unavailable. Sign in again and try again.",
      status: "error",
    });
  });
});
