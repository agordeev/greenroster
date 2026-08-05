import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { NotificationRpcClient } from "./invitation-email-worker";

const expoPushEndpoint = "https://exp.host/--/api/v2/push/send";
const eventTypeSchema = z.enum(["round.published", "round.details_changed"]);
const providerMessageIdSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value.trim() === value);

const claimRowsSchema = z
  .array(
    z
      .object({
        delivery_id: z.uuid(),
        outbox_job_id: z.uuid(),
        event_type: z
          .string()
          .refine((value) => eventTypeSchema.safeParse(value).success),
        round_id: z.uuid(),
        group_id: z.uuid(),
        round_description: z.string().min(1),
        recipient_user_id: z.uuid(),
        device_id: z.uuid(),
        expo_push_token: z
          .string()
          .min(1)
          .max(512)
          .refine((value) => value.trim() === value && !/\s/u.test(value)),
        attempt_number: z.number().int().positive(),
      })
      .strict(),
  )
  .max(1);

const expoSuccessTicketSchema = z
  .object({ status: z.literal("ok"), id: providerMessageIdSchema })
  .passthrough();
const expoErrorTicketSchema = z
  .object({
    status: z.literal("error"),
    message: z.string().min(1),
    details: z
      .object({ error: z.string().min(1) })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
const expoResponseSchema = z
  .object({
    data: z.union([
      z.union([expoSuccessTicketSchema, expoErrorTicketSchema]),
      z
        .array(z.union([expoSuccessTicketSchema, expoErrorTicketSchema]))
        .length(1),
    ]),
  })
  .strict();
const providerTransportResponseSchema = z
  .object({ statusCode: z.number().int().min(100).max(599), body: z.unknown() })
  .strict();

export type RoundAnnouncementPushMessage = Readonly<{
  to: string;
  title: string;
  body: string;
  data: Readonly<{
    type: "round_published" | "round_details_changed";
    roundId: string;
  }>;
}>;

export type ExpoAnnouncementPushProvider = Readonly<{
  send: (
    message: RoundAnnouncementPushMessage,
    options: Readonly<{ idempotencyKey: string }>,
  ) =>
    | Readonly<{ statusCode: number; body: unknown }>
    | PromiseLike<Readonly<{ statusCode: number; body: unknown }>>;
}>;

export type RoundAnnouncementPushWorkerResult =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ deliveryId: string; kind: "sent"; providerMessageId: string }>
  | Readonly<{ deliveryId: string; kind: "retryable" }>
  | Readonly<{
      code:
        "provider_invalid" | "provider_invalid_response" | "provider_rejected";
      deliveryId: string;
      kind: "failed_permanent";
    }>
  | Readonly<{
      code: "max_attempts_exceeded";
      deliveryId: string;
      kind: "abandoned";
    }>
  | Readonly<{ deliveryId?: string; kind: "unavailable" }>;

export type RoundAnnouncementPushWorkerDependencies = Readonly<{
  createClaimToken: () => string;
  createClient: () => NotificationRpcClient | Promise<NotificationRpcClient>;
  createCorrelationId: () => string;
  createOperationId: () => string;
  createProvider: () => ExpoAnnouncementPushProvider;
  getConfig: () =>
    | Readonly<{ maxAttempts: number; retrySeconds: number }>
    | Promise<Readonly<{ maxAttempts: number; retrySeconds: number }>>;
  now: () => Date;
}>;

const defaultProvider: ExpoAnnouncementPushProvider = {
  send: async (message, options) => {
    void options;
    const response = await fetch(expoPushEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // An absent body is classified as an invalid provider response below.
    }
    return { body, statusCode: response.status };
  },
};

const defaultDependencies: RoundAnnouncementPushWorkerDependencies = {
  createClaimToken: randomUUID,
  createClient: async () => {
    const { createSupabaseServiceClient } =
      await import("../supabase/service-client");
    return createSupabaseServiceClient();
  },
  createCorrelationId: randomUUID,
  createOperationId: randomUUID,
  createProvider: () => defaultProvider,
  getConfig: async () => {
    const { webRuntimeEnv } = await import("../runtime-env");
    return {
      maxAttempts: webRuntimeEnv.notificationEmailMaxAttempts,
      retrySeconds: webRuntimeEnv.notificationEmailRetrySeconds,
    };
  },
  now: () => new Date(),
};

function rpcFailed(error: Readonly<{ code?: string }> | null): boolean {
  return error !== null;
}

function parseClaimRows(
  data: unknown,
):
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "row"; row: z.infer<typeof claimRowsSchema>[number] }>
  | Readonly<{ kind: "invalid" }> {
  if (data === null || (Array.isArray(data) && data.length === 0)) {
    return { kind: "empty" };
  }
  const parsed = claimRowsSchema.safeParse(data);
  if (!parsed.success || parsed.data.length !== 1) return { kind: "invalid" };
  return { kind: "row", row: parsed.data[0] };
}

type PushFailureCode =
  | "provider_invalid"
  | "provider_invalid_response"
  | "provider_rejected"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "max_attempts_exceeded";

function retryAt(now: Date, retrySeconds: number): string {
  return new Date(now.getTime() + retrySeconds * 1000).toISOString();
}

function failureFromTicket(ticket: z.infer<typeof expoErrorTicketSchema>) {
  const providerError = ticket.details?.error?.toLowerCase() ?? "";
  const message = ticket.message.toLowerCase();
  const compactMessage = message.replace(/[\s_-]+/gu, "");
  if (
    providerError.includes("devicenotregistered") ||
    providerError.includes("invalidpushtoken") ||
    message.includes("device not registered") ||
    message.includes("invalid push token") ||
    compactMessage.includes("devicenotregistered") ||
    compactMessage.includes("invalidpushtoken")
  ) {
    return { kind: "invalid" as const };
  }
  if (
    providerError.includes("messagerateexceeded") ||
    message.includes("rate limit") ||
    message.includes("too many")
  ) {
    return { kind: "retryable" as const };
  }
  return { kind: "permanent" as const };
}

function permanentResult(
  deliveryId: string,
  code: "provider_invalid" | "provider_invalid_response" | "provider_rejected",
): RoundAnnouncementPushWorkerResult {
  return { code, deliveryId, kind: "failed_permanent" };
}

async function recordFailure(
  client: NotificationRpcClient,
  deliveryId: string,
  claimToken: string,
  safeError: PushFailureCode,
  retryAtValue: string | null,
): Promise<boolean> {
  try {
    const result = await client.rpc(
      "record_round_announcement_push_send_failure",
      {
        p_delivery_id: deliveryId,
        p_claim_token: claimToken,
        p_safe_error: safeError,
        p_retry_at: retryAtValue,
      },
    );
    return !rpcFailed(result.error);
  } catch {
    return false;
  }
}

export async function runRoundAnnouncementPushWorker(
  overrides?: Partial<RoundAnnouncementPushWorkerDependencies>,
): Promise<RoundAnnouncementPushWorkerResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const config = await dependencies.getConfig();
  const client = await dependencies.createClient();
  const claimToken = dependencies.createClaimToken();
  const staleBefore = new Date(
    dependencies.now().getTime() - config.retrySeconds * 1000,
  ).toISOString();
  const claim = await client.rpc("claim_round_announcement_push", {
    p_claim_token: claimToken,
    p_stale_before: staleBefore,
  });
  if (rpcFailed(claim.error)) return { kind: "unavailable" };
  const parsedClaim = parseClaimRows(claim.data);
  if (parsedClaim.kind === "empty") return parsedClaim;
  if (parsedClaim.kind === "invalid") return { kind: "unavailable" };
  const row = parsedClaim.row;

  if (row.attempt_number > config.maxAttempts) {
    const recorded = await recordFailure(
      client,
      row.delivery_id,
      claimToken,
      "max_attempts_exceeded",
      null,
    );
    return recorded
      ? {
          code: "max_attempts_exceeded",
          deliveryId: row.delivery_id,
          kind: "abandoned",
        }
      : { deliveryId: row.delivery_id, kind: "unavailable" };
  }

  const description = row.round_description.replace(/[\r\n]+/gu, " ").trim();
  const isDetailsChange = row.event_type === "round.details_changed";
  const body = isDetailsChange
    ? `${description} details changed.`
    : `${description} is open for RSVP.`;
  const title = isDetailsChange ? "Round details changed" : "Round published";
  let providerResponse: Readonly<{ statusCode: number; body: unknown }>;
  try {
    providerResponse = await dependencies.createProvider().send(
      {
        body,
        data: {
          type: isDetailsChange ? "round_details_changed" : "round_published",
          roundId: row.round_id,
        },
        title,
        to: row.expo_push_token,
      },
      { idempotencyKey: `round-announcement/${row.delivery_id}` },
    );
  } catch (error) {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode?: unknown }).statusCode
        : null;
    const retryable =
      status === null ||
      status === 429 ||
      (typeof status === "number" && status >= 500);
    const code: PushFailureCode =
      status === 429
        ? "provider_rate_limited"
        : status !== null && typeof status === "number" && status < 500
          ? "provider_rejected"
          : "provider_unavailable";
    const recorded = await recordFailure(
      client,
      row.delivery_id,
      claimToken,
      code,
      retryable ? retryAt(dependencies.now(), config.retrySeconds) : null,
    );
    if (!recorded) return { deliveryId: row.delivery_id, kind: "unavailable" };
    return retryable
      ? { deliveryId: row.delivery_id, kind: "retryable" }
      : permanentResult(row.delivery_id, "provider_rejected");
  }

  const parsedTransport =
    providerTransportResponseSchema.safeParse(providerResponse);
  if (!parsedTransport.success) {
    const recorded = await recordFailure(
      client,
      row.delivery_id,
      claimToken,
      "provider_invalid_response",
      null,
    );
    return recorded
      ? permanentResult(row.delivery_id, "provider_invalid_response")
      : { deliveryId: row.delivery_id, kind: "unavailable" };
  }
  const transport = parsedTransport.data;
  if (transport.statusCode === 429 || transport.statusCode >= 500) {
    const recorded = await recordFailure(
      client,
      row.delivery_id,
      claimToken,
      transport.statusCode === 429
        ? "provider_rate_limited"
        : "provider_unavailable",
      retryAt(dependencies.now(), config.retrySeconds),
    );
    return recorded
      ? { deliveryId: row.delivery_id, kind: "retryable" }
      : { deliveryId: row.delivery_id, kind: "unavailable" };
  }

  const parsedResponse = expoResponseSchema.safeParse(transport.body);
  if (!parsedResponse.success) {
    const recorded = await recordFailure(
      client,
      row.delivery_id,
      claimToken,
      "provider_invalid_response",
      null,
    );
    return recorded
      ? permanentResult(row.delivery_id, "provider_invalid_response")
      : { deliveryId: row.delivery_id, kind: "unavailable" };
  }
  const ticket = Array.isArray(parsedResponse.data.data)
    ? parsedResponse.data.data[0]
    : parsedResponse.data.data;
  if (ticket.status === "error") {
    const failure = failureFromTicket(ticket);
    if (failure.kind === "retryable") {
      const recorded = await recordFailure(
        client,
        row.delivery_id,
        claimToken,
        "provider_rate_limited",
        retryAt(dependencies.now(), config.retrySeconds),
      );
      return recorded
        ? { deliveryId: row.delivery_id, kind: "retryable" }
        : { deliveryId: row.delivery_id, kind: "unavailable" };
    }
    if (failure.kind === "invalid") {
      try {
        const recorded = await client.rpc(
          "record_round_announcement_push_invalid_device",
          {
            p_delivery_id: row.delivery_id,
            p_claim_token: claimToken,
            p_device_id: row.device_id,
            p_group_id: row.group_id,
            p_correlation_id: dependencies.createCorrelationId(),
            p_operation_id: dependencies.createOperationId(),
          },
        );
        return rpcFailed(recorded.error)
          ? { deliveryId: row.delivery_id, kind: "unavailable" }
          : permanentResult(row.delivery_id, "provider_invalid");
      } catch {
        return { deliveryId: row.delivery_id, kind: "unavailable" };
      }
    }
    const recorded = await recordFailure(
      client,
      row.delivery_id,
      claimToken,
      "provider_rejected",
      null,
    );
    return recorded
      ? permanentResult(row.delivery_id, "provider_rejected")
      : { deliveryId: row.delivery_id, kind: "unavailable" };
  }

  const finalized = await client.rpc(
    "record_round_announcement_push_send_success",
    {
      p_delivery_id: row.delivery_id,
      p_claim_token: claimToken,
      p_provider_message_id: ticket.id,
    },
  );
  if (rpcFailed(finalized.error)) {
    return { deliveryId: row.delivery_id, kind: "unavailable" };
  }
  return {
    deliveryId: row.delivery_id,
    kind: "sent",
    providerMessageId: ticket.id,
  };
}
