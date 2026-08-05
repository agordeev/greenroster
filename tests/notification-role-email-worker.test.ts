import { describe, expect, it } from "vitest";

import { renderMembershipRoleChangeEmail } from "../apps/web/src/emails/membership-role-change";
import {
  runMembershipRoleChangeEmailWorker,
  type MembershipRoleChangeEmailWorkerDependencies,
} from "../apps/web/src/lib/notifications/membership-role-change-email-worker";
import type { NotificationRpcClient } from "../apps/web/src/lib/notifications/invitation-email-worker";

const deliveryId = "60000000-0000-4000-8000-000000000001";
const outboxJobId = "60000000-0000-4000-8000-000000000002";
const membershipId = "60000000-0000-4000-8000-000000000003";
const groupId = "60000000-0000-4000-8000-000000000004";
const claimToken = "claim-token-that-is-not-a-provider-secret";
const now = new Date("2026-07-27T12:00:00.000Z");

const row = {
  delivery_id: deliveryId,
  outbox_job_id: outboxJobId,
  membership_id: membershipId,
  group_id: groupId,
  group_name: "Saturday League",
  recipient_address: "member@example.com",
  old_role: "member",
  new_role: "coordinator",
  attempt_number: 1,
};

function config() {
  return {
    appUrl: "https://greenroster.example",
    resendApiKey: "re_test_key",
    resendFromEmail: "GreenRoster <roles@example.com>",
    maxAttempts: 3,
    retrySeconds: 90,
  };
}

function dependencies(
  rpc: NotificationRpcClient["rpc"],
  overrides?: Partial<MembershipRoleChangeEmailWorkerDependencies>,
): MembershipRoleChangeEmailWorkerDependencies {
  return {
    createClaimToken: () => claimToken,
    createClient: () => ({ rpc }),
    createProvider: () => ({
      send: async () => ({ data: { id: "provider-role-1" }, error: null }),
    }),
    getConfig: () => config(),
    now: () => now,
    renderEmail: (input) =>
      renderMembershipRoleChangeEmail({
        ...input,
      }),
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
    if (name === "claim_membership_role_change_email") {
      return { data: [row], error: null };
    }
    return { data: null, error: null };
  };
  return { calls, rpc };
}

describe("membership role-change notification worker", () => {
  it("claims, renders, sends with deterministic provider idempotency, and finalizes", async () => {
    const { calls, rpc } = successRpc();
    let providerMessage: Record<string, unknown> | null = null;
    let providerOptions: Readonly<{ idempotencyKey: string }> | null = null;
    const result = await runMembershipRoleChangeEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async (message, options) => {
            providerMessage = message;
            providerOptions = options;
            return { data: { id: "provider-role-1" }, error: null };
          },
        }),
      }),
    );

    expect(result).toEqual({
      deliveryId,
      kind: "sent",
      providerMessageId: "provider-role-1",
    });
    expect(providerOptions).toEqual({
      idempotencyKey: `membership-role-change/${deliveryId}`,
    });
    expect(providerMessage?.to).toBe("member@example.com");
    expect(providerMessage?.text).toContain("Member to Coordinator");
    expect(providerMessage?.text).toContain(
      `/portal/members?membership=${membershipId}`,
    );
    expect(calls.map((call) => call.name)).toEqual([
      "claim_membership_role_change_email",
      "record_email_send_success",
    ]);
    expect(calls[0]?.args).toEqual({
      p_claim_token: claimToken,
      p_stale_before: "2026-07-27T11:58:30.000Z",
    });
  });

  it("reuses the same provider key when the same delivery is retried", async () => {
    const { rpc } = successRpc();
    const keys: string[] = [];
    const workerDependencies = dependencies(rpc, {
      createProvider: () => ({
        send: async (_message, options) => {
          keys.push(options.idempotencyKey);
          return { data: { id: "provider-role-1" }, error: null };
        },
      }),
    });
    await runMembershipRoleChangeEmailWorker(workerDependencies);
    await runMembershipRoleChangeEmailWorker(workerDependencies);
    expect(keys).toEqual([
      `membership-role-change/${deliveryId}`,
      `membership-role-change/${deliveryId}`,
    ]);
  });

  it("records retryable provider failures and permanent rejection", async () => {
    const retry = successRpc();
    const retryResult = await runMembershipRoleChangeEmailWorker(
      dependencies(retry.rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 429 } }),
        }),
      }),
    );
    expect(retryResult).toEqual({ kind: "retryable", deliveryId });
    expect(retry.calls[1]?.args).toMatchObject({
      p_safe_error: "provider_rate_limited",
      p_retry_at: "2026-07-27T12:01:30.000Z",
    });

    const permanent = successRpc();
    const permanentResult = await runMembershipRoleChangeEmailWorker(
      dependencies(permanent.rpc, {
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
  });

  it("records HTTP 5xx provider responses as retryable outages", async () => {
    const { calls, rpc } = successRpc();
    const result = await runMembershipRoleChangeEmailWorker(
      dependencies(rpc, {
        createProvider: () => ({
          send: async () => ({ data: null, error: { statusCode: 503 } }),
        }),
      }),
    );

    expect(result).toEqual({ kind: "retryable", deliveryId });
    expect(calls[1]?.args).toMatchObject({
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-07-27T12:01:30.000Z",
    });
  });

  it("records thrown provider network errors as retryable outages", async () => {
    const { calls, rpc } = successRpc();
    const result = await runMembershipRoleChangeEmailWorker(
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
      p_retry_at: "2026-07-27T12:01:30.000Z",
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
      if (name === "claim_membership_role_change_email") {
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
          : { data: { id: "provider-role-recovered" }, error: null };
      },
    };

    const first = await runMembershipRoleChangeEmailWorker(
      dependencies(rpc, { createProvider: () => provider }),
    );
    const second = await runMembershipRoleChangeEmailWorker(
      dependencies(rpc, { createProvider: () => provider }),
    );

    expect(first).toEqual({ kind: "retryable", deliveryId });
    expect(second).toEqual({
      kind: "sent",
      deliveryId,
      providerMessageId: "provider-role-recovered",
    });
    expect(calls.map((call) => call.name)).toEqual([
      "claim_membership_role_change_email",
      "record_email_send_failure",
      "claim_membership_role_change_email",
      "record_email_send_success",
    ]);
    expect(calls[1]?.args).toMatchObject({
      p_delivery_id: deliveryId,
      p_safe_error: "provider_unavailable",
      p_retry_at: "2026-07-27T12:01:30.000Z",
    });
    expect(calls[3]?.args).toMatchObject({
      p_delivery_id: deliveryId,
      p_provider_message_id: "provider-role-recovered",
    });
  });

  it("abandons a delivery after the configured maximum attempts without sending", async () => {
    const calls: string[] = [];
    const rpc: NotificationRpcClient["rpc"] = async (name) => {
      calls.push(name);
      return name === "claim_membership_role_change_email"
        ? { data: [{ ...row, attempt_number: 4 }], error: null }
        : { data: null, error: null };
    };
    let providerCalled = false;
    const result = await runMembershipRoleChangeEmailWorker(
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
      code: "max_attempts_exceeded",
      deliveryId,
      kind: "abandoned",
    });
    expect(providerCalled).toBe(false);
    expect(calls).toEqual([
      "claim_membership_role_change_email",
      "record_email_send_failure",
    ]);
  });
});
