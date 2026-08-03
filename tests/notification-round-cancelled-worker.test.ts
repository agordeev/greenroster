import { describe, expect, it } from "vitest";

import { renderRoundCancelledEmail } from "../apps/web/src/emails/round-cancelled";
import {
  runRoundCancelledEmailWorker,
  type RoundCancelledEmailWorkerDependencies,
} from "../apps/web/src/lib/notifications/round-cancelled-email-worker";
import type { NotificationRpcClient } from "../apps/web/src/lib/notifications/invitation-email-worker";

const deliveryId = "71000000-0000-4000-8000-000000000001";
const outboxJobId = "71000000-0000-4000-8000-000000000002";
const roundId = "71000000-0000-4000-8000-000000000003";
const groupId = "71000000-0000-4000-8000-000000000004";
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
  cancellation_reason: "Course closed for maintenance",
  recipient_address: "member@example.com",
  attempt_number: 1,
};

function config() {
  return {
    resendApiKey: "re_test_key",
    resendFromEmail: "GreenRoster <rounds@example.com>",
    maxAttempts: 3,
    retrySeconds: 90,
  };
}

function dependencies(
  rpc: NotificationRpcClient["rpc"],
  overrides?: Partial<RoundCancelledEmailWorkerDependencies>,
): RoundCancelledEmailWorkerDependencies {
  return {
    createClaimToken: () => claimToken,
    createClient: () => ({ rpc }),
    createProvider: () => ({
      send: async () => ({ data: { id: "provider-cancelled-1" }, error: null }),
    }),
    getConfig: () => config(),
    now: () => now,
    renderEmail: renderRoundCancelledEmail,
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
    if (name === "claim_round_cancelled_email") {
      return { data: [row], error: null };
    }
    return { data: null, error: null };
  };
  return { calls, rpc };
}

describe("round-cancelled notification worker", () => {
  it("claims, renders, sends idempotently, and finalizes a mandatory cancellation email", async () => {
    const { calls, rpc } = successRpc();
    let providerMessage: Record<string, unknown> | null = null;
    let providerOptions: Readonly<{ idempotencyKey: string }> | null = null;
    const result = await runRoundCancelledEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async (message, options) => {
            providerMessage = message;
            providerOptions = options;
            return { data: { id: "provider-cancelled-1" }, error: null };
          },
        }),
      }),
    );

    expect(result).toEqual({
      deliveryId,
      kind: "sent",
      providerMessageId: "provider-cancelled-1",
    });
    expect(providerOptions).toEqual({
      idempotencyKey: `round-cancelled/${deliveryId}`,
    });
    expect(providerMessage?.to).toBe("member@example.com");
    expect(providerMessage?.text).toContain("Course closed for maintenance");
    expect(providerMessage?.text).toContain("August Championship");
    expect(calls.map((call) => call.name)).toEqual([
      "claim_round_cancelled_email",
      "record_email_send_success",
    ]);
    expect(calls[0]?.args).toEqual({
      p_claim_token: claimToken,
      p_stale_before: "2026-08-03T11:58:30.000Z",
    });
  });

  it("returns empty without sending when no cancellation is due", async () => {
    let providerCalled = false;
    const rpc: NotificationRpcClient["rpc"] = async () => ({
      data: [],
      error: null,
    });
    const result = await runRoundCancelledEmailWorker(
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

  it("records a retryable provider failure", async () => {
    const { calls, rpc } = successRpc();
    const result = await runRoundCancelledEmailWorker(
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
});
