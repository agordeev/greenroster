import { describe, expect, it } from "vitest";

import {
  handleNotificationDrainRequest,
  runNotificationEmailDrain,
  runNotificationEmailWorkers,
} from "../apps/web/src/app/api/jobs/notifications/drain/route";

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
  it("dispatches invitation and role workers in one drain pass", async () => {
    const calls: string[] = [];
    const result = await runNotificationEmailWorkers({
      runInvitation: async () => {
        calls.push("invitation");
        return { kind: "empty" as const };
      },
      runRoleChange: async () => {
        calls.push("role");
        return {
          kind: "sent" as const,
          deliveryId: "60000000-0000-4000-8000-000000000001",
          providerMessageId: "provider-role-1",
        };
      },
      runRoundPublished: async () => {
        calls.push("round");
        return { kind: "empty" as const };
      },
      runRoundCancelled: async () => {
        calls.push("cancelled");
        return { kind: "empty" as const };
      },
      runRoundCancelledPush: async () => {
        calls.push("cancelled-push");
        return { kind: "empty" as const };
      },
      runRoundAnnouncementPush: async () => {
        calls.push("announcement-push");
        return { kind: "empty" as const };
      },
      runScoringOpenedPush: async () => {
        calls.push("scoring-opened-push");
        return { kind: "empty" as const };
      },
      runRoundDetailsChanged: async () => {
        calls.push("details-changed");
        return { kind: "empty" as const };
      },
      runResultsPublished: async () => {
        calls.push("results-published");
        return { kind: "empty" as const };
      },
      runResultsPublishedPush: async () => {
        calls.push("results-published-push");
        return { kind: "empty" as const };
      },
      runResultsPublishedPushReceipt: async () => {
        calls.push("results-published-push-receipt");
        return { kind: "empty" as const };
      },
    });
    expect(calls).toEqual([
      "invitation",
      "role",
      "round",
      "cancelled",
      "cancelled-push",
      "announcement-push",
      "scoring-opened-push",
      "details-changed",
      "results-published",
      "results-published-push",
      "results-published-push-receipt",
    ]);
    expect(result).toEqual({
      kind: "sent",
      deliveryId: "60000000-0000-4000-8000-000000000001",
      providerMessageId: "provider-role-1",
    });
  });

  it("drains each category until empty within the bounded batch", async () => {
    const invitationResults = [
      {
        kind: "sent" as const,
        deliveryId: "60000000-0000-4000-8000-000000000010",
        providerMessageId: "invite-provider-1",
      },
      { kind: "empty" as const },
    ];
    const roleResults = [
      {
        kind: "retryable" as const,
        deliveryId: "60000000-0000-4000-8000-000000000011",
      },
      {
        kind: "sent" as const,
        deliveryId: "60000000-0000-4000-8000-000000000012",
        providerMessageId: "role-provider-1",
      },
      { kind: "empty" as const },
    ];
    let invitationCalls = 0;
    let roleCalls = 0;

    const result = await runNotificationEmailDrain(
      {
        runInvitation: async () => invitationResults[invitationCalls++]!,
        runRoleChange: async () => roleResults[roleCalls++]!,
        runRoundPublished: async () => ({ kind: "empty" as const }),
        runRoundCancelled: async () => ({ kind: "empty" as const }),
        runRoundCancelledPush: async () => ({ kind: "empty" as const }),
        runRoundAnnouncementPush: async () => ({ kind: "empty" as const }),
        runScoringOpenedPush: async () => ({ kind: "empty" as const }),
        runRoundDetailsChanged: async () => ({ kind: "empty" as const }),
        runResultsPublished: async () => ({ kind: "empty" as const }),
        runResultsPublishedPush: async () => ({ kind: "empty" as const }),
        runResultsPublishedPushReceipt: async () => ({
          kind: "empty" as const,
        }),
      },
      5,
    );

    expect(invitationCalls).toBe(2);
    expect(roleCalls).toBe(3);
    expect(result.kind).toBe("sent");
  });

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
