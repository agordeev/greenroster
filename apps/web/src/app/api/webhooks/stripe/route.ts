import { z } from "zod";

import { readBillingRuntimeEnv } from "@/lib/billing/billing-runtime-env";
import { verifyStripeWebhookSignature } from "@/lib/billing/stripe-signature";
import { createSupabaseServiceClient } from "@/lib/supabase/service-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const eventSchema = z
  .object({
    id: z.string().regex(/^evt_[A-Za-z0-9]+$/),
    type: z.string().min(1),
    created: z.number().int().nonnegative(),
  })
  .passthrough();

export async function POST(request: Request): Promise<Response> {
  let env: ReturnType<typeof readBillingRuntimeEnv>;
  try {
    env = readBillingRuntimeEnv();
  } catch {
    return Response.json({ error: "billing_unavailable" }, { status: 503 });
  }
  const payload = await request.text();
  if (
    !verifyStripeWebhookSignature(
      payload,
      request.headers.get("stripe-signature"),
      env.webhookSecret,
      Math.floor(Date.now() / 1000),
      env.webhookToleranceSeconds,
    )
  ) {
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }
  let event: z.infer<typeof eventSchema>;
  try {
    event = eventSchema.parse(JSON.parse(payload));
  } catch {
    return Response.json({ error: "invalid_event" }, { status: 400 });
  }
  try {
    const service = createSupabaseServiceClient();
    const result = await service.rpc("process_stripe_billing_event", {
      p_stripe_event_id: event.id,
      p_event_type: event.type,
      p_stripe_created_at: new Date(event.created * 1000).toISOString(),
      p_payload: event,
    });
    if (result.error) throw result.error;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return Response.json(
      {
        received: true,
        state: row?.event_state ?? "processed",
        applied: row?.applied ?? false,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Stripe retries non-2xx responses. A database error is intentionally
    // retained by the SQL reconciliation function where possible.
    return Response.json(
      { error: "reconciliation_unavailable" },
      { status: 503 },
    );
  }
}
