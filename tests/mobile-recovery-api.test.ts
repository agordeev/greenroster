import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import {
  exchangeMobileRecoveryCodeWithDependencies,
  requestMobileRecoveryWithDependencies,
  resetMobileRecoveryPasswordWithDependencies,
  resolveMobileRecoveryStatusWithDependencies,
  type MobileRecoveryApiDependencies,
} from "../apps/web/src/lib/auth/mobile-recovery-api-core";

type Dependencies = MobileRecoveryApiDependencies;

const verifiedSession = {
  accessToken: "private-access-token",
  email: "member@example.com",
  expiresAt: new Date("2026-07-26T01:10:00.000Z"),
  sessionId: "20000000-0000-4000-8000-000000000101",
  userId: "10000000-0000-4000-8000-000000000101",
};
const authSession = {
  access_token: "private-access-token",
  refresh_token: "private-refresh-token",
} as Session;
const opaqueRecoveryHandle = "h".repeat(43);
const resetOperationId = "70000000-0000-4000-8000-000000000101";
const resolvedHandle = {
  claimId: null,
  operationId: resetOperationId,
  sessionId: verifiedSession.sessionId,
  state: "active" as const,
  userId: verifiedSession.userId,
};

function createDependencies(
  overrides: Partial<Dependencies> = {},
): Dependencies {
  return {
    claim: vi.fn().mockResolvedValue({
      claimId: "30000000-0000-4000-8000-000000000101",
      ok: true,
    }),
    consume: vi.fn().mockResolvedValue(true),
    createHandle: vi.fn().mockReturnValue(opaqueRecoveryHandle),
    createIntent: vi.fn().mockResolvedValue(true),
    createOperationId: vi.fn().mockReturnValue(resetOperationId),
    createState: vi
      .fn()
      .mockReturnValue("50000000-0000-4000-8000-000000000101"),
    exchangeCode: vi.fn().mockResolvedValue({ ok: true, session: authSession }),
    hash: vi.fn((value: string) => `hash:${value}`),
    now: vi.fn().mockReturnValue(new Date("2026-07-26T01:00:00.000Z")),
    registerProof: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(undefined),
    resolveHandle: vi.fn().mockResolvedValue({
      handle: resolvedHandle,
      ok: true,
    }),
    resolveIntent: vi.fn().mockResolvedValue({
      intent: {
        codeVerifier: "private-code-verifier",
        emailHash: "hash:member@example.com",
      },
      ok: true,
    }),
    sendRecovery: vi.fn().mockResolvedValue({
      codeVerifier: "private-code-verifier",
      error: null,
    }),
    updatePassword: vi.fn().mockResolvedValue({ error: null }),
    verify: vi.fn().mockResolvedValue(verifiedSession),
    ...overrides,
  };
}

function request(
  path: "exchange" | "request" | "reset" | "status",
  body?: unknown,
  authorization = `Recovery ${opaqueRecoveryHandle}`,
) {
  return new Request(
    `https://app.example.com/api/auth/mobile-recovery/${path}`,
    {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        authorization,
        "content-type": "application/json",
        "x-correlation-id": "40000000-0000-4000-8000-000000000101",
      },
      method: path === "status" ? "GET" : "POST",
    },
  );
}

describe("mobile recovery exchange API", () => {
  it("exchanges only a matching server-held intent and registers verified identity", async () => {
    const dependencies = createDependencies();
    const response = await exchangeMobileRecoveryCodeWithDependencies(
      request("exchange", {
        code: "one-time-code",
        recoveryState: "50000000-0000-4000-8000-000000000101",
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(dependencies.exchangeCode).toHaveBeenCalledWith(
      "one-time-code",
      "private-code-verifier",
    );
    expect(dependencies.registerProof).toHaveBeenCalledWith(
      "hash:50000000-0000-4000-8000-000000000101",
      "hash:member@example.com",
      `hash:${opaqueRecoveryHandle}`,
      resetOperationId,
      verifiedSession.sessionId,
      verifiedSession.userId,
      verifiedSession.expiresAt,
    );
    expect(body).toMatchObject({
      ok: true,
      recoveryHandle: opaqueRecoveryHandle,
      state: "active",
    });
    expect(JSON.stringify(body)).not.toContain("private-access-token");
    expect(JSON.stringify(body)).not.toContain("private-refresh-token");
    expect(JSON.stringify(body)).not.toContain("member@example.com");
    expect(JSON.stringify(body)).not.toContain(verifiedSession.userId);
  });

  it("rejects missing, mismatched, and replayed intent proof", async () => {
    const missing = createDependencies({
      resolveIntent: vi.fn().mockResolvedValue({ intent: null, ok: true }),
    });
    const response = await exchangeMobileRecoveryCodeWithDependencies(
      request("exchange", {
        code: "one-time-code",
        recoveryState: "50000000-0000-4000-8000-000000000101",
      }),
      missing,
    );
    expect(response.status).toBe(409);
    expect(missing.exchangeCode).not.toHaveBeenCalled();

    const mismatch = createDependencies({
      resolveIntent: vi.fn().mockResolvedValue({
        intent: {
          codeVerifier: "private-code-verifier",
          emailHash: "hash:other@example.com",
        },
        ok: true,
      }),
    });
    const mismatchedResponse = await exchangeMobileRecoveryCodeWithDependencies(
      request("exchange", {
        code: "one-time-code",
        recoveryState: "50000000-0000-4000-8000-000000000101",
      }),
      mismatch,
    );
    expect(mismatchedResponse.status).toBe(409);
    expect(mismatch.registerProof).not.toHaveBeenCalled();
  });

  it("treats an already-active registration as an idempotent retry", async () => {
    const dependencies = createDependencies({
      registerProof: vi.fn().mockResolvedValue(false),
    });
    const response = await exchangeMobileRecoveryCodeWithDependencies(
      request("exchange", {
        code: "one-time-code",
        recoveryState: "50000000-0000-4000-8000-000000000101",
      }),
      dependencies,
    );
    expect(response.status).toBe(200);
  });

  it("keeps transient intent and Auth failures retryable", async () => {
    const unavailableIntent = createDependencies({
      resolveIntent: vi.fn().mockResolvedValue({ ok: false }),
    });
    const intentResponse = await exchangeMobileRecoveryCodeWithDependencies(
      request("exchange", {
        code: "one-time-code",
        recoveryState: "50000000-0000-4000-8000-000000000101",
      }),
      unavailableIntent,
    );
    expect(intentResponse.status).toBe(503);
    expect(await intentResponse.json()).toMatchObject({
      code: "unavailable",
      ok: false,
    });

    const unavailableAuth = createDependencies({
      exchangeCode: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "unavailable" }),
    });
    const authResponse = await exchangeMobileRecoveryCodeWithDependencies(
      request("exchange", {
        code: "one-time-code",
        recoveryState: "50000000-0000-4000-8000-000000000101",
      }),
      unavailableAuth,
    );
    expect(authResponse.status).toBe(503);
    expect(await authResponse.json()).toMatchObject({
      code: "unavailable",
      ok: false,
    });

    const rateLimitedAuth = createDependencies({
      exchangeCode: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "rate_limited" }),
    });
    const rateLimitedResponse =
      await exchangeMobileRecoveryCodeWithDependencies(
        request("exchange", {
          code: "one-time-code",
          recoveryState: "50000000-0000-4000-8000-000000000101",
        }),
        rateLimitedAuth,
      );
    expect(rateLimitedResponse.status).toBe(429);
    expect(await rateLimitedResponse.json()).toMatchObject({
      code: "rate_limited",
      ok: false,
    });
  });
});

describe("mobile recovery request API", () => {
  it("stores hashes and verifier while keeping all proof out of the response", async () => {
    const dependencies = createDependencies();
    const response = await requestMobileRecoveryWithDependencies(
      request("request", { email: " MEMBER@Example.COM " }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(dependencies.createIntent).toHaveBeenCalledWith(
      "hash:50000000-0000-4000-8000-000000000101",
      "hash:member@example.com",
      "private-code-verifier",
      new Date("2026-07-26T01:15:00.000Z"),
    );
    expect(dependencies.sendRecovery).toHaveBeenCalledWith(
      "member@example.com",
      "greenroster://auth/callback?recovery_state=50000000-0000-4000-8000-000000000101",
    );
    expect(body).toMatchObject({ ok: true, state: "requested" });
    expect(JSON.stringify(body)).not.toContain("private-code-verifier");
    expect(JSON.stringify(body)).not.toContain("50000000-0000");
    expect(JSON.stringify(body)).not.toContain("member@example.com");
  });

  it("returns neutral success for a non-enumerating provider response", async () => {
    const dependencies = createDependencies({
      sendRecovery: vi.fn().mockResolvedValue({
        codeVerifier: null,
        error: { retryable: false, status: 400 },
      }),
    });
    const response = await requestMobileRecoveryWithDependencies(
      request("request", { email: "absent@example.com" }),
      dependencies,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(dependencies.createIntent).not.toHaveBeenCalled();
  });
});

describe("mobile recovery status API", () => {
  it("returns only active state for the opaque recovery handle", async () => {
    const response = await resolveMobileRecoveryStatusWithDependencies(
      request("status"),
      createDependencies(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, state: "active" });
  });
});

describe("mobile recovery reset API", () => {
  it("validates both password fields before authentication", async () => {
    const dependencies = createDependencies();
    const response = await resetMobileRecoveryPasswordWithDependencies(
      request("reset", { confirmPassword: "different", password: "short" }),
      dependencies,
    );
    expect(response.status).toBe(400);
    expect(dependencies.resolveHandle).not.toHaveBeenCalled();
  });

  it("rejects expired registry state", async () => {
    const dependencies = createDependencies({
      resolveHandle: vi.fn().mockResolvedValue({
        handle: { ...resolvedHandle, state: "expired" },
        ok: true,
      }),
    });
    const response = await resetMobileRecoveryPasswordWithDependencies(
      request("reset", {
        confirmPassword: "new-password-123",
        password: "new-password-123",
      }),
      dependencies,
    );
    expect(response.status).toBe(409);
    expect(dependencies.claim).not.toHaveBeenCalled();
  });

  it("releases the exact claim when Auth rejects the update", async () => {
    const dependencies = createDependencies({
      updatePassword: vi.fn().mockResolvedValue({ error: { status: 429 } }),
    });
    const response = await resetMobileRecoveryPasswordWithDependencies(
      request("reset", {
        confirmPassword: "new-password-123",
        password: "new-password-123",
      }),
      dependencies,
    );
    expect(response.status).toBe(429);
    expect(dependencies.release).toHaveBeenCalledWith(
      verifiedSession.sessionId,
      verifiedSession.userId,
      "30000000-0000-4000-8000-000000000101",
    );
    expect(dependencies.consume).not.toHaveBeenCalled();
  });

  it("updates, consumes with correlation, and returns no credential material", async () => {
    const dependencies = createDependencies();
    const response = await resetMobileRecoveryPasswordWithDependencies(
      request("reset", {
        confirmPassword: "new-password-123",
        password: "new-password-123",
      }),
      dependencies,
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(dependencies.updatePassword).toHaveBeenCalledWith(
      verifiedSession.userId,
      "new-password-123",
    );
    expect(dependencies.consume).toHaveBeenCalledWith(
      verifiedSession.sessionId,
      verifiedSession.userId,
      "30000000-0000-4000-8000-000000000101",
      resetOperationId,
    );
    expect(body).toMatchObject({ ok: true, state: "complete" });
    expect(body.correlationId).toBe(resetOperationId);
    expect(JSON.stringify(body)).not.toContain("new-password-123");
    expect(JSON.stringify(body)).not.toContain(verifiedSession.accessToken);
  });

  it("does not report completion when registry consumption fails", async () => {
    const dependencies = createDependencies({
      consume: vi.fn().mockResolvedValue(false),
    });
    const response = await resetMobileRecoveryPasswordWithDependencies(
      request("reset", {
        confirmPassword: "new-password-123",
        password: "new-password-123",
      }),
      dependencies,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });

  it("reconciles a lost reset response from consumed handle state", async () => {
    const dependencies = createDependencies({
      resolveHandle: vi.fn().mockResolvedValue({
        handle: {
          ...resolvedHandle,
          claimId: "30000000-0000-4000-8000-000000000101",
          state: "consumed",
        },
        ok: true,
      }),
    });
    const response = await resetMobileRecoveryPasswordWithDependencies(
      request("reset", {
        confirmPassword: "new-password-123",
        password: "new-password-123",
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      state: "complete",
    });
    expect(dependencies.updatePassword).not.toHaveBeenCalled();
    expect(dependencies.consume).not.toHaveBeenCalled();
  });
});
