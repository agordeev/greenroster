import { describe, expect, it } from "vitest";

import {
  memberSelfHandicapInputSchema,
  normalizeMemberSelfProfileDraft,
} from "../apps/web/src/domain/member-self-profile";

describe("member web profile contract", () => {
  it("normalizes member-owned profile fields without changing visibility rules", () => {
    const draft = normalizeMemberSelfProfileDraft({
      firstName: "  Alex ",
      lastName: " Golfer ",
      secondaryEmail: "  Alex.Secondary@example.com ",
      mobilePhone: " 555-0100 ",
      secondaryEmailVisible: true,
      mobilePhoneVisible: true,
    });

    expect(draft).toMatchObject({
      firstName: "Alex",
      lastName: "Golfer",
      secondaryEmail: "alex.secondary@example.com",
      mobilePhone: "555-0100",
      secondaryEmailVisible: true,
      mobilePhoneVisible: true,
      homePhoneVisible: false,
      addressListed: false,
    });
  });

  it("keeps handicap submission bounded and explicitly confirmed", () => {
    const invalid = memberSelfHandicapInputSchema.safeParse({
      handicapId: "",
      handicap: "54.1",
      asOf: "2026-08-10",
      expectedMembershipVersion: 1,
      confirmed: true,
      reason: "New card",
      operationId: "f1000000-0000-4000-8000-000000000001",
    });
    expect(invalid.success).toBe(false);

    const valid = memberSelfHandicapInputSchema.safeParse({
      handicapId: "GHIN-42",
      handicap: "12.3",
      asOf: "2026-08-10",
      expectedMembershipVersion: 1,
      confirmed: true,
      reason: "New card",
      operationId: "f1000000-0000-4000-8000-000000000001",
    });
    expect(valid.success).toBe(true);
  });
});
