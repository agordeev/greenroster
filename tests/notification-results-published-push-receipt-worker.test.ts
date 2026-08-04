import { describe, expect, it } from "vitest";

import {
  runResultsPublishedPushReceiptWorker,
  type ResultsPublishedPushReceiptWorkerDependencies,
} from "../apps/web/src/lib/notifications/results-published-push-receipt-worker";
import type { NotificationRpcClient } from "../apps/web/src/lib/notifications/invitation-email-worker";

const receiptId = "71000000-0000-4000-8000-000000000001";
const deliveryId = "71000000-0000-4000-8000-000000000002";
const groupId = "71000000-0000-4000-8000-000000000003";
const deviceId = "71000000-0000-4000-8000-000000000004";
const ticketId = "expo-ticket-receipt-1";
const claimToken = "receipt-claim-token";
const now = new Date("2026-08-04T12:00:00.000Z");

const row = {
  receipt_id: receiptId,
  delivery_id: deliveryId,
  group_id: groupId,
  device_id: deviceId,
  provider_message_id: ticketId,
  attempt_number: 1,
};

function dependencies(
  rpc: NotificationRpcClient["rpc"],
  overrides?: Partial<ResultsPublishedPushReceiptWorkerDependencies>,
): ResultsPublishedPushReceiptWorkerDependencies {
  return {
    createClaimToken: () => claimToken,
    createClient: () => ({ rpc }),
    createCorrelationId: () => "81000000-0000-4000-8000-000000000001",
    createOperationId: () => "81000000-0000-4000-8000-000000000002",
    createProvider: () => ({
      getReceipts: async () => ({
        statusCode: 200,
        body: { data: { [ticketId]: { status: "ok" } } },
      }),
    }),
    getConfig: () => ({ maxAttempts: 3, retrySeconds: 90 }),
    now: () => now,
    ...overrides,
  };
}

function rpcWithClaim(
  calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }>,
  result: unknown = null,
): NotificationRpcClient["rpc"] {
  return async (name, args) => {
    calls.push({ name, args });
    if (name === "claim_results_push_receipt") {
      return { data: [row], error: null };
    }
    return { data: result, error: null };
  };
}

describe("results-published push receipt worker", () => {
  it("claims a ticket receipt and finalizes an Expo success", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runResultsPublishedPushReceiptWorker(
      dependencies(rpcWithClaim(calls)),
    );
    expect(result).toEqual({
      deliveryId,
      kind: "sent",
      providerMessageId: ticketId,
    });
    expect(calls.map((call) => call.name)).toEqual([
      "claim_results_push_receipt",
      "record_results_push_receipt_success",
    ]);
    expect(calls[0]?.args).toEqual({
      p_claim_token: claimToken,
      p_stale_before: "2026-08-04T11:58:30.000Z",
    });
    expect(calls[1]?.args).toEqual({
      p_receipt_id: receiptId,
      p_claim_token: claimToken,
    });
  });

  it("keeps polling when Expo has not published a receipt yet", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runResultsPublishedPushReceiptWorker(
      dependencies(rpcWithClaim(calls), {
        createProvider: () => ({
          getReceipts: async () => ({ statusCode: 200, body: { data: {} } }),
        }),
      }),
    );
    expect(result).toEqual({ deliveryId, kind: "retryable" });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-04T12:01:30.000Z",
    });
  });

  it("retires an invalid device atomically from a delayed receipt", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runResultsPublishedPushReceiptWorker(
      dependencies(rpcWithClaim(calls), {
        createProvider: () => ({
          getReceipts: async () => ({
            statusCode: 200,
            body: {
              data: {
                [ticketId]: {
                  status: "error",
                  message: "The device is not registered",
                  details: { error: "DeviceNotRegistered" },
                },
              },
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
      "claim_results_push_receipt",
      "record_results_push_receipt_invalid_device",
    ]);
    expect(calls[1]?.args).toEqual({
      p_receipt_id: receiptId,
      p_claim_token: claimToken,
      p_device_id: deviceId,
      p_group_id: groupId,
      p_correlation_id: "81000000-0000-4000-8000-000000000001",
      p_operation_id: "81000000-0000-4000-8000-000000000002",
    });
  });

  it("retries provider transport failures", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await runResultsPublishedPushReceiptWorker(
      dependencies(rpcWithClaim(calls), {
        createProvider: () => ({
          getReceipts: async () => {
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

  it("does not expose receipt data when the claim is malformed", async () => {
    let providerCalled = false;
    const rpc: NotificationRpcClient["rpc"] = async () => ({
      data: [{ ...row, unexpected: true }],
      error: null,
    });
    const result = await runResultsPublishedPushReceiptWorker(
      dependencies(rpc, {
        createProvider: () => ({
          getReceipts: async () => {
            providerCalled = true;
            return { statusCode: 200, body: {} };
          },
        }),
      }),
    );
    expect(result).toEqual({ kind: "unavailable" });
    expect(providerCalled).toBe(false);
  });
});
