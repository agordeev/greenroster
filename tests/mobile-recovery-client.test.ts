import { describe, expect, it, vi } from "vitest";

import { createMobileRecoveryClient } from "../apps/mobile/src/lib/auth/mobile-recovery-client";

const recoveryHandle = "h".repeat(43);

describe("mobile recovery API client", () => {
  it("exchanges the one-time code without sending identity or bearer fields", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      Response.json({
        correlationId: "40000000-0000-4000-8000-000000000101",
        ok: true,
        recoveryHandle,
        state: "active",
      }),
    );
    const client = createMobileRecoveryClient(
      "https://app.example.com",
      fetchImplementation,
    );
    await expect(
      client.exchange("one-time-code", "50000000-0000-4000-8000-000000000101"),
    ).resolves.toMatchObject({ ok: true, state: "active" });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://app.example.com/api/auth/mobile-recovery/exchange",
      {
        body: JSON.stringify({
          code: "one-time-code",
          recoveryState: "50000000-0000-4000-8000-000000000101",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
  });

  it("sends only replacement password fields and the opaque recovery handle", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      Response.json({
        correlationId: "40000000-0000-4000-8000-000000000101",
        ok: true,
        state: "complete",
      }),
    );
    const client = createMobileRecoveryClient(
      "https://app.example.com",
      fetchImplementation,
    );
    await client.resetPassword(
      recoveryHandle,
      "new-password-123",
      "new-password-123",
    );
    const options = fetchImplementation.mock.calls[0]?.[1];
    expect(JSON.parse(options?.body as string)).toEqual({
      confirmPassword: "new-password-123",
      password: "new-password-123",
    });
    expect(options.headers.Authorization).toBe(`Recovery ${recoveryHandle}`);
    expect(JSON.stringify(options)).not.toContain("access_token");
  });

  it("maps transport and malformed responses to unavailable", async () => {
    const rejected = createMobileRecoveryClient(
      "https://app.example.com",
      vi.fn().mockRejectedValue(new Error("private network details")),
    );
    const malformed = createMobileRecoveryClient(
      "https://app.example.com",
      vi.fn().mockResolvedValue(Response.json({ token: "should-not-pass" })),
    );
    await expect(rejected.status(recoveryHandle)).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
    await expect(malformed.status(recoveryHandle)).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });
});
