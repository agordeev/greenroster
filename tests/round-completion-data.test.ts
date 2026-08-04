import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { executePreviewLiveRoundCompletion } from "../apps/web/src/lib/rounds/round-completion-data";

const roundId = "10000000-0000-4000-8000-000000000001";
const groupId = "20000000-0000-4000-8000-000000000001";
const participantId = "30000000-0000-4000-8000-000000000001";

describe("completion consequence preview adapter", () => {
  it("preserves server-computed names, winner ties, quota, and standings", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { round: { group_id: groupId, state: "live" } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          round_id: roundId,
          group_id: groupId,
          format: "individual_net",
          state: "live",
          snapshot_present: true,
          readiness: [],
          server_checks_passed: true,
          warning_count: 0,
          mobile_sync_check: "complete",
          completion_handshake_required: true,
          completion_allowed: false,
          consequences: {
            winner_count: 2,
            winner_is_tie: true,
            participant_count: 2,
            member_quota_impact_count: 1,
            standing_impact_count: 1,
          },
          participants: [
            {
              participant_id: participantId,
              participant_kind: "member",
              participant_name: "Ada Lovelace",
              membership_id: "40000000-0000-4000-8000-000000000001",
              sponsor_membership_id: null,
              ranking_value: "4.25",
              competition_rank: 1,
              is_winner: true,
              winner_tie_size: 2,
              golf_points: "42.50",
              gross_score: "80",
              net_score: "68",
              quota_snapshot: "12.50",
              quota_before: "12.50",
              quota_after: "15.25",
              plus_minus: "4.25",
              score_revision_id: "50000000-0000-4000-8000-000000000001",
              standing_before: 4,
              standing_after: 2,
              standing_delta: 2,
              merit: {
                participation: "2.00",
                placement: "10.00",
                generated: "12.00",
                manual: "0.00",
                total: "12.00",
              },
            },
          ],
        },
        error: null,
      });

    await expect(
      executePreviewLiveRoundCompletion(
        "60000000-0000-4000-8000-000000000001",
        {
          roundId,
          groupId,
        },
      ),
    ).resolves.toMatchObject({
      consequences: {
        winnerCount: 2,
        winnerIsTie: true,
        memberQuotaImpactCount: 1,
      },
      participants: [
        expect.objectContaining({
          participantName: "Ada Lovelace",
          isWinner: true,
          winnerTieSize: 2,
          quotaBefore: "12.50",
          quotaAfter: "15.25",
          standingBefore: 4,
          standingAfter: 2,
          standingDelta: 2,
        }),
      ],
    });
  });
});
