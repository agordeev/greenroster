import { describe, expect, it } from "vitest";

import {
  createMobileHomeProjection,
  createMobileHomeRecentResult,
  findMostRecentCompletedRound,
} from "../apps/mobile/src/lib/home/mobile-home-presentation";

const groupId = "10000000-0000-4000-8000-000000000001";
const liveId = "20000000-0000-4000-8000-000000000001";
const nextId = "20000000-0000-4000-8000-000000000002";
const completedId = "20000000-0000-4000-8000-000000000003";
const membershipId = "30000000-0000-4000-8000-000000000001";

function round(
  roundId: string,
  state: "published" | "live" | "completed",
  scheduledAt: string,
  updatedAt = scheduledAt,
) {
  return {
    roundId,
    groupId,
    description: `${state} round`,
    scheduledAt,
    groupTimeZone: "UTC",
    venue: "North Course",
    format: "individual_net" as const,
    state,
    version: 1,
    participantStatus:
      state === "live" ? ("playing" as const) : ("no_response" as const),
    participantVersion: null,
    participantCount: 4,
    playingCount: state === "live" ? 3 : 0,
    updatedAt,
  };
}

describe("mobile Home presentation", () => {
  it("prioritizes live and upcoming rounds and keeps the actor summary", () => {
    const live = round(liveId, "live", "2026-08-07T12:00:00.000Z");
    const next = round(nextId, "published", "2026-08-05T12:00:00.000Z");
    const completed = round(
      completedId,
      "completed",
      "2026-08-01T12:00:00.000Z",
      "2026-08-04T12:00:00.000Z",
    );
    const standing = {
      groupId,
      groupName: "Read Group",
      groupTimeZone: "UTC",
      standingsResetDate: null,
      membershipId,
      firstName: "Ada",
      lastName: "Lovelace",
      meritTotal: "12.50",
      roundsPlayed: 3,
      standingRank: 2,
      isActor: true,
      quotaProjectionReady: true,
      projectedQuota: "18.25",
      projectionSource: {},
      usesInitialQuotaNext: false,
      eligibleQuotaCount: 3,
    };
    const recentResult = createMobileHomeRecentResult(completed, []);

    const projection = createMobileHomeProjection({
      quotaHistory: [],
      recentResult,
      rounds: [completed, next, live],
      standings: [standing],
    });

    expect(projection.liveRounds.map((item) => item.roundId)).toEqual([liveId]);
    expect(projection.nextRound?.roundId).toBe(nextId);
    expect(projection.recentResult?.round.roundId).toBe(completedId);
    expect(projection.ownStanding?.projectedQuota).toBe("18.25");
    expect(projection.groupName).toBe("Read Group");
  });

  it("chooses the most recently published completed round and preserves ties", () => {
    const older = round(
      completedId,
      "completed",
      "2026-08-01T12:00:00.000Z",
      "2026-08-02T12:00:00.000Z",
    );
    const newer = round(
      nextId,
      "completed",
      "2026-08-03T12:00:00.000Z",
      "2026-08-04T12:00:00.000Z",
    );
    const winner = {
      roundId: nextId,
      groupId,
      completionId: "40000000-0000-4000-8000-000000000001",
      completionNumber: 1,
      completedAt: "2026-08-04T12:00:00.000Z",
      roundVersion: 1,
      participantId: "50000000-0000-4000-8000-000000000001",
      participantKind: "member" as const,
      membershipId,
      sponsorMembershipId: null,
      firstName: "Ada",
      lastName: "Lovelace",
      rsvpStatus: "playing" as const,
      scoreRevisionId: "60000000-0000-4000-8000-000000000001",
      golfPoints: "42.00",
      grossScore: null,
      netScore: null,
      quotaSnapshot: "18.00",
      plusMinus: "24.00",
      rankingValue: "24.00",
      competitionRank: 1,
      participationMerit: "1.00",
      placementMerit: "3.00",
      manualMerit: "0.00",
      generatedMerit: "4.00",
      totalMerit: "4.00",
    };
    const tie = {
      ...winner,
      participantId: "50000000-0000-4000-8000-000000000002",
      firstName: "Grace",
    };

    expect(findMostRecentCompletedRound([older, newer])?.roundId).toBe(nextId);
    const result = createMobileHomeRecentResult(newer, [winner, tie]);
    expect(result.rankingCriterion).toBe("Plus/minus");
    expect(result.winnerRows.map((item) => item.firstName)).toEqual([
      "Ada",
      "Grace",
    ]);
  });

  it("keeps a genuinely empty group distinct from a filtered or failed read", () => {
    const projection = createMobileHomeProjection({
      quotaHistory: [],
      recentResult: null,
      rounds: [],
      standings: [],
    });

    expect(projection.nextRound).toBeNull();
    expect(projection.liveRounds).toEqual([]);
    expect(projection.recentResult).toBeNull();
    expect(projection.groupName).toBeNull();
  });
});
