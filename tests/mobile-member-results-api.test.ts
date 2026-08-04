import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { rpc: vi.fn() },
}));

import {
  createMobileMemberQuotaHistoryApi,
  createMobileMemberStandingsApi,
} from "../apps/mobile/src/lib/rounds/mobile-member-results-api";

const groupId = "a0000000-0000-4000-8000-000000000001";
const membershipId = "b0000000-0000-4000-8000-000000000001";
const historyId = "c0000000-0000-4000-8000-000000000001";
const completionId = "d0000000-0000-4000-8000-000000000001";
const roundId = "e0000000-0000-4000-8000-000000000001";

const standingsRow = {
  group_id: groupId,
  group_name: "Read Group",
  group_time_zone: "UTC",
  standings_reset_date: "2026-08-01",
  membership_id: membershipId,
  first_name: "Ada",
  last_name: "Lovelace",
  merit_total: "12.50",
  rounds_played: "3",
  standing_rank: "1",
  is_actor: true,
  quota_projection_ready: true,
  projected_quota: "18.25",
  projection_source: { method: "moving_average", historyIds: [historyId] },
  uses_initial_quota_next: false,
  eligible_quota_count: "3",
};

const historyRow = {
  group_id: groupId,
  group_name: "Read Group",
  group_time_zone: "UTC",
  standings_reset_date: "2026-08-01",
  membership_id: membershipId,
  history_id: historyId,
  completion_id: completionId,
  round_id: roundId,
  completed_at: "2026-08-04T12:00:00.000Z",
  round_description: "August opener",
  format: "individual_net",
  point_total: "42.50",
  plus_minus: "3.25",
  quota_before: null,
  quota_after: "18.25",
  method: "moving_average",
  source: { roundId },
  counts_in_standings: true,
};

describe("mobile member standings and history APIs", () => {
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpc = vi.fn();
  });

  it("reads actor-derived standings without accepting identity or group input", async () => {
    rpc.mockResolvedValue({ data: [standingsRow], error: null });
    const api = createMobileMemberStandingsApi({ rpc });

    await expect(api.read()).resolves.toEqual({
      ok: true,
      data: [
        expect.objectContaining({
          groupId,
          membershipId,
          meritTotal: "12.50",
          roundsPlayed: 3,
          standingRank: 1,
          isActor: true,
          projectedQuota: "18.25",
        }),
      ],
    });
    expect(rpc).toHaveBeenCalledWith("read_mobile_member_standings");
    expect(rpc.mock.calls[0]).toHaveLength(1);
  });

  it("reads personal quota history and preserves source and nullable values", async () => {
    rpc.mockResolvedValue({ data: [historyRow], error: null });
    const api = createMobileMemberQuotaHistoryApi({ rpc });

    await expect(api.read()).resolves.toEqual({
      ok: true,
      data: [
        expect.objectContaining({
          historyId,
          completionId,
          roundId,
          pointTotal: "42.50",
          plusMinus: "3.25",
          quotaBefore: null,
          quotaAfter: "18.25",
          source: { roundId },
        }),
      ],
    });
    expect(rpc).toHaveBeenCalledWith("read_mobile_member_quota_history");
    expect(rpc.mock.calls[0]).toHaveLength(1);
  });

  it("rejects unknown fields and malformed rows through strict adapters", async () => {
    rpc.mockResolvedValue({
      data: [{ ...standingsRow, unexpected: true }],
      error: null,
    });
    const standingsApi = createMobileMemberStandingsApi({ rpc });
    await expect(standingsApi.read()).resolves.toMatchObject({
      ok: false,
      code: "unavailable",
    });

    rpc.mockResolvedValue({
      data: [{ ...historyRow, point_total: null }],
      error: null,
    });
    const historyApi = createMobileMemberQuotaHistoryApi({ rpc });
    await expect(historyApi.read()).resolves.toMatchObject({
      ok: false,
      code: "unavailable",
    });
  });

  it("maps authorization, validation, and transport failures to safe messages", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0002", message: "member_standings_not_available" },
    });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "invalid" },
    });
    rpc.mockRejectedValueOnce(new Error("offline"));
    const standingsApi = createMobileMemberStandingsApi({ rpc });
    const historyApi = createMobileMemberQuotaHistoryApi({ rpc });

    await expect(standingsApi.read()).resolves.toMatchObject({
      ok: false,
      code: "permission_denied",
    });
    await expect(historyApi.read()).resolves.toMatchObject({
      ok: false,
      code: "validation",
    });
    await expect(standingsApi.read()).resolves.toMatchObject({
      ok: false,
      code: "unavailable",
    });
  });
});
