import { describe, expect, it } from "vitest";

import type { NotificationRpcClient } from "../apps/web/src/lib/notifications/invitation-email-worker";
import {
  runRoundAnnouncementPushWorker,
  type RoundAnnouncementPushWorkerDependencies,
} from "../apps/web/src/lib/notifications/round-announcement-push-worker";
import { runScoringOpenedPushWorker } from "../apps/web/src/lib/notifications/round-scoring-opened-push-worker";

const deliveryId = "72000000-0000-4000-8000-000000000001";
const roundId = "72000000-0000-4000-8000-000000000003";
const groupId = "72000000-0000-4000-8000-000000000004";
const userId = "72000000-0000-4000-8000-000000000005";
const deviceId = "72000000-0000-4000-8000-000000000006";
const claimToken = "72000000-0000-4000-8000-000000000007";
const correlationId = "72000000-0000-4000-8000-000000000008";
const operationId = "72000000-0000-4000-8000-000000000009";
const now = new Date("2026-08-05T12:00:00.000Z");

const row = {
  delivery_id: deliveryId,
  outbox_job_id: "72000000-0000-4000-8000-000000000002",
  event_type: "round.published",
  round_id: roundId,
  group_id: groupId,
  round_description: "August Championship",
  scheduled_at: "2026-08-06T12:00:00.000Z",
  venue: "North Course",
  rsvp_deadline_at: "2026-08-06T10:00:00.000Z",
  recipient_user_id: userId,
  device_id: deviceId,
  expo_push_token: "ExponentPushToken[announcement-device]",
  attempt_number: 1,
};

function dependencies(
  rpc: NotificationRpcClient["rpc"],
  overrides?: Partial<RoundAnnouncementPushWorkerDependencies>,
): RoundAnnouncementPushWorkerDependencies {
  return {
    createClaimToken: () => claimToken,
    createClient: () => ({ rpc }),
    createCorrelationId: () => correlationId,
    createOperationId: () => operationId,
    createProvider: () => ({
      send: async () => ({
        statusCode: 200,
        body: { data: [{ status: "ok", id: "expo-announcement-ticket-1" }] },
      }),
    }),
    getConfig: () => ({ maxAttempts: 3, retrySeconds: 90 }),
    now: () => now,
    ...overrides,
  };
}

function rpcWithClaim(
  calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }>,
  result: unknown,
): NotificationRpcClient["rpc"] {
  return async (name, args) => {
    calls.push({ name, args });
    if (name === "claim_round_announcement_push") {
      return { data: [row], error: null };
    }
    return { data: result, error: null };
  };
}

describe("round announcement push worker", () => {
  it("sends a publication payload and finalizes the push child", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    let sentMessage: Record<string, unknown> | null = null;
    const result = await runRoundAnnouncementPushWorker(
      dependencies(rpcWithClaim(calls, null), {
        createProvider: () => ({
          send: async (message) => {
            sentMessage = message;
            return {
              statusCode: 200,
              body: {
                data: [{ status: "ok", id: "expo-announcement-ticket-1" }],
              },
            };
          },
        }),
      }),
    );
    expect(result).toEqual({
      deliveryId,
      kind: "sent",
      providerMessageId: "expo-announcement-ticket-1",
    });
    expect(sentMessage).toMatchObject({
      to: row.expo_push_token,
      title: "Round published",
      body: "August Championship is open for RSVP.",
      data: { type: "round_published", roundId },
    });
    expect(calls.map((call) => call.name)).toEqual([
      "claim_round_announcement_push",
      "record_round_announcement_push_send_success",
    ]);
  });

  it("retries provider outages and never exposes the token in RPC calls", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runRoundAnnouncementPushWorker(
      dependencies(rpcWithClaim(calls, null), {
        createProvider: () => ({
          send: async () => {
            throw new TypeError("fetch failed");
          },
        }),
      }),
    );
    expect(result).toEqual({ deliveryId, kind: "retryable" });
    expect(calls[1]?.name).toBe("record_round_announcement_push_send_failure");
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-05T12:01:30.000Z",
    });
    expect(JSON.stringify(calls)).not.toContain(row.expo_push_token);
  });

  it("uses attempt-dependent backoff for later announcement outages", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_round_announcement_push") {
        return { data: [{ ...row, attempt_number: 2 }], error: null };
      }
      return { data: null, error: null };
    };
    const result = await runRoundAnnouncementPushWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ statusCode: 503, body: { data: [] } }),
        }),
      }),
    );

    expect(result).toEqual({ deliveryId, kind: "retryable" });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-05T12:03:00.000Z",
    });
  });

  it("retires an invalid device through the atomic provider-invalid RPC", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runRoundAnnouncementPushWorker(
      dependencies(rpcWithClaim(calls, null), {
        createProvider: () => ({
          send: async () => ({
            statusCode: 200,
            body: {
              data: [
                {
                  status: "error",
                  message: "The device is not registered",
                  details: { error: "DeviceNotRegistered" },
                },
              ],
            },
          }),
        }),
      }),
    );
    expect(result).toEqual({
      code: "provider_invalid",
      deliveryId,
      kind: "failed_permanent",
    });
    expect(calls[1]?.name).toBe(
      "record_round_announcement_push_invalid_device",
    );
    expect(calls[1]?.args).toEqual({
      p_delivery_id: deliveryId,
      p_claim_token: claimToken,
      p_device_id: deviceId,
      p_group_id: groupId,
      p_correlation_id: correlationId,
      p_operation_id: operationId,
    });
  });

  it("handles detail-change payloads with the same round deep link", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    let sentMessage: Record<string, unknown> | null = null;
    const result = await runRoundAnnouncementPushWorker(
      dependencies(
        async (name, args) => {
          calls.push({ name, args });
          if (name === "claim_round_announcement_push") {
            return {
              data: [{ ...row, event_type: "round.details_changed" }],
              error: null,
            };
          }
          return { data: null, error: null };
        },
        {
          createProvider: () => ({
            send: async (message) => {
              sentMessage = message;
              return {
                statusCode: 200,
                body: {
                  data: [{ status: "ok", id: "expo-announcement-ticket-1" }],
                },
              };
            },
          }),
        },
      ),
    );
    expect(result.kind).toBe("sent");
    expect(sentMessage).toMatchObject({
      title: "Round details changed",
      body: "August Championship details changed.",
      data: { type: "round_details_changed", roundId },
    });
  });

  it("sends scoring-opened payloads through the scoring-specific RPC boundary", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    let sentMessage: Record<string, unknown> | null = null;
    const result = await runScoringOpenedPushWorker(
      dependencies(
        async (name, args) => {
          calls.push({ name, args });
          if (name === "claim_scoring_opened_push") {
            return {
              data: [{ ...row, event_type: "scoring_opened" }],
              error: null,
            };
          }
          return { data: null, error: null };
        },
        {
          createProvider: () => ({
            send: async (message, options) => {
              sentMessage = message;
              expect(options.idempotencyKey).toBe(
                `scoring-opened/${deliveryId}`,
              );
              return {
                statusCode: 200,
                body: {
                  data: [{ status: "ok", id: "expo-scoring-ticket-1" }],
                },
              };
            },
          }),
        },
      ),
    );
    expect(result).toEqual({
      deliveryId,
      kind: "sent",
      providerMessageId: "expo-scoring-ticket-1",
    });
    expect(sentMessage).toMatchObject({
      title: "Scoring is open",
      body: "August Championship is open for scoring.",
      data: { type: "scoring_opened", roundId },
    });
    expect(calls.map((call) => call.name)).toEqual([
      "claim_scoring_opened_push",
      "record_scoring_opened_push_send_success",
    ]);
  });

  it("terminalizes malformed announcement claims without sending", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    let providerCalled = false;
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      return {
        data: [{ delivery_id: deliveryId, unexpected: true }],
        error: null,
      };
    };
    const result = await runRoundAnnouncementPushWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => {
            providerCalled = true;
            return { statusCode: 200, body: {} };
          },
        }),
      }),
    );

    expect(result).toEqual({
      code: "invalid_claim",
      deliveryId,
      kind: "failed_permanent",
    });
    expect(providerCalled).toBe(false);
    expect(calls[1]?.args).toMatchObject({
      p_delivery_id: deliveryId,
      p_claim_token: claimToken,
      p_safe_error: "invalid_claim",
      p_retry_at: null,
    });
  });

  it("uses scoring-specific retry and invalid-device finalizers", async () => {
    const retryCalls: string[] = [];
    const retryResult = await runScoringOpenedPushWorker(
      dependencies(
        async (name) => {
          retryCalls.push(name);
          if (name === "claim_scoring_opened_push") {
            return {
              data: [{ ...row, event_type: "scoring_opened" }],
              error: null,
            };
          }
          return { data: null, error: null };
        },
        {
          createProvider: () => ({
            send: async () => {
              throw new TypeError("fetch failed");
            },
          }),
        },
      ),
    );
    expect(retryResult).toEqual({ deliveryId, kind: "retryable" });
    expect(retryCalls).toEqual([
      "claim_scoring_opened_push",
      "record_scoring_opened_push_send_failure",
    ]);

    const invalidCalls: string[] = [];
    const invalidResult = await runScoringOpenedPushWorker(
      dependencies(
        async (name) => {
          invalidCalls.push(name);
          if (name === "claim_scoring_opened_push") {
            return {
              data: [{ ...row, event_type: "scoring_opened" }],
              error: null,
            };
          }
          return { data: null, error: null };
        },
        {
          createProvider: () => ({
            send: async () => ({
              statusCode: 200,
              body: {
                data: [
                  {
                    status: "error",
                    message: "The device is not registered",
                    details: { error: "DeviceNotRegistered" },
                  },
                ],
              },
            }),
          }),
        },
      ),
    );
    expect(invalidResult).toEqual({
      code: "provider_invalid",
      deliveryId,
      kind: "failed_permanent",
    });
    expect(invalidCalls).toEqual([
      "claim_scoring_opened_push",
      "record_scoring_opened_push_invalid_device",
    ]);
  });

  it("uses attempt-dependent backoff for later scoring-opened outages", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_scoring_opened_push") {
        return {
          data: [{ ...row, event_type: "scoring_opened", attempt_number: 2 }],
          error: null,
        };
      }
      return { data: null, error: null };
    };
    const result = await runScoringOpenedPushWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ statusCode: 503, body: { data: [] } }),
        }),
      }),
    );

    expect(result).toEqual({ deliveryId, kind: "retryable" });
    expect(calls[1]?.name).toBe("record_scoring_opened_push_send_failure");
    expect(calls[1]?.args).toMatchObject({
      p_delivery_id: deliveryId,
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-05T12:03:00.000Z",
    });
  });

  it("caps repeated scoring-opened retry backoff at sixteen base intervals", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    let providerCalls = 0;
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_scoring_opened_push") {
        return {
          data: [{ ...row, event_type: "scoring_opened", attempt_number: 7 }],
          error: null,
        };
      }
      return { data: null, error: null };
    };
    const result = await runScoringOpenedPushWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => {
            providerCalls += 1;
            return { statusCode: 503, body: { data: [] } };
          },
        }),
        getConfig: () => ({ maxAttempts: 10, retrySeconds: 90 }),
      }),
    );

    expect(result).toEqual({ deliveryId, kind: "retryable" });
    expect(providerCalls).toBe(1);
    expect(calls[1]?.name).toBe("record_scoring_opened_push_send_failure");
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-05T12:24:00.000Z",
    });
  });

  it("terminalizes malformed scoring claims without sending", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    let providerCalled = false;
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      return {
        data: [{ delivery_id: deliveryId, unexpected: true }],
        error: null,
      };
    };
    const result = await runScoringOpenedPushWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => {
            providerCalled = true;
            return { statusCode: 200, body: {} };
          },
        }),
      }),
    );

    expect(result).toEqual({
      code: "invalid_claim",
      deliveryId,
      kind: "failed_permanent",
    });
    expect(providerCalled).toBe(false);
    expect(calls[1]?.args).toMatchObject({
      p_delivery_id: deliveryId,
      p_claim_token: claimToken,
      p_safe_error: "invalid_claim",
      p_retry_at: null,
    });
  });

  it("recovers a scoring-opened outage on the next claimed attempt", async () => {
    const calls: string[] = [];
    let claimCount = 0;
    let providerAttempt = 0;
    const provider = {
      send: async () => {
        providerAttempt += 1;
        if (providerAttempt === 1) throw new TypeError("fetch failed");
        return {
          statusCode: 200,
          body: { data: [{ status: "ok", id: "expo-scoring-recovered" }] },
        };
      },
    };
    const rpc: NotificationRpcClient["rpc"] = async (name) => {
      calls.push(name);
      if (name === "claim_scoring_opened_push") {
        claimCount += 1;
        return {
          data: [
            {
              ...row,
              attempt_number: claimCount,
              event_type: "scoring_opened",
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    };
    const first = await runScoringOpenedPushWorker(
      dependencies(rpc, { createProvider: () => provider }),
    );
    const second = await runScoringOpenedPushWorker(
      dependencies(rpc, { createProvider: () => provider }),
    );
    expect(first).toEqual({ deliveryId, kind: "retryable" });
    expect(second).toEqual({
      deliveryId,
      kind: "sent",
      providerMessageId: "expo-scoring-recovered",
    });
    expect(calls).toEqual([
      "claim_scoring_opened_push",
      "record_scoring_opened_push_send_failure",
      "claim_scoring_opened_push",
      "record_scoring_opened_push_send_success",
    ]);
  });
});
