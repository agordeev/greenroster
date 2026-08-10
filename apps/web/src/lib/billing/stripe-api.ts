import "server-only";

import { readBillingRuntimeEnv } from "./billing-runtime-env";

type StripeSession = Readonly<{
  id: string;
  url?: string | null;
}>;

type StripeErrorResponse = Readonly<{ error?: { message?: string } }>;

export async function createStripeCheckoutSession(input: {
  customerId?: string | null;
  priceId?: string;
  quantity: number;
  groupId: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<StripeSession> {
  const env = readBillingRuntimeEnv();
  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": input.priceId ?? env.priceId,
    "line_items[0][quantity]": String(input.quantity),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "metadata[group_id]": input.groupId,
    "subscription_data[metadata][group_id]": input.groupId,
    customer_creation: input.customerId ? "if_required" : "always",
  });
  if (input.customerId) form.set("customer", input.customerId);
  if (input.customerEmail) form.set("customer_email", input.customerEmail);
  return stripePost<StripeSession>(env, "/v1/checkout/sessions", form);
}

export async function createStripeCustomerPortalSession(input: {
  customerId: string;
  returnUrl: string;
}): Promise<StripeSession> {
  const env = readBillingRuntimeEnv();
  const form = new URLSearchParams({
    customer: input.customerId,
    return_url: input.returnUrl,
  });
  return stripePost<StripeSession>(env, "/v1/billing_portal/sessions", form);
}

async function stripePost<T>(
  env: ReturnType<typeof readBillingRuntimeEnv>,
  path: string,
  body: URLSearchParams,
): Promise<T> {
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as T &
    StripeErrorResponse;
  if (!response.ok) {
    throw new Error(
      data.error?.message || `Stripe request failed with ${response.status}`,
    );
  }
  if (!data || typeof data !== "object" || !("id" in data)) {
    throw new Error("Stripe returned an invalid session");
  }
  return data as T;
}
