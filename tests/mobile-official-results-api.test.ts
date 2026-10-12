import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { rpc: vi.fn() },
}));

import { createMobileOfficialResultsApi } from "../apps/mobile/src/lib/rounds/mobile-official-results-api";

const roundId = "10000000-0000-4000-8000-000000000001";
const groupId = "20000000-0000-4000-8000-000000000001";
const completionId = "30000000-0000-4000-8000-000000000001";
const participantId = "40000000-0000-4000-8000-000000000001";
const membershipId = "50000000-0000-4000-8000-000000000001";
const scoreRevisionId = "60000000-0000-4000-8000-000000000001";

const row = {
  round_id: roundId,
  group_id: groupId,
  completion_id: completionId,
  completion_number: "2",
  completed_at: "2026-08-04T12:00:00.000Z",
  round_version: "7",
  participant_id: participantId,
  participant_kind: "member",
  membership_id: membershipId,
  sponsor_membership_id: null,
  first_name: "Ada",
  last_name: "Lovelace",
  rsvp_status: "playing",
  rsvp_changed_at: "2026-08-01T10:00:00.000Z",
  score_revision_id: scoreRevisionId,
  golf_points: "42.50",
  gross_score: "80",
  net_score: "68",
  quota_snapshot: "12.50",
  plus_minus: "30.00",
  ranking_value: "30.00",
  competition_rank: "1",
  participation_merit: "2.00",
  placement_merit: "10.00",
  manual_merit: "1.00",
  generated_merit: "12.00",
  total_merit: "13.00",
};

describe("mobile official results API", () => {
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpc = vi.fn();
  });

  it("reads through the actor-derived RPC and preserves official decimal values", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    const api = createMobileOfficialResultsApi({ rpc });

    await expect(api.read(roundId)).resolves.toEqual({
      data: [
        {
          roundId,
          groupId,
          completionId,
          completionNumber: 2,
          completedAt: "2026-08-04T12:00:00.000Z",
          roundVersion: 7,
          participantId,
          participantKind: "member",
          membershipId,
          sponsorMembershipId: null,
          firstName: "Ada",
          lastName: "Lovelace",
          rsvpStatus: "playing",
          rsvpChangedAt: "2026-08-01T10:00:00.000Z",
          scoreRevisionId,
          golfPoints: "42.50",
          grossScore: "80",
          netScore: "68",
          quotaSnapshot: "12.50",
          plusMinus: "30.00",
          rankingValue: "30.00",
          competitionRank: 1,
          participationMerit: "2.00",
          placementMerit: "10.00",
          manualMerit: "1.00",
          generatedMerit: "12.00",
          totalMerit: "13.00",
        },
      ],
      ok: true,
    });
    expect(rpc).toHaveBeenCalledWith("read_mobile_official_round_results", {
      p_round_id: roundId,
    });
  });

  it("accepts guest rows with nullable member fields and rejects malformed input or rows", async () => {
    const api = createMobileOfficialResultsApi({ rpc });
    await expect(api.read("not-a-uuid")).resolves.toMatchObject({
      code: "validation",
      ok: false,
    });
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({
      data: [
        {
          ...row,
          participant_kind: "guest",
          membership_id: null,
          sponsor_membership_id: membershipId,
          first_name: "Guest",
          last_name: "Golfer",
          rsvp_status: "playing",
          quota_snapshot: null,
          net_score: null,
        },
      ],
      error: null,
    });
    await expect(api.read(roundId)).resolves.toMatchObject({
      ok: true,
      data: [
        expect.objectContaining({
          participantKind: "guest",
          membershipId: null,
          sponsorMembershipId: membershipId,
          quotaSnapshot: null,
          netScore: null,
        }),
      ],
    });

    rpc.mockResolvedValue({
      data: [{ ...row, unexpected: true }],
      error: null,
    });
    await expect(api.read(roundId)).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });

  it("maps lifecycle denial and transport failures without exposing server details", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0002", message: "round_results_not_available" },
    });
    rpc.mockRejectedValueOnce(new Error("offline"));
    const api = createMobileOfficialResultsApi({ rpc });

    await expect(api.read(roundId)).resolves.toEqual({
      code: "permission_denied",
      message: "This result is no longer available to you.",
      ok: false,
    });
    await expect(api.read(roundId)).resolves.toMatchObject({
      code: "unavailable",
      ok: false,
    });
  });
});
