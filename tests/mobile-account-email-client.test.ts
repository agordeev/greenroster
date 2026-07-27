import { describe, expect, it, vi } from "vitest";

import { createMobileAccountEmailClient } from "../apps/mobile/src/lib/auth/mobile-account-email-client";

const appUrl = "https://greenroster.rapidlabs.dev";
const correlationId = "40000000-0000-4000-8000-000000000001";

describe("mobile account e-mail API client", () => {
  it("posts the bearer token and normalized payload to the web boundary", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          correlationId,
          ok: true,
          status: "pending",
        }),
        { status: 200 },
      ),
    );
    const client = createMobileAccountEmailClient(appUrl, fetchImplementation);

    await expect(
      client.requestEmailChange(
        "private-access-token",
        "new@example.com",
        true,
      ),
    ).resolves.toMatchObject({ ok: true, status: "pending" });
    expect(fetchImplementation).toHaveBeenCalledWith(
      `${appUrl}/api/auth/account-email`,
      expect.objectContaining({
        body: JSON.stringify({ confirmed: true, email: "new@example.com" }),
        headers: {
          Authorization: "Bearer private-access-token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );
  });

  it("parses safe server errors and maps malformed transport to unavailable", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "forbidden",
            correlationId,
            ok: false,
          }),
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(new Response("not-json", { status: 503 }))
      .mockRejectedValueOnce(new Error("offline"));
    const client = createMobileAccountEmailClient(appUrl, fetchImplementation);

    await expect(
      client.requestEmailChange("token", "new@example.com", true),
    ).resolves.toMatchObject({ code: "forbidden", ok: false });
    await expect(
      client.requestEmailChange("token", "new@example.com", true),
    ).resolves.toMatchObject({ code: "unavailable", ok: false });
    await expect(
      client.requestEmailChange("token", "new@example.com", true),
    ).resolves.toMatchObject({ code: "unavailable", ok: false });
  });
});
