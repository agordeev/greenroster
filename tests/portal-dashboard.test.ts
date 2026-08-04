import { describe, expect, it, vi } from "vitest";

import { buildPortalDashboardSummary } from "../apps/web/src/domain/portal-dashboard";
import { executePortalDashboardData } from "../apps/web/src/lib/portal/dashboard-data";
import { MutationError } from "../apps/web/src/lib/mutations/result";

describe("portal dashboard summary", () => {
  it("counts every membership state and trusts the action-required projection", () => {
    const summary = buildPortalDashboardSummary(
      [
        { status: "pending" },
        { status: "active" },
        { status: "active" },
        { status: "inactive" },
      ],
      [
        { deliveryState: "failed_permanent", deliveryActionRequired: true },
        { deliveryState: "suppressed", deliveryActionRequired: true },
        { deliveryState: "queued", deliveryActionRequired: false },
        { deliveryState: "sent", deliveryActionRequired: false },
        { deliveryState: "sent", deliveryActionRequired: true },
        { deliveryState: null, deliveryActionRequired: false },
      ],
    );

    expect(summary).toEqual({
      membershipCounts: { pending: 1, active: 2, inactive: 1 },
      actionRequiredInvitations: {
        failedPermanent: 1,
        suppressed: 1,
        addressSuppression: 1,
        total: 3,
      },
    });
  });

  it("returns a calm zero-issue summary when all deliveries are healthy", () => {
    expect(
      buildPortalDashboardSummary(
        [],
        [
          { deliveryState: "queued", deliveryActionRequired: false },
          { deliveryState: "sent", deliveryActionRequired: false },
        ],
      ).actionRequiredInvitations,
    ).toEqual({
      failedPermanent: 0,
      suppressed: 0,
      addressSuppression: 0,
      total: 0,
    });
  });

  it("keeps provider health aggregate and privacy-safe", () => {
    expect(
      buildPortalDashboardSummary([], [], undefined, {
        health: {
          outboxQueued: 2,
          outboxProcessing: 1,
          outboxRetryable: 3,
          outboxOldestAt: "2026-08-04T10:00:00.000Z",
          emailFailedPermanent: 4,
          emailSuppressed: 1,
          pushFailedPermanent: 2,
          pushReceiptFailed: 1,
          sampledAt: "2026-08-04T12:00:00.000Z",
        },
      }),
    ).toMatchObject({
      notificationHealth: {
        queueDepth: 6,
        emailFailures: 5,
        pushFailures: 2,
        receiptFailures: 1,
        oldestQueuedAt: "2026-08-04T10:00:00.000Z",
      },
    });
  });

  it("derives the recent winner and current standings leader", () => {
    const summary = buildPortalDashboardSummary([], [], {
      completedRound: {
        roundId: "20000000-0000-4000-8000-000000000001",
        description: "July Cup",
        scheduledAt: "2026-07-31T14:00:00.000Z",
        groupTimeZone: "UTC",
      },
      officialResults: [
        {
          firstName: "Ada",
          lastName: "Lovelace",
          competitionRank: 1,
          completedAt: "2026-07-31T18:00:00.000Z",
        },
        {
          firstName: "Grace",
          lastName: "Hopper",
          competitionRank: 1,
          completedAt: "2026-07-31T18:00:00.000Z",
        },
        {
          firstName: "Alan",
          lastName: "Turing",
          competitionRank: 3,
          completedAt: "2026-07-31T18:00:00.000Z",
        },
      ],
      standings: [
        {
          membershipId: "30000000-0000-4000-8000-000000000002",
          firstName: "Grace",
          lastName: "Hopper",
          meritTotal: "12.5",
          standingRank: 2,
        },
        {
          membershipId: "30000000-0000-4000-8000-000000000001",
          firstName: "Ada",
          lastName: "Lovelace",
          meritTotal: "14.0",
          standingRank: 1,
        },
      ],
      standingsResetDate: "2026-07-01",
    });

    expect(summary.completedResult).toMatchObject({
      description: "July Cup",
      winnerNames: ["Ada Lovelace", "Grace Hopper"],
      winnerRank: 1,
      resultCount: 3,
    });
    expect(summary.standingsSummary).toMatchObject({
      memberCount: 2,
      rankedMemberCount: 2,
      standingsResetDate: "2026-07-01",
      leader: {
        name: "Ada Lovelace",
        meritTotal: "14.0",
        standingRank: 1,
      },
    });
  });

  it("aggregates Phase 06 reads with the authenticated actor identity", async () => {
    const actorUserId = "10000000-0000-4000-8000-000000000001";
    const listRounds = vi.fn().mockResolvedValue([
      {
        roundId: "20000000-0000-4000-8000-000000000001",
        groupId: "40000000-0000-4000-8000-000000000001",
        groupTimeZone: "UTC",
        description: "July Cup",
        scheduledAt: "2026-07-31T14:00:00.000Z",
        venue: null,
        roundUrl: null,
        notes: null,
        notesVisibleToPlayers: true,
        rsvpDeadlineAt: null,
        format: "individual_net",
        state: "completed",
        version: 1,
      },
    ]);
    const readOfficialResults = vi.fn().mockResolvedValue({
      round: {
        id: "20000000-0000-4000-8000-000000000001",
        group_id: "40000000-0000-4000-8000-000000000001",
        description: "July Cup",
        scheduled_at: "2026-07-31T14:00:00.000Z",
        group_time_zone: "UTC",
        format: "individual_net",
        state: "completed",
      },
      results: [
        {
          first_name: "Ada",
          last_name: "Lovelace",
          competition_rank: 1,
          completed_at: "2026-07-31T18:00:00.000Z",
        },
      ],
    });
    const readStandings = vi.fn().mockResolvedValue([
      {
        membership_id: "30000000-0000-4000-8000-000000000001",
        first_name: "Ada",
        last_name: "Lovelace",
        merit_total: "14.0",
        standing_rank: 1,
        standings_reset_date: "2026-07-01",
      },
    ]);

    const summary = await executePortalDashboardData(actorUserId, {
      listMembers: vi.fn().mockResolvedValue([]),
      listInvitations: vi.fn().mockResolvedValue([]),
      listRounds,
      readOfficialResults,
      readStandings,
    });

    expect(summary.completedResult?.winnerNames).toEqual(["Ada Lovelace"]);
    expect(summary.standingsSummary?.leader?.name).toBe("Ada Lovelace");
    expect(listRounds).toHaveBeenCalledWith(actorUserId);
    expect(readOfficialResults).toHaveBeenCalledWith(
      actorUserId,
      "20000000-0000-4000-8000-000000000001",
    );
    expect(readStandings).toHaveBeenCalledWith(actorUserId);
  });

  it("reuses both server-authoritative projections for one dashboard read", async () => {
    const listMembers = vi
      .fn()
      .mockResolvedValue([{ status: "pending" }, { status: "active" }]);
    const listInvitations = vi
      .fn()
      .mockResolvedValue([
        { deliveryState: "suppressed", deliveryActionRequired: true },
      ]);

    await expect(
      executePortalDashboardData("10000000-0000-4000-8000-000000000001", {
        listMembers,
        listInvitations,
      }),
    ).resolves.toEqual({
      membershipCounts: { pending: 1, active: 1, inactive: 0 },
      actionRequiredInvitations: {
        failedPermanent: 0,
        suppressed: 1,
        addressSuppression: 0,
        total: 1,
      },
    });
    expect(listMembers).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
    );
    expect(listInvitations).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
    );
  });

  it("does not turn a projection failure into a fabricated zero", async () => {
    const unavailable = new MutationError("unavailable");

    await expect(
      executePortalDashboardData("10000000-0000-4000-8000-000000000001", {
        listMembers: vi.fn().mockRejectedValue(unavailable),
        listInvitations: vi.fn().mockResolvedValue([]),
      }),
    ).rejects.toBe(unavailable);
  });
});
