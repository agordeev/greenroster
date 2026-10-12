import { describe, expect, it } from "vitest";

import {
  createCsv,
  createMemberRosterCsv,
} from "../apps/web/src/lib/exports/csv-export";

describe("CSV exports", () => {
  it("quotes cells, preserves commas, and neutralizes spreadsheet formulas", () => {
    const csv = createCsv(["Name", "Note"], [["Ada, Lovelace", "=1+1"]]);

    expect(csv).toBe('\uFEFF"Name","Note"\r\n"Ada, Lovelace","\'=1+1"\r\n');
  });

  it("writes a stable member roster header and rows", () => {
    const csv = createMemberRosterCsv([
      {
        membershipId: "00000000-0000-4000-8000-000000000001",
        firstName: "Ada",
        lastName: "Lovelace",
        status: "active",
        role: "member",
        duesPaid: true,
        teeLocation: "back",
        handicapValue: "12.4",
        handicapSource: "manual",
        handicapAsOf: "2026-08-10",
        handicapId: "GH-1",
        currentQuota: "8.5",
        currentQuotaProvenance: null,
        currentQuotaEffectiveAt: "2026-08-10T09:00:00.000Z",
        usesInitialQuota: false,
        dateAdded: "2026-08-01T09:00:00.000Z",
        invitationState: "accepted",
        invitationDeliveryActionRequired: false,
      },
    ]);

    expect(csv).toContain('"Member ID","First name","Last name"');
    expect(csv).toContain('"Ada","Lovelace","active","member","Yes"');
  });
});
