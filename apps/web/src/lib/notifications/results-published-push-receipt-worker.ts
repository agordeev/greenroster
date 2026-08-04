import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import type {
  InvitationEmailWorkerResult,
  NotificationRpcClient,
} from "./invitation-email-worker";

const expoReceiptsEndpoint = "https://exp.host/--/api/v2/push/getReceipts";

const claimRowsSchema = z
  .array(
    z
      .object({
        receipt_id: z.uuid(),
        delivery_id: z.uuid(),
        group_id: z.uuid(),
        device_id: z.uuid(),
        provider_message_id: z
          .string()
          .min(1)
          .max(255)
          .refine((value) => value.trim() === value),
        attempt_number: z.number().int().positive(),
      })
      .strict(),
  )
  .max(1);

const providerTransportResponseSchema = z
  .object({
    statusCode: z.number().int().min(100).max(599),
    body: z.unknown(),
  })
  .strict();

const expoReceiptSuccessSchema = z
  .object({ status: z.literal("ok") })
  .passthrough();

const expoReceiptErrorSchema = z
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

const expoReceiptResponseSchema = z
  .object({
    data: z.record(
      z.string().min(1),
      z.union([expoReceiptSuccessSchema, expoReceiptErrorSchema]),
    ),
  })
  .strict();

export type ExpoPushReceiptProviderResponse = Readonly<{
  statusCode: number;
  body: unknown;
}>;

export type ExpoPushReceiptProvider = Readonly<{
  getReceipts: (
    providerMessageIds: readonly string[],
  ) =>
    | ExpoPushReceiptProviderResponse
    | PromiseLike<ExpoPushReceiptProviderResponse>;
}>;

export type ResultsPublishedPushReceiptWorkerDependencies = Readonly<{
  createClaimToken: () => string;
  createClient: () => NotificationRpcClient | Promise<NotificationRpcClient>;
  createCorrelationId: () => string;
  createOperationId: () => string;
  createProvider: () => ExpoPushReceiptProvider;
  getConfig: () =>
    | Readonly<{ maxAttempts: number; retrySeconds: number }>
    | Promise<Readonly<{ maxAttempts: number; retrySeconds: number }>>;
  now: () => Date;
}>;

const defaultProvider: ExpoPushReceiptProvider = {
  getReceipts: async (providerMessageIds) => {
    const response = await fetch(expoReceiptsEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: providerMessageIds }),
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

const defaultDependencies: ResultsPublishedPushReceiptWorkerDependencies = {
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
    return {
      // Expo recommends receipt polling about 15 minutes after sending and
      // removes receipts after 24 hours. Receipt polling therefore has its
      // own bounded cadence instead of inheriting e-mail retry settings.
      maxAttempts: 95,
      retrySeconds: 900,
    };
  },
  now: () => new Date(),
};

type ReceiptFailureCode =
  | "provider_invalid"
  | "provider_invalid_response"
  | "provider_rejected"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "max_attempts_exceeded";

function retryAt(now: Date, retrySeconds: number): string {
  return new Date(now.getTime() + retrySeconds * 1000).toISOString();
}

function mapRpcFailure(error: Readonly<{ code?: string }> | null): boolean {
  return error !== null;
}

function parseClaimRows(data: unknown):
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      kind: "row";
      row: z.infer<typeof claimRowsSchema>[number];
    }>
  | Readonly<{ kind: "invalid" }> {
  if (data === null || (Array.isArray(data) && data.length === 0)) {
    return { kind: "empty" };
  }
  const parsed = claimRowsSchema.safeParse(data);
  if (!parsed.success || parsed.data.length !== 1) return { kind: "invalid" };
  return { kind: "row", row: parsed.data[0] };
}

async function recordFailure(
  client: NotificationRpcClient,
  receiptId: string,
  claimToken: string,
  safeError: ReceiptFailureCode,
  retryAtValue: string | null,
): Promise<boolean> {
  try {
    const result = await client.rpc("record_results_push_receipt_failure", {
      p_receipt_id: receiptId,
      p_claim_token: claimToken,
      p_safe_error: safeError,
      p_retry_at: retryAtValue,
    });
    return !mapRpcFailure(result.error);
  } catch {
    return false;
  }
}

async function recordInvalidDevice(
  client: NotificationRpcClient,
  row: z.infer<typeof claimRowsSchema>[number],
  claimToken: string,
  correlationId: string,
  operationId: string,
): Promise<boolean> {
  try {
    const result = await client.rpc(
      "record_results_push_receipt_invalid_device",
      {
        p_receipt_id: row.receipt_id,
        p_claim_token: claimToken,
        p_device_id: row.device_id,
        p_group_id: row.group_id,
        p_correlation_id: correlationId,
        p_operation_id: operationId,
      },
    );
    return !mapRpcFailure(result.error);
  } catch {
    return false;
  }
}

function isInvalidDeviceReceipt(
  receipt: z.infer<typeof expoReceiptErrorSchema>,
): boolean {
  const providerError = receipt.details?.error?.toLowerCase() ?? "";
  const message = receipt.message.toLowerCase();
  const compactMessage = message.replace(/[\s_-]+/gu, "");
  return (
    providerError.includes("devicenotregistered") ||
    providerError.includes("invalidpushtoken") ||
    message.includes("device not registered") ||
    message.includes("invalid push token") ||
    compactMessage.includes("devicenotregistered") ||
    compactMessage.includes("invalidpushtoken")
  );
}

function isRetryableReceipt(
  receipt: z.infer<typeof expoReceiptErrorSchema>,
): boolean {
  const providerError = receipt.details?.error?.toLowerCase() ?? "";
  const message = receipt.message.toLowerCase();
  return (
    providerError.includes("messagerateexceeded") ||
    message.includes("rate limit") ||
    message.includes("too many")
  );
}

export async function runResultsPublishedPushReceiptWorker(
  overrides?: Partial<ResultsPublishedPushReceiptWorkerDependencies>,
): Promise<InvitationEmailWorkerResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const config = await dependencies.getConfig();
  const client = await dependencies.createClient();
  const claimToken = dependencies.createClaimToken();
  const staleBefore = new Date(
    dependencies.now().getTime() - config.retrySeconds * 1000,
  ).toISOString();
  const claim = await client.rpc("claim_results_push_receipt", {
    p_claim_token: claimToken,
    p_stale_before: staleBefore,
  });
  if (mapRpcFailure(claim.error)) return { kind: "unavailable" };
  const parsedClaim = parseClaimRows(claim.data);
  if (parsedClaim.kind === "empty") return parsedClaim;
  if (parsedClaim.kind === "invalid") return { kind: "unavailable" };
  const row = parsedClaim.row;

  if (row.attempt_number > config.maxAttempts) {
    const recorded = await recordFailure(
      client,
      row.receipt_id,
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

  let providerResponse: ExpoPushReceiptProviderResponse;
  try {
    providerResponse = await dependencies
      .createProvider()
      .getReceipts([row.provider_message_id]);
  } catch {
    const recorded = await recordFailure(
      client,
      row.receipt_id,
      claimToken,
      "provider_unavailable",
      retryAt(dependencies.now(), config.retrySeconds),
    );
    return recorded
      ? { deliveryId: row.delivery_id, kind: "retryable" }
      : { deliveryId: row.delivery_id, kind: "unavailable" };
  }

  const parsedTransport =
    providerTransportResponseSchema.safeParse(providerResponse);
  if (!parsedTransport.success) {
    const recorded = await recordFailure(
      client,
      row.receipt_id,
      claimToken,
      "provider_invalid_response",
      null,
    );
    return recorded
      ? {
          code: "provider_invalid_response",
          deliveryId: row.delivery_id,
          kind: "failed_permanent",
        }
      : { deliveryId: row.delivery_id, kind: "unavailable" };
  }
  const transport = parsedTransport.data;
  if (transport.statusCode === 429 || transport.statusCode >= 500) {
    const recorded = await recordFailure(
      client,
      row.receipt_id,
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

  const parsedResponse = expoReceiptResponseSchema.safeParse(transport.body);
  if (!parsedResponse.success) {
    const recorded = await recordFailure(
      client,
      row.receipt_id,
      claimToken,
      "provider_invalid_response",
      null,
    );
    return recorded
      ? {
          code: "provider_invalid_response",
          deliveryId: row.delivery_id,
          kind: "failed_permanent",
        }
      : { deliveryId: row.delivery_id, kind: "unavailable" };
  }

  const receipt = parsedResponse.data.data[row.provider_message_id];
  if (!receipt) {
    const recorded = await recordFailure(
      client,
      row.receipt_id,
      claimToken,
      "provider_unavailable",
      retryAt(dependencies.now(), config.retrySeconds),
    );
    return recorded
      ? { deliveryId: row.delivery_id, kind: "retryable" }
      : { deliveryId: row.delivery_id, kind: "unavailable" };
  }

  if (receipt.status === "error") {
    if (isInvalidDeviceReceipt(receipt)) {
      const recorded = await recordInvalidDevice(
        client,
        row,
        claimToken,
        dependencies.createCorrelationId(),
        dependencies.createOperationId(),
      );
      return recorded
        ? {
            code: "provider_invalid",
            deliveryId: row.delivery_id,
            kind: "failed_permanent",
          }
        : { deliveryId: row.delivery_id, kind: "unavailable" };
    }
    const retryable = isRetryableReceipt(receipt);
    const recorded = await recordFailure(
      client,
      row.receipt_id,
      claimToken,
      retryable ? "provider_rate_limited" : "provider_rejected",
      retryable ? retryAt(dependencies.now(), config.retrySeconds) : null,
    );
    return recorded
      ? retryable
        ? { deliveryId: row.delivery_id, kind: "retryable" }
        : {
            code: "provider_rejected",
            deliveryId: row.delivery_id,
            kind: "failed_permanent",
          }
      : { deliveryId: row.delivery_id, kind: "unavailable" };
  }

  try {
    const finalized = await client.rpc("record_results_push_receipt_success", {
      p_receipt_id: row.receipt_id,
      p_claim_token: claimToken,
    });
    if (mapRpcFailure(finalized.error)) {
      return { deliveryId: row.delivery_id, kind: "unavailable" };
    }
  } catch {
    return { deliveryId: row.delivery_id, kind: "unavailable" };
  }
  return {
    deliveryId: row.delivery_id,
    kind: "sent",
    providerMessageId: row.provider_message_id,
  };
}
