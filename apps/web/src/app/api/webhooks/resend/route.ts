import { Resend } from "resend";

import {
  parseResendFeedbackPayload,
  recordResendFeedback,
  type ResendFeedbackEvent,
} from "../../../../lib/notifications/resend-feedback";
import type { NotificationRpcClient } from "../../../../lib/notifications/invitation-email-worker";

type ResendVerificationHeaders = Readonly<{
  id: string;
  signature: string;
  timestamp: string;
}>;

export type ResendWebhookRouteDependencies = Readonly<{
  createClient: () => NotificationRpcClient | Promise<NotificationRpcClient>;
  getWebhookSecret: () => string | Promise<string>;
  recordFeedback: (
    client: NotificationRpcClient,
    eventId: string,
    event: ResendFeedbackEvent,
  ) => boolean | Promise<boolean>;
  verify: (
    payload: string,
    headers: ResendVerificationHeaders,
    webhookSecret: string,
  ) => unknown;
}>;

const defaultDependencies: ResendWebhookRouteDependencies = {
  createClient: async () => {
    const { createSupabaseServiceClient } =
      await import("../../../../lib/supabase/service-client");
    return createSupabaseServiceClient();
  },
  getWebhookSecret: async () => {
    const { webRuntimeEnv } = await import("../../../../lib/runtime-env");
    return webRuntimeEnv.resendWebhookSecret;
  },
  recordFeedback: recordResendFeedback,
  verify: defaultVerify,
};

async function defaultVerify(
  payload: string,
  headers: ResendVerificationHeaders,
  webhookSecret: string,
): Promise<unknown> {
  const { webRuntimeEnv } = await import("../../../../lib/runtime-env");
  return new Resend(webRuntimeEnv.resendApiKey).webhooks.verify({
    payload,
    headers,
    webhookSecret,
  });
}

function response(status: number, body: Readonly<Record<string, unknown>>) {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

function signedHeaders(request: Request): ResendVerificationHeaders | null {
  const id = request.headers.get("svix-id")?.trim();
  const timestamp = request.headers.get("svix-timestamp")?.trim();
  const signature = request.headers.get("svix-signature")?.trim();
  if (!id || !timestamp || !signature) return null;
  return { id, signature, timestamp };
}

export async function handleResendWebhookRequest(
  request: Request,
  overrides?: Partial<ResendWebhookRouteDependencies>,
): Promise<Response> {
  const dependencies = {
    ...defaultDependencies,
    verify: defaultVerify,
    ...overrides,
  };
  const headers = signedHeaders(request);
  if (!headers) return response(400, { ok: false, status: "invalid_request" });

  const rawBody = await request.text();
  let verifiedPayload: unknown;
  try {
    const webhookSecret = await dependencies.getWebhookSecret();
    verifiedPayload = await dependencies.verify(
      rawBody,
      headers,
      webhookSecret,
    );
  } catch {
    return response(400, { ok: false, status: "invalid_signature" });
  }

  const parsed = parseResendFeedbackPayload(verifiedPayload);
  if (parsed.kind === "invalid") {
    return response(400, { ok: false, status: "invalid_payload" });
  }
  if (parsed.kind === "ignored") {
    return response(200, { ok: true, status: "ignored" });
  }

  try {
    const client = await dependencies.createClient();
    const recorded = await dependencies.recordFeedback(
      client,
      headers.id,
      parsed.event,
    );
    if (!recorded) return response(503, { ok: false, status: "unavailable" });
  } catch {
    return response(503, { ok: false, status: "unavailable" });
  }

  return response(200, { ok: true, status: "processed" });
}

export async function POST(request: Request): Promise<Response> {
  return handleResendWebhookRequest(request);
}
