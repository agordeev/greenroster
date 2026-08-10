import { describe, expect, it } from "vitest";

import {
  memberDirectoryFromPayload,
  memberDirectoryPayloadSchema,
} from "../apps/web/src/domain/member-directory";

describe("member web directory contract", () => {
  it("maps only the server-projected contact fields", () => {
    const parsed = memberDirectoryPayloadSchema.safeParse({
      group: {
        group_id: "f2000000-0000-4000-8000-000000000001",
        name: "Example group",
        time_zone: "UTC",
      },
      members: [
        {
          membership_id: "f3000000-0000-4000-8000-000000000001",
          first_name: "Alex",
          last_name: "Golfer",
          tee_location: "middle",
          mobile_phone: "555-0100",
          address: { city: "Austin", state_region: "TX" },
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(memberDirectoryFromPayload(parsed.data).members[0]).toMatchObject({
      firstName: "Alex",
      lastName: "Golfer",
      mobilePhone: "555-0100",
      address: { city: "Austin", stateRegion: "TX" },
    });
  });
});
