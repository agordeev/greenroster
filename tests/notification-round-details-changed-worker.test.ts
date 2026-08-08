import { describe, expect, it } from "vitest";

import { renderRoundDetailsChangedEmail } from "../apps/web/src/emails/round-details-changed";
import {
  runRoundDetailsChangedEmailWorker,
  type RoundDetailsChangedEmailWorkerDependencies,
} from "../apps/web/src/lib/notifications/round-details-changed-email-worker";
import type { NotificationRpcClient } from "../apps/web/src/lib/notifications/invitation-email-worker";

const deliveryId = "72000000-0000-4000-8000-000000000001";
const outboxJobId = "72000000-0000-4000-8000-000000000002";
const roundId = "72000000-0000-4000-8000-000000000003";
const groupId = "72000000-0000-4000-8000-000000000004";
const claimToken = "claim-token-that-is-not-a-provider-secret";
const now = new Date("2026-08-03T12:00:00.000Z");

const row = {
  delivery_id: deliveryId,
  outbox_job_id: outboxJobId,
  round_id: roundId,
  group_id: groupId,
  group_name: "Saturday League",
  group_time_zone: "America/New_York",
  round_description: "August Championship",
  scheduled_at: "2026-08-15T13:00:00.000Z",
  venue: "Pine Valley",
  rsvp_deadline_at: "2026-08-12T13:00:00.000Z",
  recipient_address: "member@example.com",
  attempt_number: 1,
};

function config() {
  return {
    appUrl: "https://greenroster.example",
    resendApiKey: "re_test_key",
    resendFromEmail: "GreenRoster <rounds@example.com>",
    maxAttempts: 3,
    retrySeconds: 90,
  };
}

function dependencies(
  rpc: NotificationRpcClient["rpc"],
  overrides?: Partial<RoundDetailsChangedEmailWorkerDependencies>,
): RoundDetailsChangedEmailWorkerDependencies {
  return {
    createClaimToken: () => claimToken,
    createClient: () => ({ rpc }),
    createProvider: () => ({
      send: async () => ({ data: { id: "provider-details-1" }, error: null }),
    }),
    getConfig: () => config(),
    now: () => now,
    renderEmail: renderRoundDetailsChangedEmail,
    ...overrides,
  };
}

function successRpc(claimedRow: Record<string, unknown> = row) {
  const calls: Array<{
    name: string;
    args: Readonly<Record<string, unknown>>;
  }> = [];
  const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
    calls.push({ name, args });
    if (name === "claim_round_details_changed_email") {
      return { data: [claimedRow], error: null };
    }
    return { data: null, error: null };
  };
  return { calls, rpc };
}

describe("round-details-changed notification worker", () => {
  it("claims, renders, sends idempotently, and finalizes a details email", async () => {
    const { calls, rpc } = successRpc();
    let providerMessage: Record<string, unknown> | null = null;
    let providerOptions: Readonly<{ idempotencyKey: string }> | null = null;
    const result = await runRoundDetailsChangedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async (message, options) => {
            providerMessage = message;
            providerOptions = options;
            return { data: { id: "provider-details-1" }, error: null };
          },
        }),
      }),
    );

    expect(result).toEqual({
      deliveryId,
      kind: "sent",
      providerMessageId: "provider-details-1",
    });
    expect(providerOptions).toEqual({
      idempotencyKey: `round-details-changed/${deliveryId}`,
    });
    expect(providerMessage?.to).toBe("member@example.com");
    expect(providerMessage?.text).toContain("Pine Valley");
    expect(providerMessage?.text).toContain("RSVP deadline:");
    expect(providerMessage?.text).toContain(
      "Manage optional e-mail notifications: https://greenroster.example/member/home#notifications",
    );
    expect(calls.map((call) => call.name)).toEqual([
      "claim_round_details_changed_email",
      "record_email_send_success",
    ]);
    expect(calls[0]?.args).toEqual({
      p_claim_token: claimToken,
      p_stale_before: "2026-08-03T11:58:30.000Z",
    });
  });

  it("returns empty without sending when the claim has no due delivery", async () => {
    let providerCalled = false;
    const rpc: NotificationRpcClient["rpc"] = async () => ({
      data: [],
      error: null,
    });
    const result = await runRoundDetailsChangedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => {
            providerCalled = true;
            return { data: { id: "unexpected" }, error: null };
          },
        }),
      }),
    );
    expect(result).toEqual({ kind: "empty" });
    expect(providerCalled).toBe(false);
  });

  it("records invalid app URLs as rendering failures", async () => {
    const { calls, rpc } = successRpc();
    let providerCalled = false;
    const result = await runRoundDetailsChangedEmailWorker(
      dependencies(rpc, {
        getConfig: () => ({ ...config(), appUrl: "ftp://greenroster.example" }),
        createProvider: () => ({
          send: async () => {
            providerCalled = true;
            return { data: { id: "unexpected" }, error: null };
          },
        }),
      }),
    );

    expect(result).toEqual({
      code: "provider_invalid_response",
      deliveryId,
      kind: "failed_permanent",
    });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_invalid_response",
      p_retry_at: null,
    });
    expect(providerCalled).toBe(false);
  });

  it("rejects malformed claim rows without sending", async () => {
    let providerCalled = false;
    const { calls, rpc } = successRpc({ ...row, unexpected: "private notes" });
    const result = await runRoundDetailsChangedEmailWorker(
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

  it("records a retryable provider failure", async () => {
    const { calls, rpc } = successRpc();
    const result = await runRoundDetailsChangedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 429 } }),
        }),
      }),
    );
    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_rate_limited",
      p_retry_at: "2026-08-03T12:01:30.000Z",
    });
  });

  it("records HTTP 5xx provider responses as retryable outages", async () => {
    const { calls, rpc } = successRpc();
    const result = await runRoundDetailsChangedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 503 } }),
        }),
      }),
    );

    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-03T12:01:30.000Z",
    });
  });

  it("uses attempt-dependent backoff for later provider outages", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_round_details_changed_email") {
        return { data: [{ ...row, attempt_number: 2 }], error: null };
      }
      return { data: null, error: null };
    };
    const result = await runRoundDetailsChangedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 503 } }),
        }),
      }),
    );

    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-03T12:03:00.000Z",
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
      if (name === "claim_round_details_changed_email") {
        return { data: [{ ...row, attempt_number: 7 }], error: null };
      }
      return { data: null, error: null };
    };
    const result = await runRoundDetailsChangedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => {
            providerCalls += 1;
            return { data: null, error: { statusCode: 503 } };
          },
        }),
        getConfig: () => ({ ...config(), maxAttempts: 10 }),
      }),
    );

    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(providerCalls).toBe(1);
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-03T12:24:00.000Z",
    });
  });

  it("records thrown provider network errors as retryable outages", async () => {
    const { calls, rpc } = successRpc();
    const result = await runRoundDetailsChangedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => {
            throw new TypeError("fetch failed");
          },
        }),
      }),
    );

    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-03T12:01:30.000Z",
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
      if (name === "claim_round_details_changed_email") {
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
          : { data: { id: "provider-details-recovered" }, error: null };
      },
    };

    const first = await runRoundDetailsChangedEmailWorker(
      dependencies(rpc, { createProvider: () => provider }),
    );
    const second = await runRoundDetailsChangedEmailWorker(
      dependencies(rpc, { createProvider: () => provider }),
    );

    expect(first).toEqual({ kind: "retryable", deliveryId });
    expect(second).toEqual({
      kind: "sent",
      deliveryId,
      providerMessageId: "provider-details-recovered",
    });
    expect(calls.map((call) => call.name)).toEqual([
      "claim_round_details_changed_email",
      "record_email_send_failure",
      "claim_round_details_changed_email",
      "record_email_send_success",
    ]);
    expect(calls[1]?.args).toMatchObject({
      p_delivery_id: deliveryId,
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-08-03T12:01:30.000Z",
    });
    expect(calls[3]?.args).toMatchObject({
      p_delivery_id: deliveryId,
      p_provider_message_id: "provider-details-recovered",
    });
  });

  it("records a permanent provider failure", async () => {
    const { calls, rpc } = successRpc();
    const result = await runRoundDetailsChangedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 400 } }),
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

  it("records a rendering failure as permanent", async () => {
    const { calls, rpc } = successRpc();
    const result = await runRoundDetailsChangedEmailWorker(
      dependencies(rpc, {
        renderEmail: () => {
          throw new Error("template failed");
        },
      }),
    );
    expect(result).toEqual({
      code: "provider_invalid_response",
      deliveryId,
      kind: "failed_permanent",
    });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_invalid_response",
      p_retry_at: null,
    });
  });
});
