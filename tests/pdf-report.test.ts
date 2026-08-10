import { describe, expect, it } from "vitest";

import {
  createReportPdf,
  createScorepadPdf,
} from "../apps/web/src/lib/exports/pdf-report";

describe("PDF reports", () => {
  it("creates a valid PDF header with report context", () => {
    const pdf = createReportPdf(
      {
        groupName: "Ada's Group",
        generatedAt: "2026-08-10T12:00:00.000Z",
        timeZone: "America/New_York",
        reportingWindow: "Current standings",
        containsPrivateData: false,
      },
      {
        title: "Standings",
        columns: ["Rank", "Player"],
        rows: [[1, "Ada Lovelace"]],
      },
    );

    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Group: Ada's Group");
    expect(text).toContain("Private data: No");
    expect(text).toContain("Ada Lovelace");
    expect(text.endsWith("%%EOF\n")).toBe(true);
  });

  it("keeps the score pad official and excludes private data", () => {
    const pdf = createScorepadPdf(
      {
        groupName: "Group",
        generatedAt: "2026-08-10T12:00:00.000Z",
        timeZone: "UTC",
        reportingWindow: "Current group data",
        containsPrivateData: true,
      },
      {
        id: "00000000-0000-4000-8000-000000000001",
        group_id: "00000000-0000-4000-8000-000000000002",
        description: "August round",
        scheduled_at: "2026-08-10T09:00:00.000Z",
        group_time_zone: "UTC",
        format: "individual_net",
        state: "completed",
      },
      [
        {
          round_id: "00000000-0000-4000-8000-000000000001",
          group_id: "00000000-0000-4000-8000-000000000002",
          completion_id: "00000000-0000-4000-8000-000000000003",
          completion_number: 1,
          completed_at: "2026-08-10T12:00:00.000Z",
          round_version: 1,
          participant_id: "00000000-0000-4000-8000-000000000004",
          participant_kind: "member",
          membership_id: "00000000-0000-4000-8000-000000000005",
          sponsor_membership_id: null,
          first_name: "Ada",
          last_name: "Lovelace",
          rsvp_status: "playing",
          rsvp_changed_at: null,
          score_revision_id: null,
          golf_points: "4",
          gross_score: "82",
          net_score: "70",
          quota_snapshot: "8",
          plus_minus: "2",
          ranking_value: "4",
          competition_rank: 1,
          participation_merit: "1",
          placement_merit: "2",
          manual_merit: "0",
          generated_merit: "3",
          total_merit: "3",
        },
      ],
    );
    const text = new TextDecoder().decode(pdf);
    expect(text).toContain("points score pad");
    expect(text).toContain("Private data: No");
    expect(text).toContain("Official");
  });
});
