import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { rpc: vi.fn() },
}));

import { createMobileHomeApi } from "../apps/mobile/src/lib/home/mobile-home-api";

const groupId = "10000000-0000-4000-8000-000000000001";
const roundId = "20000000-0000-4000-8000-000000000001";
const membershipId = "30000000-0000-4000-8000-000000000001";

const completedRound = {
  roundId,
  groupId,
  description: "August opener",
  scheduledAt: "2026-08-01T12:00:00.000Z",
  groupTimeZone: "UTC",
  venue: "North Course",
  format: "individual_net" as const,
  state: "completed" as const,
  version: 2,
  participantStatus: "playing" as const,
  participantVersion: 1,
  participantCount: 2,
  playingCount: 2,
  updatedAt: "2026-08-04T12:00:00.000Z",
};

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
  standingRank: 1,
  isActor: true,
  quotaProjectionReady: true,
  projectedQuota: "18.25",
  projectionSource: {},
  usesInitialQuotaNext: false,
  eligibleQuotaCount: 3,
};

describe("mobile Home API composition", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reads the actor-derived sources and then exact official results", async () => {
    const rounds = {
      list: vi.fn().mockResolvedValue({ ok: true, data: [completedRound] }),
    };
    const standings = {
      read: vi.fn().mockResolvedValue({ ok: true, data: [standing] }),
    };
    const quotaHistory = {
      read: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    };
    const officialResults = {
      read: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    };
    const api = createMobileHomeApi({
      rounds,
      standings,
      quotaHistory,
      officialResults,
    });

    await expect(api.read()).resolves.toMatchObject({
      ok: true,
      data: {
        groupName: "Read Group",
        recentResult: { round: { roundId } },
        ownStanding: { projectedQuota: "18.25" },
      },
    });
    expect(rounds.list).toHaveBeenCalledWith({ completedLimit: 5 });
    expect(officialResults.read).toHaveBeenCalledWith(roundId);
  });

  it("returns permission denial without reading another protected resource", async () => {
    const rounds = {
      list: vi.fn().mockResolvedValue({
        code: "permission_denied",
        message: "not available",
        ok: false,
      }),
    };
    const standings = {
      read: vi.fn().mockResolvedValue({ ok: true, data: [standing] }),
    };
    const quotaHistory = {
      read: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    };
    const officialResults = { read: vi.fn() };
    const api = createMobileHomeApi({
      rounds,
      standings,
      quotaHistory,
      officialResults,
    });

    await expect(api.read()).resolves.toEqual({
      code: "permission_denied",
      message: "not available",
      ok: false,
    });
    expect(officialResults.read).not.toHaveBeenCalled();
  });

  it("does not ask for official results when there is no completed history", async () => {
    const rounds = { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) };
    const standings = {
      read: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    };
    const quotaHistory = {
      read: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    };
    const officialResults = { read: vi.fn() };
    const api = createMobileHomeApi({
      rounds,
      standings,
      quotaHistory,
      officialResults,
    });

    await expect(api.read()).resolves.toMatchObject({
      ok: true,
      data: { recentResult: null, groupName: null },
    });
    expect(officialResults.read).not.toHaveBeenCalled();
  });
});
