import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { renderMembershipInvitationEmail } from "../apps/web/src/emails/membership-invitation";
import {
  runInvitationEmailWorker,
  type InvitationEmailWorkerDependencies,
  type NotificationRpcClient,
} from "../apps/web/src/lib/notifications/invitation-email-worker";

const deliveryId = "60000000-0000-4000-8000-000000000001";
const outboxJobId = "60000000-0000-4000-8000-000000000002";
const invitationId = "60000000-0000-4000-8000-000000000003";
const groupId = "60000000-0000-4000-8000-000000000004";
const tokenSecret = "0123456789abcdef0123456789abcdef";
const claimToken = "claim-token-that-is-not-the-invitation-token";
const now = new Date("2026-07-26T12:00:00.000Z");

const row = {
  delivery_id: deliveryId,
  outbox_job_id: outboxJobId,
  invitation_id: invitationId,
  group_id: groupId,
  group_name: "Saturday League",
  recipient_address: "member@example.com",
  member_first_name: "Ava",
  invitation_expires_at: "2026-08-01T12:00:00.000Z",
  token_key_version: 1,
  attempt_number: 1,
};

function baseConfig() {
  return {
    appUrl: "https://greenroster.example",
    invitationTokenSecret: tokenSecret,
    resendApiKey: "re_test_key",
    resendFromEmail: "GreenRoster <invite@example.com>",
    maxAttempts: 3,
    retrySeconds: 90,
  };
}

function makeDependencies(
  rpc: NotificationRpcClient["rpc"],
  overrides?: Partial<InvitationEmailWorkerDependencies>,
): InvitationEmailWorkerDependencies {
  return {
    createClaimToken: () => claimToken,
    createClient: () => ({ rpc }),
    createProvider: () => ({
      send: async () => ({ data: { id: "provider-message-1" }, error: null }),
    }),
    getConfig: () => baseConfig(),
    now: () => now,
    renderEmail: renderMembershipInvitationEmail,
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
    if (name === "claim_membership_invitation_email") {
      return { data: [row], error: null };
    }
    return { data: null, error: null };
  };
  return { calls, rpc };
}

describe("invitation notification worker", () => {
  it("claims one delivery, sends an idempotent accessible email, and finalizes it", async () => {
    const { calls, rpc } = successRpc();
    let providerMessage: Record<string, unknown> | null = null;
    let providerOptions: Readonly<{ idempotencyKey: string }> | null = null;
    const result = await runInvitationEmailWorker(
      makeDependencies(rpc, {
        createProvider: () => ({
          send: async (message, options) => {
            providerMessage = message;
            providerOptions = options;
            return { data: { id: "provider-message-1" }, error: null };
          },
        }),
      }),
    );

    expect(result).toEqual({
      deliveryId,
      kind: "sent",
      providerMessageId: "provider-message-1",
    });
    expect(providerOptions).toEqual({
      idempotencyKey: `membership-invitation/${deliveryId}`,
    });
    expect(providerMessage?.to).toBe("member@example.com");
    expect(providerMessage?.text).toContain("as a member on GreenRoster");
    expect(providerMessage?.html).toContain("Accept your invitation");

    const rawToken = createHmac("sha256", tokenSecret)
      .update(`${invitationId}:1`, "utf8")
      .digest("base64url");
    const tokenDigest = createHash("sha256")
      .update(rawToken, "utf8")
      .digest("hex");
    expect(tokenDigest).not.toBe(claimToken);
    expect(String(providerMessage?.html)).toContain(`token=${rawToken}`);
    const rpcText = JSON.stringify(calls);
    expect(rpcText).not.toContain(rawToken);
    expect(rpcText).not.toContain(tokenDigest);
    expect(calls.map((call) => call.name)).toEqual([
      "claim_membership_invitation_email",
      "record_email_send_success",
    ]);
    expect(calls[0]?.args).toEqual({
      p_claim_token: claimToken,
      p_stale_before: "2026-07-26T11:58:30.000Z",
    });
    expect(calls[1]?.args).toMatchObject({
      p_delivery_id: deliveryId,
      p_provider_message_id: "provider-message-1",
    });
  });

  it("returns empty without calling the provider", async () => {
    let providerCalled = false;
    const rpc: NotificationRpcClient["rpc"] = async () => ({
      data: [],
      error: null,
    });
    const result = await runInvitationEmailWorker(
      makeDependencies(rpc, {
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

  it("records retry for rate limits and permanent failure for deterministic provider rejection", async () => {
    const retry = successRpc();
    const retryResult = await runInvitationEmailWorker(
      makeDependencies(retry.rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 429 } }),
        }),
      }),
    );
    expect(retryResult).toEqual({ kind: "retryable", deliveryId });
    expect(retry.calls[1]?.args).toMatchObject({
      p_safe_error: "provider_rate_limited",
      p_retry_at: "2026-07-26T12:01:30.000Z",
    });

    const permanent = successRpc();
    const permanentResult = await runInvitationEmailWorker(
      makeDependencies(permanent.rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 400 } }),
        }),
      }),
    );
    expect(permanentResult).toEqual({
      code: "provider_rejected",
      deliveryId,
      kind: "failed_permanent",
    });
    expect(permanent.calls[1]?.args).toMatchObject({
      p_safe_error: "provider_rejected",
      p_retry_at: null,
    });

    const concurrent = successRpc();
    const concurrentResult = await runInvitationEmailWorker(
      makeDependencies(concurrent.rpc, {
        createProvider: () => ({
          send: async () => ({
            data: null,
            error: {
              name: "concurrent_idempotent_requests",
              statusCode: 409,
            },
          }),
        }),
      }),
    );
    expect(concurrentResult).toEqual({ kind: "retryable", deliveryId });
    expect(concurrent.calls[1]?.args).toMatchObject({
      p_safe_error: "provider_rate_limited",
      p_retry_at: "2026-07-26T12:01:30.000Z",
    });

    const invalidKey = successRpc();
    const invalidKeyResult = await runInvitationEmailWorker(
      makeDependencies(invalidKey.rpc, {
        createProvider: () => ({
          send: async () => ({
            data: null,
            error: { name: "invalid_api_key", statusCode: null },
          }),
        }),
      }),
    );
    expect(invalidKeyResult).toEqual({
      code: "provider_rejected",
      deliveryId,
      kind: "failed_permanent",
    });
  });

  it("keeps provider outages retryable and records a safe outage code", async () => {
    const serverError = successRpc();
    const serverErrorResult = await runInvitationEmailWorker(
      makeDependencies(serverError.rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 503 } }),
        }),
      }),
    );
    expect(serverErrorResult).toEqual({ kind: "retryable", deliveryId });
    expect(serverError.calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-07-26T12:01:30.000Z",
    });

    const networkError = successRpc();
    const networkErrorResult = await runInvitationEmailWorker(
      makeDependencies(networkError.rpc, {
        createProvider: () => ({
          send: async () => {
            throw new Error("provider network unavailable");
          },
        }),
      }),
    );
    expect(networkErrorResult).toEqual({ kind: "retryable", deliveryId });
    expect(networkError.calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-07-26T12:01:30.000Z",
    });
  });

  it("uses attempt-dependent backoff for later provider outages", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const rpc: NotificationRpcClient["rpc"] = async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_membership_invitation_email") {
        return { data: [{ ...row, attempt_number: 2 }], error: null };
      }
      return { data: null, error: null };
    };
    const result = await runInvitationEmailWorker(
      makeDependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 503 } }),
        }),
      }),
    );

    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-07-26T12:03:00.000Z",
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
      if (name === "claim_membership_invitation_email") {
        return { data: [{ ...row, attempt_number: 7 }], error: null };
      }
      return { data: null, error: null };
    };
    const result = await runInvitationEmailWorker(
      makeDependencies(rpc, {
        createProvider: () => ({
          send: async () => {
            providerCalls += 1;
            return { data: null, error: { statusCode: 503 } };
          },
        }),
        getConfig: () => ({ ...baseConfig(), maxAttempts: 10 }),
      }),
    );

    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(providerCalls).toBe(1);
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-07-26T12:24:00.000Z",
    });
  });

  it("honors the injected maximum attempt count", async () => {
    const calls: string[] = [];
    const rpc: NotificationRpcClient["rpc"] = async (name) => {
      calls.push(name);
      return name === "claim_membership_invitation_email"
        ? { data: [{ ...row, attempt_number: 4 }], error: null }
        : { data: null, error: null };
    };
    let providerCalled = false;
    const result = await runInvitationEmailWorker(
      makeDependencies(rpc, {
        createProvider: () => ({
          send: async () => {
            providerCalled = true;
            return { data: { id: "unexpected" }, error: null };
          },
        }),
      }),
    );
    expect(result).toEqual({
      code: "max_attempts_exceeded",
      deliveryId,
      kind: "abandoned",
    });
    expect(providerCalled).toBe(false);
    expect(calls).toEqual([
      "claim_membership_invitation_email",
      "record_email_send_failure",
    ]);
  });

  it("terminalizes malformed claimed rows without sending", async () => {
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
    const result = await runInvitationEmailWorker(
      makeDependencies(rpc, {
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
      p_claim_token: claimToken,
      p_safe_error: "invalid_claim",
      p_retry_at: null,
    });
  });
});
