import { describe, expect, it } from "vitest";

import { renderResultsPublishedEmail } from "../apps/web/src/emails/results-published";
import {
  runResultsPublishedEmailWorker,
  type ResultsPublishedEmailWorkerDependencies,
} from "../apps/web/src/lib/notifications/results-published-email-worker";
import type { NotificationRpcClient } from "../apps/web/src/lib/notifications/invitation-email-worker";

const deliveryId = "70000000-0000-4000-8000-000000000001";
const outboxJobId = "70000000-0000-4000-8000-000000000002";
const completionId = "70000000-0000-4000-8000-000000000003";
const roundId = "70000000-0000-4000-8000-000000000004";
const groupId = "70000000-0000-4000-8000-000000000005";
const claimToken = "claim-token-that-is-not-a-provider-secret";
const now = new Date("2026-08-04T12:00:00.000Z");

const row = {
  delivery_id: deliveryId,
  outbox_job_id: outboxJobId,
  completion_id: completionId,
  round_id: roundId,
  group_id: groupId,
  group_name: "Saturday League",
  group_time_zone: "America/New_York",
  round_description: "August Championship",
  completed_at: "2026-08-04T12:00:00.000Z",
  recipient_address: "member@example.com",
  attempt_number: 1,
};

function config() {
  return {
    appUrl: "https://greenroster.example",
    resendApiKey: "re_test_key",
    resendFromEmail: "GreenRoster <results@example.com>",
    maxAttempts: 3,
    retrySeconds: 90,
  };
}

function dependencies(
  rpc: NotificationRpcClient["rpc"],
  overrides?: Partial<ResultsPublishedEmailWorkerDependencies>,
): ResultsPublishedEmailWorkerDependencies {
  return {
    createClaimToken: () => claimToken,
    createClient: () => ({ rpc }),
    createProvider: () => ({
      send: async () => ({ data: { id: "provider-results-1" }, error: null }),
    }),
    getConfig: () => config(),
    now: () => now,
    renderEmail: renderResultsPublishedEmail,
    ...overrides,
  };
}

function successRpc() {
  const calls: Array<{
    name: string;
    args: Readonly<Record<string, unknown>>;
  }> = [];
  const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
    calls.push({ name, args });
    if (name === "claim_results_published_email") {
      return { data: [row], error: null };
    }
    return { data: null, error: null };
  };
  return { calls, rpc };
}

describe("results-published notification worker", () => {
  it("strictly parses the claim, sends through Resend, and finalizes", async () => {
    const { calls, rpc } = successRpc();
    let providerMessage: Record<string, unknown> | null = null;
    let providerOptions: Readonly<{ idempotencyKey: string }> | null = null;
    const result = await runResultsPublishedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async (message, options) => {
            providerMessage = message;
            providerOptions = options;
            return { data: { id: "provider-results-1" }, error: null };
          },
        }),
      }),
    );

    expect(result).toEqual({
      deliveryId,
      kind: "sent",
      providerMessageId: "provider-results-1",
    });
    expect(providerOptions).toEqual({
      idempotencyKey: `results-published/${deliveryId}`,
    });
    expect(providerMessage?.to).toBe("member@example.com");
    expect(providerMessage?.subject).toContain("August Championship");
    expect(providerMessage?.text).toContain("Official results");
    expect(providerMessage?.text).toContain(
      `https://greenroster.example/member/results?round_id=${roundId}`,
    );
    expect(providerMessage?.text).toContain(
      "https://greenroster.example/member/home#notifications",
    );
    expect(calls.map((call) => call.name)).toEqual([
      "claim_results_published_email",
      "record_results_email_send_success",
    ]);
    expect(calls[0]?.args).toEqual({
      p_claim_token: claimToken,
      p_stale_before: "2026-08-04T11:58:30.000Z",
    });
    expect(calls[1]?.args).toEqual({
      p_delivery_id: deliveryId,
      p_claim_token: claimToken,
      p_provider_message_id: "provider-results-1",
    });
  });

  it("terminalizes a malformed claimed row without sending", async () => {
    let providerCalled = false;
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      return {
        data: [{ ...row, attempt_number: "not-a-number" }],
        error: null,
      };
    };
    const result = await runResultsPublishedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => {
            providerCalled = true;
            return { data: { id: "unexpected" }, error: null };
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
      p_safe_error: "invalid_claim",
      p_retry_at: null,
    });
  });

  it("records retryable provider failures with the results RPC", async () => {
    const { calls, rpc } = successRpc();
    const result = await runResultsPublishedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 429 } }),
        }),
      }),
    );
    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(calls[1]?.name).toBe("record_results_email_send_failure");
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_rate_limited",
      p_retry_at: "2026-08-04T12:01:30.000Z",
    });
  });

  it("records provider HTTP 5xx responses as retryable outages", async () => {
    const { calls, rpc } = successRpc();
    const result = await runResultsPublishedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 503 } }),
        }),
      }),
    );

    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(calls[1]?.name).toBe("record_results_email_send_failure");
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-04T12:01:30.000Z",
    });
  });

  it("uses bounded attempt-dependent backoff for later outages", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_results_published_email") {
        return { data: [{ ...row, attempt_number: 2 }], error: null };
      }
      return { data: null, error: null };
    };
    const result = await runResultsPublishedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 503 } }),
        }),
      }),
    );

    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-04T12:03:00.000Z",
    });
  });

  it("caps repeated retry backoff at sixteen base intervals", async () => {
    const { calls, rpc } = successRpc();
    const result = await runResultsPublishedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 503 } }),
        }),
        getConfig: () => ({ ...config(), maxAttempts: 10 }),
      }),
    );

    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-04T12:01:30.000Z",
    });

    const cappedCalls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const cappedRpc: NotificationRpcClient["rpc"] = async (name, args) => {
      cappedCalls.push({ name, args });
      if (name === "claim_results_published_email") {
        return { data: [{ ...row, attempt_number: 7 }], error: null };
      }
      return { data: null, error: null };
    };
    await runResultsPublishedEmailWorker(
      dependencies(cappedRpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 503 } }),
        }),
        getConfig: () => ({ ...config(), maxAttempts: 10 }),
      }),
    );
    expect(cappedCalls[1]?.args).toMatchObject({
      p_retry_at: "2026-08-04T12:24:00.000Z",
    });
  });

  it("records thrown provider network errors as retryable outages", async () => {
    const { calls, rpc } = successRpc();
    const result = await runResultsPublishedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => {
            throw new TypeError("fetch failed");
          },
        }),
      }),
    );

    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(calls[1]?.name).toBe("record_results_email_send_failure");
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-04T12:01:30.000Z",
    });
  });

  it("drains a retried outage successfully on the next worker run", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    let claimCount = 0;
    let providerCount = 0;
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_results_published_email") {
        claimCount += 1;
        return {
          data: [{ ...row, attempt_number: claimCount }],
          error: null,
        };
      }
      return { data: null, error: null };
    };

    const provider = {
      send: async () => {
        providerCount += 1;
        return providerCount === 1
          ? { data: null, error: { statusCode: 503 } }
          : { data: { id: "provider-results-recovered" }, error: null };
      },
    };

    const first = await runResultsPublishedEmailWorker(
      dependencies(rpc, { createProvider: () => provider }),
    );
    const second = await runResultsPublishedEmailWorker(
      dependencies(rpc, { createProvider: () => provider }),
    );

    expect(first).toEqual({ kind: "retryable", deliveryId });
    expect(second).toEqual({
      kind: "sent",
      deliveryId,
      providerMessageId: "provider-results-recovered",
    });
    expect(calls.map((call) => call.name)).toEqual([
      "claim_results_published_email",
      "record_results_email_send_failure",
      "claim_results_published_email",
      "record_results_email_send_success",
    ]);
    expect(calls[1]?.args).toMatchObject({
      p_delivery_id: deliveryId,
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-04T12:01:30.000Z",
    });
    expect(calls[3]?.args).toMatchObject({
      p_delivery_id: deliveryId,
      p_provider_message_id: "provider-results-recovered",
    });
  });

  it("records permanent provider rejections", async () => {
    const { calls, rpc } = successRpc();
    const result = await runResultsPublishedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({
            data: null,
            error: { name: "invalid_from_address", statusCode: 400 },
          }),
        }),
      }),
    );
    expect(result).toEqual({
      code: "provider_rejected",
      deliveryId,
      kind: "failed_permanent",
    });
    expect(calls[1]?.name).toBe("record_results_email_send_failure");
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_rejected",
      p_retry_at: null,
    });
  });

  it("records malformed provider responses as permanent failures", async () => {
    const { calls, rpc } = successRpc();
    const result = await runResultsPublishedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: null }),
        }),
      }),
    );
    expect(result).toEqual({
      code: "provider_invalid_response",
      deliveryId,
      kind: "failed_permanent",
    });
    expect(calls[1]?.name).toBe("record_results_email_send_failure");
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
    const exhaustedRpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_results_published_email") {
        return { data: [{ ...row, attempt_number: 2 }], error: null };
      }
      return { data: null, error: null };
    };
    const exhausted = await runResultsPublishedEmailWorker(
      dependencies(exhaustedRpc, {
        getConfig: () => ({ ...config(), maxAttempts: 1 }),
      }),
    );
    expect(exhausted).toEqual({
      code: "max_attempts_exceeded",
      deliveryId,
      kind: "abandoned",
    });
    expect(calls[1]?.name).toBe("record_results_email_send_failure");
  });
});
