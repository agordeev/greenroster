import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { executeReadLiveRoundScores } from "../apps/web/src/lib/rounds/live-round-score-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const roundId = "61000000-0000-4000-8000-000000000001";
const participantId = "60000000-0000-4000-8000-000000000001";

describe("live score read RPC adapter", () => {
  it("maps authoritative capabilities, score state, and role flags", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          round_id: roundId,
          group_id: "62000000-0000-4000-8000-000000000001",
          format: "individual_net",
          scheduled_at: "2026-08-03T12:00:00.000Z",
          group_time_zone: "America/New_York",
          round_version: "4",
          participant_id: participantId,
          participant_kind: "member",
          membership_id: "63000000-0000-4000-8000-000000000001",
          sponsor_membership_id: null,
          first_name: "A",
          last_name: "Player",
          rsvp_status: "playing",
          participant_version: "2",
          quota_snapshot: "12.30",
          handicap_snapshot: "8.0",
          tee_snapshot: "middle",
          enabled_final_total_fields: {
            golf_points: true,
            gross_score: true,
            net_score: false,
          },
          score_version: "1",
          score_revision_id: "64000000-0000-4000-8000-000000000001",
          gross_score: "80",
          net_score: null,
          golf_points: "20.00",
          manual_merit: null,
          plus_minus: "7.70",
          ranking_value: "7.70",
          score_changed_at: "2026-08-03T12:00:01.000Z",
          can_edit: true,
          can_author_manual_merit: false,
        },
      ],
      error: null,
    });

    await expect(
      executeReadLiveRoundScores(actorUserId, roundId),
    ).resolves.toEqual([
      expect.objectContaining({
        roundId,
        roundVersion: 4,
        enabledFields: { golfPoints: true, grossScore: true, netScore: false },
        score: expect.objectContaining({ version: 1, golfPoints: "20.00" }),
        canEdit: true,
        canAuthorManualMerit: false,
      }),
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("read_live_round_scores", {
      p_actor_user_id: actorUserId,
      p_round_id: roundId,
    });
  });

  it.each([
    ["P0003", "forbidden"],
    ["P0002", "unavailable"],
    ["P0001", "locked"],
  ] as const)("maps %s to %s", async (errorCode, code) => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: errorCode, message: "read_failed" },
    });
    await expect(
      executeReadLiveRoundScores(actorUserId, roundId),
    ).rejects.toMatchObject({ code });
  });

  it("rejects an untrusted row shape", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ participant_id: participantId }],
      error: null,
    });
    await expect(
      executeReadLiveRoundScores(actorUserId, roundId),
    ).rejects.toMatchObject({ code: "unexpected" });
  });
});
