import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  retryAtWithBackoff,
  type NotificationRpcClient,
} from "./invitation-email-worker";

const expoPushEndpoint = "https://exp.host/--/api/v2/push/send";

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
        completion_id: z.uuid(),
        round_id: z.uuid(),
        group_id: z.uuid(),
        round_description: z.string().min(1),
        completed_at: z.string().datetime({ offset: true }),
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

const claimEnvelopeSchema = z
  .array(
    z
      .object({
        delivery_id: z.uuid(),
      })
      .passthrough(),
  )
  .max(1);

const expoSuccessTicketSchema = z
  .object({
    status: z.literal("ok"),
    id: providerMessageIdSchema,
  })
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
  .object({
    statusCode: z.number().int().min(100).max(599),
    body: z.unknown(),
  })
  .strict();

export type ResultsPublishedPushMessage = Readonly<{
  to: string;
  title: string;
  body: string;
  data: Readonly<{
    type: "results_published";
    roundId: string;
  }>;
}>;

export type ExpoPushProviderOptions = Readonly<{
  /** Application correlation only. Expo does not support request idempotency. */
  idempotencyKey: string;
}>;

export type ExpoPushProviderResponse = Readonly<{
  statusCode: number;
  body: unknown;
}>;

export type ExpoPushProvider = Readonly<{
  send: (
    message: ResultsPublishedPushMessage,
    options: ExpoPushProviderOptions,
  ) => ExpoPushProviderResponse | PromiseLike<ExpoPushProviderResponse>;
}>;

export type ResultsPublishedPushWorkerResult =
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      deliveryId: string;
      kind: "sent";
      providerMessageId: string;
    }>
  | Readonly<{ deliveryId: string; kind: "retryable" }>
  | Readonly<{
      code:
        | "invalid_claim"
        | "provider_invalid"
        | "provider_invalid_response"
        | "provider_rejected";
      deliveryId: string;
      kind: "failed_permanent";
    }>
  | Readonly<{
      code: "max_attempts_exceeded";
      deliveryId: string;
      kind: "abandoned";
    }>
  | Readonly<{ deliveryId?: string; kind: "unavailable" }>;

export type ResultsPublishedPushWorkerDependencies = Readonly<{
  createClaimToken: () => string;
  createClient: () => NotificationRpcClient | Promise<NotificationRpcClient>;
  createCorrelationId: () => string;
  createOperationId: () => string;
  createProvider: () => ExpoPushProvider;
  getConfig: () =>
    | Readonly<{ maxAttempts: number; retrySeconds: number }>
    | Promise<Readonly<{ maxAttempts: number; retrySeconds: number }>>;
  now: () => Date;
}>;

const defaultProvider: ExpoPushProvider = {
  send: async (message, options) => {
    // Expo's documented API is at-least-once and does not define an
    // idempotency-key header. Keep the key inside our claim/finalization
    // boundary for observability, while treating an ambiguous transport
    // outcome as retryable (and therefore explicitly at-least-once).
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
      // The worker classifies an absent/unparseable body as a provider response error.
    }
    return { body, statusCode: response.status };
  },
};

const defaultDependencies: ResultsPublishedPushWorkerDependencies = {
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

function parseClaimRows(
  data: unknown,
):
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "row"; row: z.infer<typeof claimRowsSchema>[number] }>
  | Readonly<{ deliveryId: string; kind: "invalid_claim" }>
  | Readonly<{ kind: "invalid" }> {
  if (data === null || (Array.isArray(data) && data.length === 0)) {
    return { kind: "empty" };
  }
  const parsed = claimRowsSchema.safeParse(data);
  if (parsed.success && parsed.data.length === 1) {
    return { kind: "row", row: parsed.data[0] };
  }
  const envelope = claimEnvelopeSchema.safeParse(data);
  if (!envelope.success || envelope.data.length !== 1) {
    return { kind: "invalid" };
  }
  return {
    deliveryId: envelope.data[0].delivery_id,
    kind: "invalid_claim",
  };
}

function rpcFailed(error: Readonly<{ code?: string }> | null): boolean {
  return error !== null;
}

type PushFailureCode =
  | "provider_invalid"
  | "provider_invalid_response"
  | "provider_rejected"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "max_attempts_exceeded"
  | "invalid_claim";

async function recordFailure(
  client: NotificationRpcClient,
  deliveryId: string,
  claimToken: string,
  safeError: PushFailureCode,
  retryAt: string | null,
): Promise<boolean> {
  try {
    const result = await client.rpc("record_results_push_send_failure", {
      p_delivery_id: deliveryId,
      p_claim_token: claimToken,
      p_safe_error: safeError,
      p_retry_at: retryAt,
    });
    return !rpcFailed(result.error);
  } catch {
    return false;
  }
}

async function recordInvalidDeviceFailure(
  client: NotificationRpcClient,
  row: z.infer<typeof claimRowsSchema>[number],
  claimToken: string,
  correlationId: string,
  operationId: string,
): Promise<boolean> {
  try {
    const result = await client.rpc("record_results_push_invalid_device", {
      p_delivery_id: row.delivery_id,
      p_claim_token: claimToken,
      p_device_id: row.device_id,
      p_group_id: row.group_id,
      p_correlation_id: correlationId,
      p_operation_id: operationId,
    });
    return !rpcFailed(result.error);
  } catch {
    return false;
  }
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
): ResultsPublishedPushWorkerResult {
  return { code, deliveryId, kind: "failed_permanent" };
}

export async function runResultsPublishedPushWorker(
  overrides?: Partial<ResultsPublishedPushWorkerDependencies>,
): Promise<ResultsPublishedPushWorkerResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const config = await dependencies.getConfig();
  const client = await dependencies.createClient();
  const claimToken = dependencies.createClaimToken();
  const staleBefore = new Date(
    dependencies.now().getTime() - config.retrySeconds * 1000,
  ).toISOString();
  const claim = await client.rpc("claim_results_published_push", {
    p_claim_token: claimToken,
    p_stale_before: staleBefore,
  });

  if (rpcFailed(claim.error)) return { kind: "unavailable" };
  const parsedClaim = parseClaimRows(claim.data);
  if (parsedClaim.kind === "empty") return parsedClaim;
  if (parsedClaim.kind === "invalid") return { kind: "unavailable" };
  if (parsedClaim.kind === "invalid_claim") {
    const recorded = await recordFailure(
      client,
      parsedClaim.deliveryId,
      claimToken,
      "invalid_claim",
      null,
    );
    return recorded
      ? {
          code: "invalid_claim",
          deliveryId: parsedClaim.deliveryId,
          kind: "failed_permanent",
        }
      : { deliveryId: parsedClaim.deliveryId, kind: "unavailable" };
  }
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

  const recordRetry = async (
    safeError: PushFailureCode,
  ): Promise<ResultsPublishedPushWorkerResult> => {
    const recorded = await recordFailure(
      client,
      row.delivery_id,
      claimToken,
      safeError,
      retryAtWithBackoff(
        dependencies.now(),
        config.retrySeconds,
        row.attempt_number,
      ),
    );
    return recorded
      ? { deliveryId: row.delivery_id, kind: "retryable" }
      : { deliveryId: row.delivery_id, kind: "unavailable" };
  };

  let providerResponse: ExpoPushProviderResponse;
  try {
    const provider = dependencies.createProvider();
    providerResponse = await provider.send(
      {
        body: `Official results for ${row.round_description.replace(/[\r\n]+/g, " ").trim()} are now available.`,
        data: { roundId: row.round_id, type: "results_published" },
        title: "Results are ready",
        to: row.expo_push_token,
      },
      { idempotencyKey: `results-published/${row.delivery_id}` },
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
      retryable
        ? retryAtWithBackoff(
            dependencies.now(),
            config.retrySeconds,
            row.attempt_number,
          )
        : null,
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
    return recordRetry(
      transport.statusCode === 429
        ? "provider_rate_limited"
        : "provider_unavailable",
    );
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
      return recordRetry("provider_rate_limited");
    }
    const code =
      failure.kind === "invalid" ? "provider_invalid" : "provider_rejected";
    if (failure.kind === "invalid") {
      const recorded = await recordInvalidDeviceFailure(
        client,
        row,
        claimToken,
        dependencies.createCorrelationId(),
        dependencies.createOperationId(),
      );
      if (!recorded)
        return { deliveryId: row.delivery_id, kind: "unavailable" };
      return permanentResult(row.delivery_id, code);
    }
    const recorded = await recordFailure(
      client,
      row.delivery_id,
      claimToken,
      code,
      null,
    );
    if (!recorded) return { deliveryId: row.delivery_id, kind: "unavailable" };
    return permanentResult(row.delivery_id, code);
  }

  const finalized = await client.rpc("record_results_push_send_success", {
    p_delivery_id: row.delivery_id,
    p_claim_token: claimToken,
    p_provider_message_id: ticket.id,
  });
  if (rpcFailed(finalized.error)) {
    return { deliveryId: row.delivery_id, kind: "unavailable" };
  }
  return {
    deliveryId: row.delivery_id,
    kind: "sent",
    providerMessageId: ticket.id,
  };
}
