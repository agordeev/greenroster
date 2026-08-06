import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Resend } from "resend";

import {
  renderRoundPublishedEmail,
  type RoundPublishedEmail,
} from "../../emails/round-published";
import {
  isRetryableProviderFailure,
  providerFailureCode,
  recordEmailFailure,
  retryAtWithBackoff,
  type InvitationEmailWorkerResult,
  type NotificationEmailProvider,
  type NotificationEmailWorkerConfig,
  type NotificationRpcClient,
  type ProviderEmailMessage,
} from "./invitation-email-worker";

export type RoundPublishedEmailWorkerDependencies = Readonly<{
  createClaimToken: () => string;
  createClient: () => NotificationRpcClient | Promise<NotificationRpcClient>;
  createProvider: (apiKey: string) => NotificationEmailProvider;
  getConfig: () =>
    | Pick<
        NotificationEmailWorkerConfig,
        | "appUrl"
        | "resendApiKey"
        | "resendFromEmail"
        | "maxAttempts"
        | "retrySeconds"
      >
    | Promise<
        Pick<
          NotificationEmailWorkerConfig,
          | "appUrl"
          | "resendApiKey"
          | "resendFromEmail"
          | "maxAttempts"
          | "retrySeconds"
        >
      >;
  now: () => Date;
  renderEmail: (
    input: Readonly<{
      description: string;
      format: "individual_net" | "individual_gross";
      groupName: string;
      groupTimeZone: string;
      notificationPreferencesUrl: string;
      scheduledAt: string;
    }>,
  ) => RoundPublishedEmail | Promise<RoundPublishedEmail>;
}>;

const claimRowsSchema = z
  .array(
    z
      .object({
        delivery_id: z.uuid(),
        outbox_job_id: z.uuid(),
        round_id: z.uuid(),
        group_id: z.uuid(),
        group_name: z.string().min(1),
        group_time_zone: z.string().min(1),
        round_description: z.string().min(1),
        scheduled_at: z.string().datetime({ offset: true }),
        format: z.enum(["individual_net", "individual_gross"]),
        recipient_address: z.email(),
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

const defaultDependencies: RoundPublishedEmailWorkerDependencies = {
  createClaimToken: randomUUID,
  createClient: async () => {
    const { createSupabaseServiceClient } =
      await import("../supabase/service-client");
    return createSupabaseServiceClient();
  },
  createProvider: (apiKey) => {
    const resend = new Resend(apiKey);
    return {
      send: (message: ProviderEmailMessage, options) =>
        resend.emails.send(
          {
            from: message.from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
          },
          options,
        ),
    };
  },
  getConfig: async () => {
    const { webRuntimeEnv } = await import("../runtime-env");
    return {
      appUrl: webRuntimeEnv.appUrl,
      resendApiKey: webRuntimeEnv.resendApiKey,
      resendFromEmail: webRuntimeEnv.resendFromEmail,
      maxAttempts: webRuntimeEnv.notificationEmailMaxAttempts,
      retrySeconds: webRuntimeEnv.notificationEmailRetrySeconds,
    };
  },
  now: () => new Date(),
  renderEmail: renderRoundPublishedEmail,
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

function buildActionUrl(appUrl: string, path: string): string {
  const url = new URL(path, appUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("notification preferences URL must use HTTP or HTTPS");
  }
  return url.toString();
}

function buildNotificationPreferencesUrl(appUrl: string): string {
  return buildActionUrl(appUrl, "/member/home#notifications");
}

export async function runRoundPublishedEmailWorker(
  overrides?: Partial<RoundPublishedEmailWorkerDependencies>,
): Promise<InvitationEmailWorkerResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const config = await dependencies.getConfig();
  const client = await dependencies.createClient();
  const claimToken = dependencies.createClaimToken();
  const staleBefore = new Date(
    dependencies.now().getTime() - config.retrySeconds * 1000,
  ).toISOString();
  const claim = await client.rpc("claim_round_published_email", {
    p_claim_token: claimToken,
    p_stale_before: staleBefore,
  });

  if (rpcFailed(claim.error)) return { kind: "unavailable" };
  const parsedClaim = parseClaimRows(claim.data);
  if (parsedClaim.kind === "empty") return parsedClaim;
  if (parsedClaim.kind === "invalid") return { kind: "unavailable" };
  if (parsedClaim.kind === "invalid_claim") {
    const recorded = await recordEmailFailure(
      client,
      parsedClaim.deliveryId,
      claimToken,
      "invalid_claim",
      null,
    );
    return recorded
      ? {
          kind: "failed_permanent",
          code: "invalid_claim",
          deliveryId: parsedClaim.deliveryId,
        }
      : { kind: "unavailable", deliveryId: parsedClaim.deliveryId };
  }
  const row = parsedClaim.row;

  if (row.attempt_number > config.maxAttempts) {
    const recorded = await recordEmailFailure(
      client,
      row.delivery_id,
      claimToken,
      "max_attempts_exceeded",
      null,
    );
    return recorded
      ? {
          kind: "abandoned",
          code: "max_attempts_exceeded",
          deliveryId: row.delivery_id,
        }
      : { kind: "unavailable", deliveryId: row.delivery_id };
  }

  let email: RoundPublishedEmail;
  try {
    email = await dependencies.renderEmail({
      description: row.round_description,
      format: row.format,
      groupName: row.group_name,
      groupTimeZone: row.group_time_zone,
      notificationPreferencesUrl: buildNotificationPreferencesUrl(
        config.appUrl,
      ),
      scheduledAt: row.scheduled_at,
    });
  } catch {
    const recorded = await recordEmailFailure(
      client,
      row.delivery_id,
      claimToken,
      "provider_invalid_response",
      null,
    );
    return recorded
      ? {
          kind: "failed_permanent",
          code: "provider_invalid_response",
          deliveryId: row.delivery_id,
        }
      : { kind: "unavailable", deliveryId: row.delivery_id };
  }

  try {
    const provider = dependencies.createProvider(config.resendApiKey);
    const response = await provider.send(
      {
        from: config.resendFromEmail,
        html: email.html,
        subject: email.subject,
        text: email.text,
        to: row.recipient_address,
      },
      { idempotencyKey: `round-published/${row.delivery_id}` },
    );

    if (response.error) {
      const retryable = isRetryableProviderFailure(response.error);
      const code = providerFailureCode(response.error);
      const recorded = await recordEmailFailure(
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
      if (!recorded)
        return { kind: "unavailable", deliveryId: row.delivery_id };
      return retryable
        ? { kind: "retryable", deliveryId: row.delivery_id }
        : {
            kind: "failed_permanent",
            code: "provider_rejected",
            deliveryId: row.delivery_id,
          };
    }

    const providerMessageId = response.data?.id;
    if (
      typeof providerMessageId !== "string" ||
      providerMessageId.length === 0 ||
      providerMessageId.length > 255 ||
      providerMessageId.trim() !== providerMessageId
    ) {
      const recorded = await recordEmailFailure(
        client,
        row.delivery_id,
        claimToken,
        "provider_invalid_response",
        null,
      );
      return recorded
        ? {
            kind: "failed_permanent",
            code: "provider_invalid_response",
            deliveryId: row.delivery_id,
          }
        : { kind: "unavailable", deliveryId: row.delivery_id };
    }

    const finalized = await client.rpc("record_email_send_success", {
      p_delivery_id: row.delivery_id,
      p_claim_token: claimToken,
      p_provider_message_id: providerMessageId,
    });
    if (rpcFailed(finalized.error)) {
      return { kind: "unavailable", deliveryId: row.delivery_id };
    }
    return { kind: "sent", deliveryId: row.delivery_id, providerMessageId };
  } catch (error) {
    const retryable = isRetryableProviderFailure(error);
    const code = providerFailureCode(error);
    const recorded = await recordEmailFailure(
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
    if (!recorded) return { kind: "unavailable", deliveryId: row.delivery_id };
    return retryable
      ? { kind: "retryable", deliveryId: row.delivery_id }
      : {
          kind: "failed_permanent",
          code: "provider_rejected",
          deliveryId: row.delivery_id,
        };
  }
}
