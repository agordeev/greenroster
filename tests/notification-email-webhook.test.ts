import { describe, expect, it } from "vitest";

import { handleResendWebhookRequest } from "../apps/web/src/app/api/webhooks/resend/route";
import {
  parseResendFeedbackPayload,
  recordResendFeedback,
} from "../apps/web/src/lib/notifications/resend-feedback";
import type { NotificationRpcClient } from "../apps/web/src/lib/notifications/invitation-email-worker";

const headers = {
  "svix-id": "msg_123",
  "svix-signature": "v1,signature",
  "svix-timestamp": "1774699200",
};

function deliveredPayload() {
  return {
    type: "email.delivered",
    created_at: "2026-07-26T12:00:00.000Z",
    data: {
      email_id: "provider-message-1",
      from: "invite@example.com",
      to: ["Member@Example.com"],
      subject: "Invitation",
    },
  };
}

describe("Resend webhook handling", () => {
  it("maps official feedback events and normalizes exactly one recipient", () => {
    expect(parseResendFeedbackPayload(deliveredPayload())).toEqual({
      kind: "feedback",
      event: {
        bounceType: null,
        eventType: "email.delivered",
        occurredAt: "2026-07-26T12:00:00.000Z",
        providerMessageId: "provider-message-1",
        recipientAddress: "member@example.com",
      },
    });
    expect(
      parseResendFeedbackPayload({
        ...deliveredPayload(),
        type: "email.bounced",
        data: {
          ...deliveredPayload().data,
          bounce: { type: "Permanent", subType: "General" },
        },
      }),
    ).toMatchObject({
      kind: "feedback",
      event: { bounceType: "permanent", eventType: "email.bounced" },
    });
    expect(
      parseResendFeedbackPayload({
        ...deliveredPayload(),
        type: "email.bounced",
        data: {
          ...deliveredPayload().data,
          bounce: { type: "Temporary", subType: "MailboxFull" },
        },
      }),
    ).toMatchObject({
      kind: "feedback",
      event: { bounceType: "transient", eventType: "email.bounced" },
    });
    expect(
      parseResendFeedbackPayload({
        ...deliveredPayload(),
        type: "email.bounced",
        data: {
          ...deliveredPayload().data,
          bounce: { type: "Undetermined", subType: "Undetermined" },
        },
      }),
    ).toMatchObject({
      kind: "feedback",
      event: { bounceType: "undetermined", eventType: "email.bounced" },
    });
    expect(
      parseResendFeedbackPayload({
        ...deliveredPayload(),
        data: {
          ...deliveredPayload().data,
          to: ["one@example.com", "two@example.com"],
        },
      }),
    ).toEqual({ kind: "invalid" });
    expect(parseResendFeedbackPayload({ type: "email.opened" })).toEqual({
      kind: "ignored",
    });
  });

  it("verifies raw body and required Svix headers before processing", async () => {
    const body = JSON.stringify(deliveredPayload());
    let verifiedBody = "";
    let verifiedHeaders: unknown;
    const recorded: unknown[] = [];
    const request = new Request(
      "https://greenroster.example/api/webhooks/resend",
      {
        method: "POST",
        headers,
        body,
      },
    );
    const response = await handleResendWebhookRequest(request, {
      getWebhookSecret: () => "webhook-secret",
      verify: (payload, signatureHeaders, secret) => {
        verifiedBody = payload;
        verifiedHeaders = { signatureHeaders, secret };
        return deliveredPayload();
      },
      createClient: () => ({
        rpc: async () => ({ data: null, error: null }),
      }),
      recordFeedback: async (_client, eventId, event) => {
        recorded.push({ eventId, event });
        return true;
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "processed" });
    expect(verifiedBody).toBe(body);
    expect(verifiedHeaders).toEqual({
      signatureHeaders: {
        id: headers["svix-id"],
        signature: headers["svix-signature"],
        timestamp: headers["svix-timestamp"],
      },
      secret: "webhook-secret",
    });
    expect(recorded[0]).toMatchObject({ eventId: "msg_123" });

    const missingHeaderResponse = await handleResendWebhookRequest(
      new Request("https://greenroster.example/api/webhooks/resend", {
        method: "POST",
        body,
      }),
      { verify: () => deliveredPayload() },
    );
    expect(missingHeaderResponse.status).toBe(400);
  });

  it("returns generic 400 for verification or payload errors and 503 for DB errors", async () => {
    const body = JSON.stringify(deliveredPayload());
    const invalidSignature = await handleResendWebhookRequest(
      new Request("https://greenroster.example/api/webhooks/resend", {
        method: "POST",
        headers,
        body,
      }),
      {
        verify: () => {
          throw new Error("invalid");
        },
      },
    );
    expect(invalidSignature.status).toBe(400);
    expect(await invalidSignature.json()).toEqual({
      ok: false,
      status: "invalid_signature",
    });

    const invalidPayload = await handleResendWebhookRequest(
      new Request("https://greenroster.example/api/webhooks/resend", {
        method: "POST",
        headers,
        body,
      }),
      { verify: () => ({ type: "email.delivered", data: {} }) },
    );
    expect(invalidPayload.status).toBe(400);

    const dbUnavailable = await handleResendWebhookRequest(
      new Request("https://greenroster.example/api/webhooks/resend", {
        method: "POST",
        headers,
        body,
      }),
      {
        getWebhookSecret: () => "webhook-secret",
        verify: () => deliveredPayload(),
        createClient: () => ({
          rpc: async () => ({ data: null, error: null }),
        }),
        recordFeedback: async () => false,
      },
    );
    expect(dbUnavailable.status).toBe(503);
  });

  it("records feedback through the exact service RPC contract", async () => {
    const calls: Array<{
      name: string;
      args: Readonly<Record<string, unknown>>;
    }> = [];
    const client: NotificationRpcClient = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: null, error: null };
      },
    };
    const parsed = parseResendFeedbackPayload(deliveredPayload());
    if (parsed.kind !== "feedback") throw new Error("fixture did not parse");
    expect(await recordResendFeedback(client, "msg_123", parsed.event)).toBe(
      true,
    );
    expect(calls).toEqual([
      {
        name: "record_resend_email_feedback",
        args: {
          p_event_id: "msg_123",
          p_event_type: "email.delivered",
          p_provider_message_id: "provider-message-1",
          p_occurred_at: "2026-07-26T12:00:00.000Z",
          p_recipient_address: "member@example.com",
          p_bounce_type: null,
        },
      },
    ]);
  });
});
