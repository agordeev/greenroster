import { describe, expect, it } from "vitest";

import { handlePrivacyRetentionRequest } from "../apps/web/src/app/api/jobs/privacy/retention/route";

function request(authorization?: string) {
  return new Request("https://greenroster.example/api/jobs/privacy/retention", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

const result = {
  expiredInvitationCount: 1,
  emailProviderEventCount: 2,
  emailDeliveryCount: 3,
  pushReceiptCount: 4,
  pushDeliveryCount: 5,
  prunedAt: "2026-08-04T03:00:00.000Z",
} as const;

describe("privacy retention job route", () => {
  it("requires the cron bearer and returns a generic completion", async () => {
    let runs = 0;
    const dependencies = {
      getJobSecret: () => "retention-secret",
      runOne: async () => {
        runs += 1;
        return result;
      },
    };

    const unauthorized = await handlePrivacyRetentionRequest(
      request("Bearer wrong"),
      dependencies,
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({
      ok: false,
      status: "unauthorized",
    });
    expect(runs).toBe(0);

    const authorized = await handlePrivacyRetentionRequest(
      request("Bearer retention-secret"),
      dependencies,
    );
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ ok: true, status: "completed" });
    expect(runs).toBe(1);
  });

  it("does not expose retention counts when the service is unavailable", async () => {
    const response = await handlePrivacyRetentionRequest(
      request("Bearer retention-secret"),
      {
        getJobSecret: () => "retention-secret",
        runOne: async () => {
          throw new Error("database unavailable");
        },
      },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, status: "unavailable" });
  });
});
