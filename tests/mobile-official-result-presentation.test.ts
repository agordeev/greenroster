import { describe, expect, it } from "vitest";

import {
  buildOfficialResultAccessibilityLabel,
  OFFICIAL_RESULTS_REFRESH_INTERVAL_MS,
} from "../apps/mobile/src/lib/rounds/mobile-official-result-presentation";
import type { MobileOfficialRoundResult } from "../apps/mobile/src/lib/rounds/mobile-official-results-api";

const result: MobileOfficialRoundResult = {
  roundId: "10000000-0000-4000-8000-000000000001",
  groupId: "20000000-0000-4000-8000-000000000001",
  completionId: "30000000-0000-4000-8000-000000000001",
  completionNumber: 1,
  completedAt: "2026-08-04T12:00:00.000Z",
  roundVersion: 3,
  participantId: "40000000-0000-4000-8000-000000000001",
  participantKind: "member",
  membershipId: "50000000-0000-4000-8000-000000000001",
  sponsorMembershipId: null,
  firstName: "Ada",
  lastName: "Lovelace",
  rsvpStatus: "playing",
  rsvpChangedAt: "2026-08-04T08:00:00.000Z",
  scoreRevisionId: "60000000-0000-4000-8000-000000000001",
  golfPoints: "42.50",
  grossScore: "80",
  netScore: "68",
  quotaSnapshot: "12.50",
  plusMinus: "4.25",
  rankingValue: "4.25",
  competitionRank: 1,
  participationMerit: "2.00",
  placementMerit: "10.00",
  manualMerit: "0.00",
  generatedMerit: "12.00",
  totalMerit: "12.00",
};

describe("mobile official result presentation", () => {
  it("refreshes active result screens often enough to clear a Reopen without navigation", () => {
    expect(OFFICIAL_RESULTS_REFRESH_INTERVAL_MS).toBe(15_000);
  });

  it("includes Gross plus/minus and all result facts in accessibility output", () => {
    const label = buildOfficialResultAccessibilityLabel(
      "individual_gross",
      "UTC",
      result,
    );
    expect(label).toContain("Points 42.50");
    expect(label).toContain("Plus/minus 4.25");
    expect(label).toContain("Gross 80");
  });

  it("keeps Not applicable explicit for a Net result without gross-only facts", () => {
    const label = buildOfficialResultAccessibilityLabel(
      "individual_net",
      "UTC",
      { ...result, plusMinus: null, grossScore: null },
    );
    expect(label).toContain("Plus/minus Not applicable");
    expect(label).toContain("Gross Not applicable");
  });
});
