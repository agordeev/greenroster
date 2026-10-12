import "server-only";

import { z } from "zod";

import type { NotificationRpcClient } from "./invitation-email-worker";

const supportedEventTypes = [
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
] as const;

export type SupportedResendEventType = (typeof supportedEventTypes)[number];

export type ResendFeedbackEvent = Readonly<{
  bounceType: string | null;
  eventType: SupportedResendEventType;
  occurredAt: string;
  providerMessageId: string;
  recipientAddress: string;
}>;

export type ResendFeedbackParseResult =
  | Readonly<{ kind: "ignored" }>
  | Readonly<{ event: ResendFeedbackEvent; kind: "feedback" }>
  | Readonly<{ kind: "invalid" }>;

const commonDataSchema = z
  .object({
    email_id: z.string().trim().min(1),
    to: z.array(z.email()).length(1),
  })
  .passthrough();

const commonEventSchema = z
  .object({
    created_at: z.string().datetime({ offset: true }),
    data: commonDataSchema,
    type: z.string().min(1),
  })
  .passthrough();

const bouncedEventSchema = commonEventSchema.extend({
  data: commonDataSchema.extend({
    bounce: z.object({ type: z.string().trim().min(1) }).passthrough(),
  }),
  type: z.literal("email.bounced"),
});

export function parseResendFeedbackPayload(
  payload: unknown,
): ResendFeedbackParseResult {
  const type = z
    .object({ type: z.string().min(1) })
    .passthrough()
    .safeParse(payload);
  if (!type.success) return { kind: "invalid" };
  if (
    !supportedEventTypes.includes(type.data.type as SupportedResendEventType)
  ) {
    return { kind: "ignored" };
  }

  const supportedType = type.data.type as SupportedResendEventType;
  if (supportedType === "email.bounced") {
    const bounced = bouncedEventSchema.safeParse(payload);
    if (!bounced.success) return { kind: "invalid" };
    const providerBounceType = bounced.data.data.bounce.type.toLowerCase();
    const normalizedBounceType =
      providerBounceType === "temporary" ? "transient" : providerBounceType;
    if (
      normalizedBounceType !== "permanent" &&
      normalizedBounceType !== "transient" &&
      normalizedBounceType !== "undetermined"
    ) {
      return { kind: "invalid" };
    }
    return {
      kind: "feedback",
      event: {
        bounceType: normalizedBounceType,
        eventType: supportedType,
        occurredAt: bounced.data.created_at,
        providerMessageId: bounced.data.data.email_id,
        recipientAddress: bounced.data.data.to[0].trim().toLowerCase(),
      },
    };
  }

  const parsed = commonEventSchema
    .extend({ type: z.literal(supportedType) })
    .safeParse(payload);
  if (!parsed.success) return { kind: "invalid" };

  return {
    kind: "feedback",
    event: {
      bounceType: null,
      eventType: supportedType,
      occurredAt: parsed.data.created_at,
      providerMessageId: parsed.data.data.email_id,
      recipientAddress: parsed.data.data.to[0].trim().toLowerCase(),
    },
  };
}

export async function recordResendFeedback(
  client: NotificationRpcClient,
  eventId: string,
  event: ResendFeedbackEvent,
): Promise<boolean> {
  try {
    const result = await client.rpc("record_resend_email_feedback", {
      p_event_id: eventId,
      p_event_type: event.eventType,
      p_provider_message_id: event.providerMessageId,
      p_occurred_at: event.occurredAt,
      p_recipient_address: event.recipientAddress,
      p_bounce_type: event.bounceType,
    });
    return result.error === null;
  } catch {
    return false;
  }
}
