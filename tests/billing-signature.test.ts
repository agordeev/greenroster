import { describe, expect, it } from "vitest";

import {
  createStripeSignature,
  verifyStripeWebhookSignature,
} from "@/lib/billing/stripe-signature";

describe("Stripe webhook signatures", () => {
  it("accepts a fresh signed payload and rejects changed payloads", () => {
    const payload = JSON.stringify({ id: "evt_test_1", type: "invoice.paid" });
    const signature = createStripeSignature(
      payload,
      "whsec_test_secret_123",
      1_800_000_000,
    );

    expect(
      verifyStripeWebhookSignature(
        payload,
        signature,
        "whsec_test_secret_123",
        1_800_000_010,
        300,
      ),
    ).toBe(true);
    expect(
      verifyStripeWebhookSignature(
        `${payload} `,
        signature,
        "whsec_test_secret_123",
        1_800_000_010,
        300,
      ),
    ).toBe(false);
  });

  it("rejects stale or malformed signatures", () => {
    const payload = "{}";
    const signature = createStripeSignature(
      payload,
      "whsec_test_secret_123",
      1_800_000_000,
    );

    expect(
      verifyStripeWebhookSignature(
        payload,
        signature,
        "whsec_test_secret_123",
        1_800_000_500,
        300,
      ),
    ).toBe(false);
    expect(
      verifyStripeWebhookSignature(
        payload,
        "t=bad,v1=00",
        "whsec_test_secret_123",
        1_800_000_000,
      ),
    ).toBe(false);
  });
});
