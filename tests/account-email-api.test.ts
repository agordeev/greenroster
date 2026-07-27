import { describe, expect, it, vi } from "vitest";

import { POST } from "../apps/web/src/app/api/auth/account-email/route";
import { createAccountEmailProviderUpdater } from "../apps/web/src/lib/auth/account-email-api";
import {
  handleAccountEmailRequest,
  type AccountEmailApiDependencies,
} from "../apps/web/src/lib/auth/account-email-api-core";

const userId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const correlationId = "40000000-0000-4000-8000-000000000001";
const accessToken = "private-access-token";

function request(body: unknown, authorization = `Bearer ${accessToken}`) {
  return new Request("https://app.example.com/api/auth/account-email", {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      authorization,
      "content-type": "application/json",
      "x-correlation-id": correlationId,
    },
    method: "POST",
  });
}

function createDependencies(
  overrides: Partial<AccountEmailApiDependencies> = {},
): AccountEmailApiDependencies {
  return {
    requestProviderUpdate: vi.fn().mockResolvedValue({ status: 200 }),
    resolveRecoveryState: vi.fn().mockResolvedValue("none"),
    verifyAccessToken: vi.fn().mockResolvedValue({
      kind: "verified",
      session: {
        accessToken,
        currentEmail: "old@example.com",
        sessionId,
        userId,
      },
    }),
    ...overrides,
  };
}

describe("account e-mail route", () => {
  it("requires a bearer access token before parsing or calling Auth", async () => {
    const dependencies = createDependencies({
      verifyAccessToken: vi
        .fn()
        .mockResolvedValue({ kind: "authentication_required" }),
    });
    const response = await handleAccountEmailRequest(
      request({ email: "new@example.com", confirmed: true }, "Basic token"),
      dependencies,
    );

    expect(response.status).toBe(401);
    expect(dependencies.resolveRecoveryState).not.toHaveBeenCalled();
    expect(dependencies.requestProviderUpdate).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "authentication_required",
      correlationId,
      ok: false,
    });
  });

  it("rejects every password recovery registry state except none", async () => {
    for (const state of ["active", "claimed", "expired", "consumed"] as const) {
      const dependencies = createDependencies({
        resolveRecoveryState: vi.fn().mockResolvedValue(state),
      });
      const response = await handleAccountEmailRequest(
        request({ email: "new@example.com", confirmed: true }),
        dependencies,
      );
      expect(response.status).toBe(403);
      expect(dependencies.requestProviderUpdate).not.toHaveBeenCalled();
    }
  });

  it("normalizes and validates the address and explicit confirmation server-side", async () => {
    const dependencies = createDependencies();
    const pending = await handleAccountEmailRequest(
      request({ confirmed: true, email: " New.Address@Example.TEST " }),
      dependencies,
    );
    expect(pending.status).toBe(200);
    expect(dependencies.requestProviderUpdate).toHaveBeenCalledWith({
      accessToken,
      email: "new.address@example.test",
    });

    const invalid = await handleAccountEmailRequest(
      request({ confirmed: false, email: "new@example.com" }),
      dependencies,
    );
    expect(invalid.status).toBe(400);
    const invalidBody = await invalid.json();
    expect(invalidBody).toMatchObject({ code: "validation", ok: false });
    expect(invalidBody.fieldErrors).toHaveProperty("confirmed");

    const same = await handleAccountEmailRequest(
      request({ confirmed: true, email: " OLD@Example.COM " }),
      dependencies,
    );
    expect(same.status).toBe(400);
    expect(await same.json()).toMatchObject({
      code: "validation",
      fieldErrors: { email: ["Enter a different account e-mail."] },
      ok: false,
    });
  });

  it("maps provider and recovery lookup failures to safe statuses", async () => {
    const rateLimited = await handleAccountEmailRequest(
      request({ confirmed: true, email: "new@example.com" }),
      createDependencies({
        requestProviderUpdate: vi.fn().mockResolvedValue({ status: 429 }),
      }),
    );
    expect(rateLimited.status).toBe(429);

    const providerFailure = await handleAccountEmailRequest(
      request({ confirmed: true, email: "new@example.com" }),
      createDependencies({
        requestProviderUpdate: vi.fn().mockResolvedValue({ status: 503 }),
      }),
    );
    expect(providerFailure.status).toBe(503);

    const expiredBearer = await handleAccountEmailRequest(
      request({ confirmed: true, email: "new@example.com" }),
      createDependencies({
        requestProviderUpdate: vi.fn().mockResolvedValue({ status: 401 }),
      }),
    );
    expect(expiredBearer.status).toBe(401);
    await expect(expiredBearer.json()).resolves.toMatchObject({
      code: "authentication_required",
    });

    const providerDenial = await handleAccountEmailRequest(
      request({ confirmed: true, email: "new@example.com" }),
      createDependencies({
        requestProviderUpdate: vi.fn().mockResolvedValue({ status: 403 }),
      }),
    );
    expect(providerDenial.status).toBe(400);
    await expect(providerDenial.json()).resolves.toMatchObject({
      code: "validation",
    });

    const lookupFailure = await handleAccountEmailRequest(
      request({ confirmed: true, email: "new@example.com" }),
      createDependencies({
        resolveRecoveryState: vi.fn().mockResolvedValue("unavailable"),
      }),
    );
    expect(lookupFailure.status).toBe(503);
  });

  it("exposes the route with the same authentication boundary", async () => {
    const response = await POST(
      new Request("https://app.example.com/api/auth/account-email", {
        body: JSON.stringify({ confirmed: true, email: "new@example.com" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(401);
  });
});

describe("signed-in GoTrue account e-mail request", () => {
  it("uses PUT /auth/v1/user, the user bearer, PKCE, and the exact canonical redirect query", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ user: { id: userId } }), { status: 200 }),
      );
    const update = createAccountEmailProviderUpdater({
      appUrl: "https://greenroster.example",
      createCodeVerifier: () => "test-code-verifier",
      fetchImplementation,
      publishableKey: "publishable-key",
      supabaseUrl: "https://project.supabase.co",
    });

    await expect(
      update({ accessToken, email: "new@example.com" }),
    ).resolves.toEqual({ status: 200 });

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImplementation.mock.calls[0] as [
      URL,
      RequestInit,
    ];
    expect(url.toString()).toBe(
      "https://project.supabase.co/auth/v1/user?redirect_to=https%3A%2F%2Fgreenroster.example%2Faccount%2Femail-change-confirmed",
    );
    expect(options).toMatchObject({
      body: JSON.stringify({
        code_challenge: "0FLIKahrX7kqxncwhV5WD82lu_wi5GA8FsRSLubaOpU",
        code_challenge_method: "s256",
        email: "new@example.com",
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: "publishable-key",
        "Content-Type": "application/json",
      },
      method: "PUT",
    });
    expect(options.body).not.toContain("test-code-verifier");
  });
});
