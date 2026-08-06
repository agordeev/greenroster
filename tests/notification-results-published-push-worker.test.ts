import { describe, expect, it } from "vitest";

import {
  runResultsPublishedPushWorker,
  type ResultsPublishedPushWorkerDependencies,
} from "../apps/web/src/lib/notifications/results-published-push-worker";
import type { NotificationRpcClient } from "../apps/web/src/lib/notifications/invitation-email-worker";

const deliveryId = "70000000-0000-4000-8000-000000000001";
const outboxJobId = "70000000-0000-4000-8000-000000000002";
const completionId = "70000000-0000-4000-8000-000000000003";
const roundId = "70000000-0000-4000-8000-000000000004";
const groupId = "70000000-0000-4000-8000-000000000005";
const userId = "70000000-0000-4000-8000-000000000006";
const deviceId = "70000000-0000-4000-8000-000000000007";
const claimToken = "claim-token-that-is-not-a-provider-secret";
const now = new Date("2026-08-04T12:00:00.000Z");

const row = {
  delivery_id: deliveryId,
  outbox_job_id: outboxJobId,
  completion_id: completionId,
  round_id: roundId,
  group_id: groupId,
  round_description: "August Championship",
  completed_at: "2026-08-04T12:00:00.000Z",
  recipient_user_id: userId,
  device_id: deviceId,
  expo_push_token: "ExponentPushToken[results-device]",
  attempt_number: 1,
};

function config() {
  return { maxAttempts: 3, retrySeconds: 90 };
}

function dependencies(
  rpc: NotificationRpcClient["rpc"],
  overrides?: Partial<ResultsPublishedPushWorkerDependencies>,
): ResultsPublishedPushWorkerDependencies {
  return {
    createClaimToken: () => claimToken,
    createClient: () => ({ rpc }),
    createCorrelationId: () => "80000000-0000-4000-8000-000000000001",
    createOperationId: () => "80000000-0000-4000-8000-000000000002",
    createProvider: () => ({
      send: async () => ({
        statusCode: 200,
        body: { data: [{ status: "ok", id: "expo-ticket-1" }] },
      }),
    }),
    getConfig: () => config(),
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
    if (name === "claim_results_published_push") {
      return { data: [row], error: null };
    }
    return { data: result, error: null };
  };
}

describe("results-published push worker", () => {
  it("claims, sends one token in memory, and finalizes with the delivery idempotency key", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    let sentMessage: Record<string, unknown> | null = null;
    let sentOptions: Readonly<{ idempotencyKey: string }> | null = null;
    const result = await runResultsPublishedPushWorker(
      dependencies(rpcWithClaim(calls, null), {
        createProvider: () => ({
          send: async (message, options) => {
            sentMessage = message;
            sentOptions = options;
            return {
              statusCode: 200,
              body: { data: [{ status: "ok", id: "expo-ticket-1" }] },
            };
          },
        }),
      }),
    );
    expect(result).toEqual({
      deliveryId,
      kind: "sent",
      providerMessageId: "expo-ticket-1",
    });
    expect(sentMessage).toMatchObject({
      to: row.expo_push_token,
      title: "Results are ready",
      data: { type: "results_published", roundId },
    });
    expect(sentOptions).toEqual({
      idempotencyKey: `results-published/${deliveryId}`,
    });
    expect(calls.map((call) => call.name)).toEqual([
      "claim_results_published_push",
      "record_results_push_send_success",
    ]);
    expect(calls[0]?.args).toEqual({
      p_claim_token: claimToken,
      p_stale_before: "2026-08-04T11:58:30.000Z",
    });
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
    const result = await runResultsPublishedPushWorker(
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

  it("records retryable Expo rate limits with backoff", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runResultsPublishedPushWorker(
      dependencies(rpcWithClaim(calls, null), {
        createProvider: () => ({
          send: async () => ({ statusCode: 429, body: { data: [] } }),
        }),
      }),
    );
    expect(result).toEqual({ deliveryId, kind: "retryable" });
    expect(calls[1]?.name).toBe("record_results_push_send_failure");
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_rate_limited",
      p_retry_at: "2026-08-04T12:01:30.000Z",
    });
  });

  it("uses attempt-dependent backoff for later transport outages", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_results_published_push") {
        return { data: [{ ...row, attempt_number: 2 }], error: null };
      }
      return { data: null, error: null };
    };
    const result = await runResultsPublishedPushWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ statusCode: 503, body: { data: [] } }),
        }),
      }),
    );

    expect(result).toEqual({ deliveryId, kind: "retryable" });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-04T12:03:00.000Z",
    });
  });

  it("accepts Expo's single-ticket object response shape", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runResultsPublishedPushWorker(
      dependencies(rpcWithClaim(calls, null), {
        createProvider: () => ({
          send: async () => ({
            statusCode: 200,
            body: { data: { status: "ok", id: "expo-ticket-object" } },
          }),
        }),
      }),
    );
    expect(result).toEqual({
      deliveryId,
      kind: "sent",
      providerMessageId: "expo-ticket-object",
    });
    expect(calls[1]?.name).toBe("record_results_push_send_success");
  });

  it("retries ordinary network failures instead of abandoning the delivery", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runResultsPublishedPushWorker(
      dependencies(rpcWithClaim(calls, null), {
        createProvider: () => ({
          send: async () => {
            throw new TypeError("fetch failed");
          },
        }),
      }),
    );
    expect(result).toEqual({ deliveryId, kind: "retryable" });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-04T12:01:30.000Z",
    });
  });

  it("records permanent Expo rejection", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runResultsPublishedPushWorker(
      dependencies(rpcWithClaim(calls, null), {
        createProvider: () => ({
          send: async () => ({
            statusCode: 400,
            body: {
              data: [
                {
                  status: "error",
                  message: "Invalid credentials",
                  details: { error: "InvalidCredentials" },
                },
              ],
            },
          }),
        }),
      }),
    );
    expect(result).toEqual({
      code: "provider_rejected",
      deliveryId,
      kind: "failed_permanent",
    });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_rejected",
      p_retry_at: null,
    });
  });

  it("retires invalid devices only after recording the provider-invalid failure", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runResultsPublishedPushWorker(
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
      "claim_results_published_push",
      "record_results_push_invalid_device",
    ]);
    expect(calls[1]?.args).toEqual({
      p_delivery_id: deliveryId,
      p_claim_token: claimToken,
      p_device_id: deviceId,
      p_group_id: groupId,
      p_correlation_id: "80000000-0000-4000-8000-000000000001",
      p_operation_id: "80000000-0000-4000-8000-000000000002",
    });
    expect(JSON.stringify(calls)).not.toContain(row.expo_push_token);
  });

  it("records malformed provider responses as permanent failures", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runResultsPublishedPushWorker(
      dependencies(rpcWithClaim(calls, null), {
        createProvider: () => ({
          send: async () => ({ statusCode: 200, body: { data: [] } }),
        }),
      }),
    );
    expect(result).toEqual({
      code: "provider_invalid_response",
      deliveryId,
      kind: "failed_permanent",
    });
    expect(calls[1]?.name).toBe("record_results_push_send_failure");
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_invalid_response",
      p_retry_at: null,
    });
  });

  it("abandons a delivery after the configured attempt limit", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_results_published_push") {
        return { data: [{ ...row, attempt_number: 2 }], error: null };
      }
      return { data: null, error: null };
    };
    const result = await runResultsPublishedPushWorker(
      dependencies(rpc, { getConfig: () => ({ ...config(), maxAttempts: 1 }) }),
    );
    expect(result).toEqual({
      code: "max_attempts_exceeded",
      deliveryId,
      kind: "abandoned",
    });
    expect(calls[1]?.name).toBe("record_results_push_send_failure");
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "max_attempts_exceeded",
      p_retry_at: null,
    });
  });
});
