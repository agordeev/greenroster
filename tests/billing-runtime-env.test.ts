import { describe, expect, it } from "vitest";

import { validateBillingRuntimeEnv } from "@/lib/billing/billing-runtime-env";

const valid = {
  STRIPE_SECRET_KEY: "sk_test_1234567890123456",
  STRIPE_WEBHOOK_SECRET: "whsec_1234567890123456",
  STRIPE_PRICE_ID: "price_annual",
};

describe("billing runtime configuration", () => {
  it("fails fast when a Stripe secret is missing", () => {
    expect(() =>
      validateBillingRuntimeEnv({ ...valid, STRIPE_WEBHOOK_SECRET: undefined }),
    ).toThrow("STRIPE_WEBHOOK_SECRET");
  });

  it("uses a bounded webhook tolerance and the Stripe API default", () => {
    const result = validateBillingRuntimeEnv(valid);
    expect(result.apiBaseUrl).toBe("https://api.stripe.com");
    expect(result.webhookToleranceSeconds).toBe(300);
  });
});
