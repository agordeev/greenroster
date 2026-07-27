import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Resend } from "resend";

import {
  buildInvitationAcceptanceUrl,
  createInvitationToken,
} from "../invitations/invitation-token";
import {
  renderMembershipInvitationEmail,
  type MembershipInvitationEmail,
} from "../../emails/membership-invitation";

type RpcError = Readonly<{
  code?: string;
  message?: string;
}>;

export type NotificationRpcClient = Readonly<{
  rpc: (
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ) => PromiseLike<Readonly<{ data: unknown; error: RpcError | null }>>;
}>;

export type NotificationEmailWorkerConfig = Readonly<{
  appUrl: string;
  invitationTokenSecret: string;
  resendApiKey: string;
  resendFromEmail: string;
  maxAttempts: number;
  retrySeconds: number;
}>;

export type ProviderEmailMessage = Readonly<{
  from: string;
  html: string;
  subject: string;
  text: string;
  to: string;
}>;

export type ProviderSendResult = Readonly<{
  data: Readonly<{ id: string }> | null;
  error: Readonly<{
    name?: string;
    statusCode?: number | null;
  }> | null;
}>;

export type NotificationEmailProvider = Readonly<{
  send: (
    message: ProviderEmailMessage,
    options: Readonly<{ idempotencyKey: string }>,
  ) => ProviderSendResult | PromiseLike<ProviderSendResult>;
}>;

export type InvitationEmailWorkerDependencies = Readonly<{
  createClaimToken: () => string;
  createClient: () => NotificationRpcClient | Promise<NotificationRpcClient>;
  createProvider: (apiKey: string) => NotificationEmailProvider;
  getConfig: () =>
    NotificationEmailWorkerConfig | Promise<NotificationEmailWorkerConfig>;
  now: () => Date;
  renderEmail: (
    input: Readonly<{
      acceptanceUrl: string;
      expiresAt: string;
      firstName: string;
      groupName: string;
    }>,
  ) => MembershipInvitationEmail | Promise<MembershipInvitationEmail>;
}>;

export type InvitationEmailWorkerResult =
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      deliveryId: string;
      kind: "sent";
      providerMessageId: string;
    }>
  | Readonly<{ deliveryId: string; kind: "retryable" }>
  | Readonly<{
      code: NotificationPermanentFailureCode;
      deliveryId: string;
      kind: "failed_permanent";
    }>
  | Readonly<{
      code: "max_attempts_exceeded";
      deliveryId: string;
      kind: "abandoned";
    }>
  | Readonly<{ deliveryId?: string; kind: "unavailable" }>;

export const notificationPermanentFailureCodes = [
  "provider_rejected",
  "provider_invalid_response",
  "unsupported_token_key_version",
  "invalid_claim",
  "max_attempts_exceeded",
] as const;

export type NotificationPermanentFailureCode =
  (typeof notificationPermanentFailureCodes)[number];
export type NotificationFailureCode =
  | NotificationPermanentFailureCode
  | "provider_rate_limited"
  | "provider_unavailable";

const claimRowsSchema = z
  .array(
    z
      .object({
        delivery_id: z.uuid(),
        outbox_job_id: z.uuid(),
        invitation_id: z.uuid(),
        group_id: z.uuid(),
        group_name: z.string().min(1),
        recipient_address: z.email(),
        member_first_name: z.string().min(1),
        invitation_expires_at: z.string().datetime({ offset: true }),
        token_key_version: z.number().int().positive(),
        attempt_number: z.number().int().positive(),
      })
      .strict(),
  )
  .max(1);

const defaultDependencies: InvitationEmailWorkerDependencies = {
  createClaimToken: randomUUID,
  createClient: async () => {
    const { createSupabaseServiceClient } =
      await import("../supabase/service-client");
    return createSupabaseServiceClient();
  },
  createProvider: (apiKey) => {
    const resend = new Resend(apiKey);
    return {
      send: (message, options) =>
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
      invitationTokenSecret: webRuntimeEnv.invitationTokenSecret,
      resendApiKey: webRuntimeEnv.resendApiKey,
      resendFromEmail: webRuntimeEnv.resendFromEmail,
      maxAttempts: webRuntimeEnv.notificationEmailMaxAttempts,
      retrySeconds: webRuntimeEnv.notificationEmailRetrySeconds,
    };
  },
  now: () => new Date(),
  renderEmail: renderMembershipInvitationEmail,
};

function isRpcFailure(error: RpcError | null): boolean {
  return error !== null;
}

function providerStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    statusCode?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  for (const value of [
    candidate.statusCode,
    candidate.status,
    candidate.response?.status,
  ]) {
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return null;
}

function providerErrorName(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

export function isRetryableProviderFailure(error: unknown): boolean {
  const status = providerStatus(error);
  const name = providerErrorName(error);
  if (name === "concurrent_idempotent_requests") return true;
  if (status !== null) return status === 429 || status >= 500;
  if (
    name === "invalid_api_key" ||
    name === "restricted_api_key" ||
    name === "invalid_from_address" ||
    name === "validation_error" ||
    name === "invalid_parameter" ||
    name === "missing_required_field" ||
    name === "invalid_idempotency_key"
  ) {
    return false;
  }
  return true;
}

export function providerFailureCode(error: unknown): NotificationFailureCode {
  const status = providerStatus(error);
  const name = providerErrorName(error);
  if (status === 429 || name === "concurrent_idempotent_requests") {
    return "provider_rate_limited";
  }
  if (status === null && name === "internal_server_error") {
    return "provider_unavailable";
  }
  if (status === null && name === "application_error") {
    return "provider_unavailable";
  }
  if (status === null || status >= 500) return "provider_unavailable";
  return "provider_rejected";
}

export function retryAt(now: Date, retrySeconds: number): string {
  return new Date(now.getTime() + retrySeconds * 1000).toISOString();
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

export async function recordEmailFailure(
  client: NotificationRpcClient,
  deliveryId: string,
  claimToken: string,
  safeError: NotificationFailureCode,
  retryAtValue: string | null,
): Promise<boolean> {
  try {
    const result = await client.rpc("record_email_send_failure", {
      p_delivery_id: deliveryId,
      p_claim_token: claimToken,
      p_safe_error: safeError,
      p_retry_at: retryAtValue,
    });
    return !isRpcFailure(result.error);
  } catch {
    return false;
  }
}

export async function runInvitationEmailWorker(
  overrides?: Partial<InvitationEmailWorkerDependencies>,
): Promise<InvitationEmailWorkerResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const config = await dependencies.getConfig();
  const client = await dependencies.createClient();
  const claimToken = dependencies.createClaimToken();
  const staleBefore = new Date(
    dependencies.now().getTime() - config.retrySeconds * 1000,
  ).toISOString();
  const claim = await client.rpc("claim_membership_invitation_email", {
    p_claim_token: claimToken,
    p_stale_before: staleBefore,
  });

  if (isRpcFailure(claim.error)) return { kind: "unavailable" };

  const parsedClaim = parseClaimRows(claim.data);
  if (parsedClaim.kind === "empty") return parsedClaim;
  if (parsedClaim.kind === "invalid") return { kind: "unavailable" };
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

  let acceptanceUrl: string;
  try {
    const token = createInvitationToken({
      invitationId: row.invitation_id,
      keyVersion: row.token_key_version as 1,
      secret: config.invitationTokenSecret,
    });
    acceptanceUrl = buildInvitationAcceptanceUrl({
      appUrl: config.appUrl,
      invitationId: row.invitation_id,
      rawToken: token.rawToken,
    });
  } catch {
    const recorded = await recordEmailFailure(
      client,
      row.delivery_id,
      claimToken,
      "unsupported_token_key_version",
      null,
    );
    return recorded
      ? {
          kind: "failed_permanent",
          code: "unsupported_token_key_version",
          deliveryId: row.delivery_id,
        }
      : { kind: "unavailable", deliveryId: row.delivery_id };
  }

  let email: MembershipInvitationEmail;
  try {
    email = await dependencies.renderEmail({
      acceptanceUrl,
      expiresAt: row.invitation_expires_at,
      firstName: row.member_first_name,
      groupName: row.group_name,
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
      { idempotencyKey: `membership-invitation/${row.delivery_id}` },
    );

    if (response.error) {
      const retryable = isRetryableProviderFailure(response.error);
      const code = providerFailureCode(response.error);
      const recorded = await recordEmailFailure(
        client,
        row.delivery_id,
        claimToken,
        code,
        retryable ? retryAt(dependencies.now(), config.retrySeconds) : null,
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
    if (isRpcFailure(finalized.error)) {
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
      retryable ? retryAt(dependencies.now(), config.retrySeconds) : null,
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
