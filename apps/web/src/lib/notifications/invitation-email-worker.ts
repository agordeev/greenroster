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
  "provider_invalid",
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

export type ClaimedEmailRow = Readonly<{
  attempt_number: number;
  delivery_id: string;
  recipient_address: string;
}>;

export type ClaimedEmailContent = Readonly<
  Pick<ProviderEmailMessage, "html" | "subject" | "text">
>;

export type ClaimedEmailWorkerConfig = Pick<
  NotificationEmailWorkerConfig,
  "maxAttempts" | "resendApiKey" | "resendFromEmail" | "retrySeconds"
>;

export type ClaimedEmailWorkerDependencies<Config, Input, Email> = Readonly<{
  createClaimToken: () => string;
  createClient: () => NotificationRpcClient | Promise<NotificationRpcClient>;
  createProvider: (apiKey: string) => NotificationEmailProvider;
  getConfig: () => Config | Promise<Config>;
  now: () => Date;
  renderEmail: (input: Input) => Email | Promise<Email>;
}>;

export type ClaimedEmailWorkerSpec<Row, Config, Input> = Readonly<{
  buildEmailInput: (row: Row, config: Config) => Input;
  claimFunction: string;
  idempotencyPrefix: string;
  rowsSchema: z.ZodType<Row[]>;
}>;

type FailureRecorder = (
  safeError: NotificationFailureCode,
  retryAtValue: string | null,
) => Promise<boolean>;

const claimEnvelopeSchema = z
  .array(
    z
      .object({
        delivery_id: z.uuid(),
      })
      .passthrough(),
  )
  .max(1);

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

export const defaultClaimedEmailDependencies = {
  createClaimToken: randomUUID,
  createClient: async (): Promise<NotificationRpcClient> => {
    const { createSupabaseServiceClient } =
      await import("../supabase/service-client");
    return createSupabaseServiceClient();
  },
  createProvider: (apiKey: string): NotificationEmailProvider => {
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
  now: () => new Date(),
};

const defaultDependencies: InvitationEmailWorkerDependencies = {
  ...defaultClaimedEmailDependencies,
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
  if (status === null || status >= 500) return "provider_unavailable";
  return "provider_rejected";
}

export function retryAt(now: Date, retrySeconds: number): string {
  return new Date(now.getTime() + retrySeconds * 1000).toISOString();
}

export function retryAtWithBackoff(
  now: Date,
  retrySeconds: number,
  attemptNumber: number,
): string {
  const exponent = Math.max(attemptNumber - 1, 0);
  const maxDateDelayMs = Math.max(8_640_000_000_000_000 - now.getTime(), 0);
  const delayMs = Math.min(
    retrySeconds * 1000 * 2 ** exponent,
    retrySeconds * 16 * 1000,
    maxDateDelayMs,
  );
  return new Date(now.getTime() + delayMs).toISOString();
}

type ParsedClaimRows<Row> =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "row"; row: Row }>
  | Readonly<{ deliveryId: string; kind: "invalid_claim" }>
  | Readonly<{ kind: "invalid" }>;

function parseClaimRows<Row>(
  data: unknown,
  rowsSchema: z.ZodType<Row[]>,
): ParsedClaimRows<Row> {
  if (data === null || (Array.isArray(data) && data.length === 0)) {
    return { kind: "empty" };
  }
  const parsed = rowsSchema.safeParse(data);
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

async function permanentFailure(
  client: NotificationRpcClient,
  claimToken: string,
  deliveryId: string,
  code: NotificationPermanentFailureCode,
): Promise<InvitationEmailWorkerResult> {
  const recorded = await recordEmailFailure(
    client,
    deliveryId,
    claimToken,
    code,
    null,
  );
  return recorded
    ? { kind: "failed_permanent", code, deliveryId }
    : { kind: "unavailable", deliveryId };
}

async function abandonedFailure(
  client: NotificationRpcClient,
  claimToken: string,
  deliveryId: string,
): Promise<InvitationEmailWorkerResult> {
  const recorded = await recordEmailFailure(
    client,
    deliveryId,
    claimToken,
    "max_attempts_exceeded",
    null,
  );
  return recorded
    ? { kind: "abandoned", code: "max_attempts_exceeded", deliveryId }
    : { kind: "unavailable", deliveryId };
}

export async function recordProviderFailure(
  recordFailure: FailureRecorder,
  deliveryId: string,
  error: unknown,
  retry: Readonly<{
    attemptNumber: number;
    now: () => Date;
    retrySeconds: number;
  }>,
): Promise<InvitationEmailWorkerResult> {
  const retryable = isRetryableProviderFailure(error);
  const recorded = await recordFailure(
    providerFailureCode(error),
    retryable
      ? retryAtWithBackoff(retry.now(), retry.retrySeconds, retry.attemptNumber)
      : null,
  );
  if (!recorded) return { kind: "unavailable", deliveryId };
  return retryable
    ? { kind: "retryable", deliveryId }
    : { kind: "failed_permanent", code: "provider_rejected", deliveryId };
}

export async function runClaimedEmailWorker<
  Row extends ClaimedEmailRow,
  Config extends ClaimedEmailWorkerConfig,
  Input,
  Email extends ClaimedEmailContent,
>(
  spec: ClaimedEmailWorkerSpec<Row, Config, Input>,
  dependencies: ClaimedEmailWorkerDependencies<Config, Input, Email>,
): Promise<InvitationEmailWorkerResult> {
  const config = await dependencies.getConfig();
  const client = await dependencies.createClient();
  const claimToken = dependencies.createClaimToken();
  const staleBefore = new Date(
    dependencies.now().getTime() - config.retrySeconds * 1000,
  ).toISOString();
  const claim = await client.rpc(spec.claimFunction, {
    p_claim_token: claimToken,
    p_stale_before: staleBefore,
  });

  if (isRpcFailure(claim.error)) return { kind: "unavailable" };
  const parsedClaim = parseClaimRows(claim.data, spec.rowsSchema);
  if (parsedClaim.kind === "empty") return parsedClaim;
  if (parsedClaim.kind === "invalid") return { kind: "unavailable" };
  if (parsedClaim.kind === "invalid_claim") {
    return permanentFailure(
      client,
      claimToken,
      parsedClaim.deliveryId,
      "invalid_claim",
    );
  }
  const row = parsedClaim.row;

  if (row.attempt_number > config.maxAttempts) {
    return abandonedFailure(client, claimToken, row.delivery_id);
  }

  const recordFailure: FailureRecorder = (safeError, retryAtValue) =>
    recordEmailFailure(
      client,
      row.delivery_id,
      claimToken,
      safeError,
      retryAtValue,
    );
  const retry = {
    attemptNumber: row.attempt_number,
    now: dependencies.now,
    retrySeconds: config.retrySeconds,
  };

  let email: Email;
  try {
    email = await dependencies.renderEmail(spec.buildEmailInput(row, config));
  } catch {
    return permanentFailure(
      client,
      claimToken,
      row.delivery_id,
      "provider_invalid_response",
    );
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
      { idempotencyKey: `${spec.idempotencyPrefix}/${row.delivery_id}` },
    );

    if (response.error) {
      return recordProviderFailure(
        recordFailure,
        row.delivery_id,
        response.error,
        retry,
      );
    }

    const providerMessageId = response.data?.id;
    if (
      typeof providerMessageId !== "string" ||
      providerMessageId.length === 0 ||
      providerMessageId.length > 255 ||
      providerMessageId.trim() !== providerMessageId
    ) {
      return permanentFailure(
        client,
        claimToken,
        row.delivery_id,
        "provider_invalid_response",
      );
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
    return recordProviderFailure(recordFailure, row.delivery_id, error, retry);
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

  const parsedClaim = parseClaimRows(claim.data, claimRowsSchema);
  if (parsedClaim.kind === "empty") return parsedClaim;
  if (parsedClaim.kind === "invalid") return { kind: "unavailable" };
  if (parsedClaim.kind === "invalid_claim") {
    return permanentFailure(
      client,
      claimToken,
      parsedClaim.deliveryId,
      "invalid_claim",
    );
  }
  const row = parsedClaim.row;

  if (row.attempt_number > config.maxAttempts) {
    return abandonedFailure(client, claimToken, row.delivery_id);
  }

  const recordFailure: FailureRecorder = (safeError, retryAtValue) =>
    recordEmailFailure(
      client,
      row.delivery_id,
      claimToken,
      safeError,
      retryAtValue,
    );
  const retry = {
    attemptNumber: row.attempt_number,
    now: dependencies.now,
    retrySeconds: config.retrySeconds,
  };

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
    return permanentFailure(
      client,
      claimToken,
      row.delivery_id,
      "unsupported_token_key_version",
    );
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
    return permanentFailure(
      client,
      claimToken,
      row.delivery_id,
      "provider_invalid_response",
    );
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
      return recordProviderFailure(
        recordFailure,
        row.delivery_id,
        response.error,
        retry,
      );
    }

    const providerMessageId = response.data?.id;
    if (
      typeof providerMessageId !== "string" ||
      providerMessageId.length === 0 ||
      providerMessageId.length > 255 ||
      providerMessageId.trim() !== providerMessageId
    ) {
      return permanentFailure(
        client,
        claimToken,
        row.delivery_id,
        "provider_invalid_response",
      );
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
    return recordProviderFailure(recordFailure, row.delivery_id, error, retry);
  }
}
