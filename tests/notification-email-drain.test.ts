import { describe, expect, it } from "vitest";

import { handleNotificationDrainRequest } from "../apps/web/src/app/api/jobs/notifications/drain/route";

function request(authorization?: string) {
  return new Request(
    "https://greenroster.example/api/jobs/notifications/drain",
    {
      method: "POST",
      headers: authorization ? { authorization } : undefined,
    },
  );
}

describe("notification drain route", () => {
  it("requires the internal bearer secret and returns only a generic result", async () => {
    let runs = 0;
    const dependencies = {
      getJobSecret: () => "job-secret-that-is-long-enough-1234567890",
      runOne: async () => {
        runs += 1;
        return {
          deliveryId: "60000000-0000-4000-8000-000000000001",
          kind: "sent" as const,
          providerMessageId: "provider-message-1",
        };
      },
    };

    const wrong = await handleNotificationDrainRequest(
      request("Bearer wrong-secret"),
      dependencies,
    );
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ ok: false, status: "unauthorized" });
    expect(runs).toBe(0);

    const authorized = await handleNotificationDrainRequest(
      request("Bearer job-secret-that-is-long-enough-1234567890"),
      dependencies,
    );
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ ok: true, status: "sent" });
    expect(runs).toBe(1);
  });

  it("maps an empty queue and worker unavailability without exposing delivery data", async () => {
    const empty = await handleNotificationDrainRequest(
      request("Bearer secret"),
      {
        getJobSecret: () => "secret",
        runOne: async () => ({ kind: "empty" as const }),
      },
    );
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ ok: true, status: "empty" });

    const unavailable = await handleNotificationDrainRequest(
      request("Bearer secret"),
      {
        getJobSecret: () => "secret",
        runOne: async () => ({
          kind: "unavailable" as const,
          deliveryId: "60000000-0000-4000-8000-000000000001",
        }),
      },
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      ok: false,
      status: "unavailable",
    });
  });
});
