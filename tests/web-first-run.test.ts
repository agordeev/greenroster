import { describe, expect, it } from "vitest";

import { webFirstRunInputSchema } from "../apps/web/src/lib/profile/web-first-run";

describe("web member first-run input", () => {
  const valid = {
    firstName: "  Alex ",
    lastName: " Member ",
    termsVersion: "terms-test-v1",
    privacyVersion: "privacy-test-v1",
    acceptedTerms: true,
    acceptedPrivacy: true,
    operationId: "50000000-0000-4000-8000-000000000001",
  } as const;

  it("normalizes names and requires both legal confirmations", () => {
    expect(webFirstRunInputSchema.parse(valid)).toMatchObject({
      firstName: "Alex",
      lastName: "Member",
    });
    expect(
      webFirstRunInputSchema.safeParse({ ...valid, acceptedPrivacy: false })
        .success,
    ).toBe(false);
    expect(
      webFirstRunInputSchema.safeParse({ ...valid, firstName: "" }).success,
    ).toBe(false);
  });
});
