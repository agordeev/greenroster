import { describe, expect, it } from "vitest";

import { renderInvitationDeliveryFailedEmail } from "../apps/web/src/emails/invitation-delivery-failed";
import {
  runInvitationDeliveryFailedEmailWorker,
  type InvitationDeliveryFailedEmailWorkerDependencies,
} from "../apps/web/src/lib/notifications/invitation-delivery-failed-email-worker";
import type { NotificationRpcClient } from "../apps/web/src/lib/notifications/invitation-email-worker";

const deliveryId = "77000000-0000-4000-8000-000000000001";
const outboxJobId = "77000000-0000-4000-8000-000000000002";
const invitationId = "77000000-0000-4000-8000-000000000003";
const groupId = "77000000-0000-4000-8000-000000000004";
const claimToken = "77000000-0000-4000-8000-000000000005";
const now = new Date("2026-08-05T12:00:00.000Z");

const row = {
  delivery_id: deliveryId,
  outbox_job_id: outboxJobId,
  invitation_id: invitationId,
  group_id: groupId,
  group_name: "Saturday League",
  recipient_address: "admin@example.com",
  invited_address: "bounced-invite@example.com",
  attempt_number: 1,
};

function config() {
  return {
    appUrl: "https://greenroster.example",
    resendApiKey: "re_test_key",
    resendFromEmail: "GreenRoster <alerts@example.com>",
    maxAttempts: 3,
    retrySeconds: 90,
  };
}

function dependencies(
  rpc: NotificationRpcClient["rpc"],
  overrides?: Partial<InvitationDeliveryFailedEmailWorkerDependencies>,
): InvitationDeliveryFailedEmailWorkerDependencies {
  return {
    createClaimToken: () => claimToken,
    createClient: () => ({ rpc }),
    createProvider: () => ({
      send: async () => ({ data: { id: "provider-alert-1" }, error: null }),
    }),
    getConfig: () => config(),
    now: () => now,
    renderEmail: renderInvitationDeliveryFailedEmail,
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
    if (name === "claim_invitation_delivery_failed_email") {
      return { data: [row], error: null };
    }
    return { data: null, error: null };
  };
  return { calls, rpc };
}

describe("invitation delivery failed email worker", () => {
  it("claims, sends the dashboard alert, and finalizes with deterministic idempotency", async () => {
    const { calls, rpc } = successRpc();
    let providerMessage: Record<string, unknown> | null = null;
    let providerOptions: Readonly<{ idempotencyKey: string }> | null = null;
    const result = await runInvitationDeliveryFailedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async (message, options) => {
            providerMessage = message;
            providerOptions = options;
            return { data: { id: "provider-alert-1" }, error: null };
          },
        }),
      }),
    );

    expect(result).toEqual({
      deliveryId,
      kind: "sent",
      providerMessageId: "provider-alert-1",
    });
    expect(providerMessage?.to).toBe("admin@example.com");
    expect(providerMessage?.subject).toContain("Saturday League");
    expect(providerMessage?.text).toContain("bounced-invite@example.com");
    expect(providerMessage?.text).toContain(
      "/portal/invitations?delivery=action-required&invitation=" + invitationId,
    );
    expect(providerOptions).toEqual({
      idempotencyKey: `invitation-delivery-failed/${deliveryId}`,
    });
    expect(calls.map((call) => call.name)).toEqual([
      "claim_invitation_delivery_failed_email",
      "record_email_send_success",
    ]);
    expect(calls[0]?.args).toEqual({
      p_claim_token: claimToken,
      p_stale_before: "2026-08-05T11:58:30.000Z",
    });
  });

  it("records a thrown provider outage as retryable for the next drain", async () => {
    const { calls, rpc } = successRpc();
    const result = await runInvitationDeliveryFailedEmailWorker(
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
      p_retry_at: "2026-08-05T12:01:30.000Z",
    });
  });

  it("uses bounded attempt-dependent backoff for later retries", async () => {
    const calls: Array<Readonly<Record<string, unknown>>> = [];
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, ...args });
      if (name === "claim_invitation_delivery_failed_email") {
        return { data: [{ ...row, attempt_number: 2 }], error: null };
      }
      return { data: null, error: null };
    };
    const result = await runInvitationDeliveryFailedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 503 } }),
        }),
      }),
    );

    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(calls[1]).toMatchObject({
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
      if (name === "claim_invitation_delivery_failed_email") {
        return { data: [{ ...row, attempt_number: 7 }], error: null };
      }
      return { data: null, error: null };
    };
    const result = await runInvitationDeliveryFailedEmailWorker(
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
      p_retry_at: "2026-08-05T12:24:00.000Z",
    });
  });

  it("abandons a claim after the configured attempt limit", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_invitation_delivery_failed_email") {
        return { data: [{ ...row, attempt_number: 4 }], error: null };
      }
      return { data: null, error: null };
    };
    const result = await runInvitationDeliveryFailedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => {
            throw new Error("provider should not be called");
          },
        }),
      }),
    );

    expect(result).toEqual({
      code: "max_attempts_exceeded",
      deliveryId,
      kind: "abandoned",
    });
    expect(calls[1]).toEqual({
      name: "record_email_send_failure",
      args: {
        p_claim_token: claimToken,
        p_delivery_id: deliveryId,
        p_retry_at: null,
        p_safe_error: "max_attempts_exceeded",
      },
    });
  });

  it("does not send when the trusted claim shape is invalid", async () => {
    let sends = 0;
    const rpc: NotificationRpcClient["rpc"] = async () => ({
      data: [{ ...row, invited_address: "not-an-email" }],
      error: null,
    });
    const result = await runInvitationDeliveryFailedEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => {
            sends += 1;
            return { data: { id: "provider-alert-1" }, error: null };
          },
        }),
      }),
    );

    expect(result).toEqual({
      code: "invalid_claim",
      deliveryId,
      kind: "failed_permanent",
    });
    expect(sends).toBe(0);
  });
});
