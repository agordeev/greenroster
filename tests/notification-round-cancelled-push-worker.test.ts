import { describe, expect, it } from "vitest";

import type { NotificationRpcClient } from "../apps/web/src/lib/notifications/invitation-email-worker";
import {
  runRoundCancelledPushWorker,
  type RoundCancelledPushWorkerDependencies,
} from "../apps/web/src/lib/notifications/round-cancelled-push-worker";

const deliveryId = "71000000-0000-4000-8000-000000000001";
const outboxJobId = "71000000-0000-4000-8000-000000000002";
const roundId = "71000000-0000-4000-8000-000000000003";
const groupId = "71000000-0000-4000-8000-000000000004";
const userId = "71000000-0000-4000-8000-000000000005";
const deviceId = "71000000-0000-4000-8000-000000000006";
const claimToken = "71000000-0000-4000-8000-000000000007";
const correlationId = "71000000-0000-4000-8000-000000000008";
const operationId = "71000000-0000-4000-8000-000000000009";
const now = new Date("2026-08-05T12:00:00.000Z");

const row = {
  delivery_id: deliveryId,
  outbox_job_id: outboxJobId,
  round_id: roundId,
  group_id: groupId,
  round_description: "August Championship",
  cancellation_reason: "Course closure",
  recipient_user_id: userId,
  device_id: deviceId,
  expo_push_token: "ExponentPushToken[cancel-device]",
  attempt_number: 1,
};

function dependencies(
  rpc: NotificationRpcClient["rpc"],
  overrides?: Partial<RoundCancelledPushWorkerDependencies>,
): RoundCancelledPushWorkerDependencies {
  return {
    createClaimToken: () => claimToken,
    createClient: () => ({ rpc }),
    createCorrelationId: () => correlationId,
    createOperationId: () => operationId,
    createProvider: () => ({
      send: async () => ({
        statusCode: 200,
        body: { data: [{ status: "ok", id: "expo-cancel-ticket-1" }] },
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
    if (name === "claim_round_cancelled_push") {
      return { data: [row], error: null };
    }
    return { data: result, error: null };
  };
}

describe("round-cancelled push worker", () => {
  it("claims, sends the mandatory cancellation message, and finalizes", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    let sentMessage: Record<string, unknown> | null = null;
    const result = await runRoundCancelledPushWorker(
      dependencies(rpcWithClaim(calls, null), {
        createProvider: () => ({
          send: async (message) => {
            sentMessage = message;
            return {
              statusCode: 200,
              body: { data: [{ status: "ok", id: "expo-cancel-ticket-1" }] },
            };
          },
        }),
      }),
    );
    expect(result).toEqual({
      deliveryId,
      kind: "sent",
      providerMessageId: "expo-cancel-ticket-1",
    });
    expect(sentMessage).toMatchObject({
      to: row.expo_push_token,
      title: "Round cancelled",
      data: {
        type: "round_cancelled",
        roundId,
        summary: "August Championship was cancelled: Course closure",
      },
    });
    expect(calls.map((call) => call.name)).toEqual([
      "claim_round_cancelled_push",
      "record_round_cancelled_push_send_success",
    ]);
    expect(calls[0]?.args).toEqual({
      p_claim_token: claimToken,
      p_stale_before: "2026-08-05T11:58:30.000Z",
    });
  });

  it("retries provider outages and preserves the token boundary", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runRoundCancelledPushWorker(
      dependencies(rpcWithClaim(calls, null), {
        createProvider: () => ({
          send: async () => {
            throw new TypeError("fetch failed");
          },
        }),
      }),
    );
    expect(result).toEqual({ deliveryId, kind: "retryable" });
    expect(calls[1]?.name).toBe("record_round_cancelled_push_send_failure");
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-05T12:01:30.000Z",
    });
    expect(JSON.stringify(calls)).not.toContain(row.expo_push_token);
  });

  it("uses attempt-dependent backoff for later transport outages", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_round_cancelled_push") {
        return { data: [{ ...row, attempt_number: 2 }], error: null };
      }
      return { data: null, error: null };
    };
    const result = await runRoundCancelledPushWorker(
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

  it("caps repeated retry backoff at sixteen base intervals", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    let providerCalls = 0;
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_round_cancelled_push") {
        return { data: [{ ...row, attempt_number: 7 }], error: null };
      }
      return { data: null, error: null };
    };
    const result = await runRoundCancelledPushWorker(
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
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-05T12:24:00.000Z",
    });
  });

  it("retires invalid devices through the atomic provider-invalid RPC", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runRoundCancelledPushWorker(
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
    expect(calls.map((call) => call.name)).toEqual([
      "claim_round_cancelled_push",
      "record_round_cancelled_push_invalid_device",
    ]);
    expect(calls[1]?.args).toEqual({
      p_delivery_id: deliveryId,
      p_claim_token: claimToken,
      p_device_id: deviceId,
      p_group_id: groupId,
      p_correlation_id: correlationId,
      p_operation_id: operationId,
    });
  });

  it("does not send when the claim RPC is unavailable", async () => {
    let providerCalled = false;
    const result = await runRoundCancelledPushWorker(
      dependencies(async () => ({ data: null, error: { code: "503" } }), {
        createProvider: () => ({
          send: async () => {
            providerCalled = true;
            return { statusCode: 200, body: {} };
          },
        }),
      }),
    );
    expect(result).toEqual({ kind: "unavailable" });
    expect(providerCalled).toBe(false);
  });

  it("terminalizes malformed claims without sending", async () => {
    let providerCalled = false;
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      return {
        data: [{ delivery_id: deliveryId, unexpected: true }],
        error: null,
      };
    };
    const result = await runRoundCancelledPushWorker(
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
});
