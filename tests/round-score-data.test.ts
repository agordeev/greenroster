import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { executeSetRoundParticipantScore } from "../apps/web/src/lib/rounds/round-score-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const participantId = "60000000-0000-4000-8000-000000000001";
const input = {
  participantId,
  changedFields: { golf_points: 20 },
  expectedScoreVersion: 0,
  deviceOperationId: "70000000-0000-4000-8000-000000000001",
  source: "mobile" as const,
  reason: null,
  clientChangedAt: "2026-08-03T12:00:00.000Z",
  operationId: "80000000-0000-4000-8000-000000000001",
};

describe("round score RPC adapter", () => {
  it("passes the server contract and maps its authoritative receipt", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          participant_id: participantId,
          round_id: "61000000-0000-4000-8000-000000000001",
          group_id: "62000000-0000-4000-8000-000000000001",
          version: "1",
          revision_id: "63000000-0000-4000-8000-000000000001",
          gross_score: null,
          net_score: null,
          golf_points: "20.00",
          manual_merit: null,
          plus_minus: "7.70",
          ranking_value: "7.70",
          changed_at: "2026-08-03T12:00:01.000Z",
        },
      ],
      error: null,
    });

    await expect(
      executeSetRoundParticipantScore(
        actorUserId,
        input,
        "64000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toMatchObject({
      version: 1,
      golfPoints: "20.00",
      plusMinus: "7.70",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("set_round_participant_score", {
      p_actor_user_id: actorUserId,
      p_participant_id: participantId,
      p_changed_fields: { golf_points: 20 },
      p_expected_score_version: 0,
      p_device_operation_id: input.deviceOperationId,
      p_source: "mobile",
      p_reason: null,
      p_client_changed_at: input.clientChangedAt,
      p_correlation_id: "64000000-0000-4000-8000-000000000001",
      p_operation_id: input.operationId,
    });
  });

  it.each([
    ["score_version_changed", "stale_version", "40001"],
    ["score_field_disabled", "validation", "22023"],
    ["round_scoring_locked", "locked", "P0001"],
    ["score_actor_not_authorized", "forbidden", "P0003"],
    ["operation_id_reused", "operation_reused", "23505"],
  ] as const)("maps %s to %s", async (message, code, errorCode) => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: errorCode, message },
    });
    await expect(
      executeSetRoundParticipantScore(
        actorUserId,
        input,
        "64000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toMatchObject({ code });
  });

  it("maps a stale RPC detail into an authorized current score", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "40001",
        message: "score_version_changed",
        details: JSON.stringify({
          participant_id: participantId,
          version: 2,
          revision_id: "63000000-0000-4000-8000-000000000001",
          gross_score: null,
          net_score: null,
          golf_points: "18.00",
          manual_merit: null,
          plus_minus: "5.70",
          ranking_value: "5.70",
          changed_at: "2026-08-03T12:00:01.000Z",
        }),
      },
    });
    await expect(
      executeSetRoundParticipantScore(
        actorUserId,
        input,
        "64000000-0000-4000-8000-000000000003",
      ),
    ).rejects.toMatchObject({
      code: "stale_version",
      details: {
        currentScore: {
          participantId,
          version: 2,
          golfPoints: "18.00",
        },
      },
    });
  });
});
