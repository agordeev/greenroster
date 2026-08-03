import { describe, expect, it } from "vitest";

import {
  formatParticipantRsvp,
  formatSnapshotValue,
  participantDisplayName,
  type RoundCoordinatorDetail,
} from "../apps/web/src/domain/round-detail";
import { RoundReadOnlyDetail } from "../apps/web/src/app/portal/rounds/round-read-only-detail";

const detail: RoundCoordinatorDetail = {
  roundId: "40000000-0000-4000-8000-000000000001",
  groupId: "50000000-0000-4000-8000-000000000001",
  description: "Published round",
  scheduledAt: "2026-08-15T13:30:00.000Z",
  groupTimeZone: "America/New_York",
  venue: "North Course",
  roundUrl: null,
  notes: "Bring a cart.",
  notesVisibleToPlayers: false,
  rsvpDeadlineAt: "2026-08-14T13:30:00.000Z",
  format: "individual_net",
  state: "cancelled",
  version: 3,
  publishedAt: "2026-08-03T00:00:00.000Z",
  cancelledAt: "2026-08-04T00:00:00.000Z",
  cancellationReason: "Course closed",
  ruleSnapshot: {
    roundId: "40000000-0000-4000-8000-000000000001",
    groupId: "50000000-0000-4000-8000-000000000001",
    format: "individual_net",
    quotaMethod: "moving_average",
    movingAverageHistoryLength: 10,
    quotaPrecision: 1,
    quotaRoundingRule: "half_away_from_zero",
    adjustmentBands: [],
    settingsVersion: 2,
  },
  participants: [
    {
      roundId: "40000000-0000-4000-8000-000000000001",
      participantId: "60000000-0000-4000-8000-000000000001",
      groupId: "50000000-0000-4000-8000-000000000001",
      membershipId: "70000000-0000-4000-8000-000000000001",
      firstName: "Alex",
      lastName: "Golfer",
      rsvpStatus: "playing",
      version: 4,
      quotaSnapshot: "12.5",
      quotaSnapshotSource: null,
      handicapSnapshot: null,
      handicapSnapshotSource: null,
      handicapSnapshotAsOf: null,
      teeSnapshot: "middle",
    },
  ],
  counts: { playing: 1, notPlaying: 0, noResponse: 0, guests: 0 },
};

describe("coordinator round detail presentation", () => {
  it("uses explicit RSVP labels and never turns a missing snapshot into zero", () => {
    expect(formatParticipantRsvp("no_response")).toBe("No response");
    expect(formatParticipantRsvp("not_playing")).toBe("Not playing");
    expect(formatSnapshotValue(null)).toBe("Not applicable");
    expect(participantDisplayName({ firstName: "", lastName: null })).toBe(
      "Unnamed participant",
    );
  });

  it("renders read-only Overview and Players sections for cancelled rounds", () => {
    const text = collectRenderedText(RoundReadOnlyDetail({ detail }));
    expect(text).toContain("Overview");
    expect(text).toContain("Players");
    expect(text).toContain("Rule snapshot");
    expect(text).toContain("Moving average");
    expect(text).toContain("0 Guests");
    expect(text).toContain("Cancellation reason:");
    expect(text).toContain("Course closed");
    expect(text).toContain("Coordinator-only");
  });
});

function collectRenderedText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (!value || typeof value !== "object") return "";
  const candidate = value as {
    type?: unknown;
    props?: { children?: unknown };
  };
  if (typeof candidate.type === "function") {
    return collectRenderedText(
      (candidate.type as (props: unknown) => unknown)(candidate.props),
    );
  }
  const children = candidate.props?.children;
  if (Array.isArray(children))
    return children.map(collectRenderedText).join(" ");
  return collectRenderedText(children);
}
