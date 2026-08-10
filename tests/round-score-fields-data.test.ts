import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { executeSetRoundScoreFields } from "../apps/web/src/lib/rounds/round-score-fields-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const input = {
  roundId: "60000000-0000-4000-8000-000000000001",
  enableGrossScore: true,
  enableNetScore: true,
  expectedRoundVersion: 2,
  operationId: "70000000-0000-4000-8000-000000000001",
};

describe("round score-field RPC adapter", () => {
  it("sends capability values and maps the authoritative receipt", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          round_id: input.roundId,
          group_id: "50000000-0000-4000-8000-000000000001",
          format: "individual_net",
          enable_gross_score: true,
          enable_net_score: true,
          version: "3",
        },
      ],
      error: null,
    });

    await expect(
      executeSetRoundScoreFields(
        actorUserId,
        input,
        "80000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({
      roundId: input.roundId,
      groupId: "50000000-0000-4000-8000-000000000001",
      format: "individual_net",
      enableGrossScore: true,
      enableNetScore: true,
      version: 3,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("set_round_draft_score_fields", {
      p_actor_user_id: actorUserId,
      p_round_id: input.roundId,
      p_enable_gross_score: true,
      p_enable_net_score: true,
      p_expected_round_version: 2,
      p_correlation_id: "80000000-0000-4000-8000-000000000001",
      p_operation_id: input.operationId,
    });
  });

  it.each([
    ["round_version_changed", "stale_version", "40001"],
    ["score_field_capability_invalid", "validation", "22023"],
    ["round_state_locked", "locked", "P0001"],
    ["operation_id_reused", "operation_reused", "23505"],
  ] as const)("maps %s to %s", async (message, code, errorCode) => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: errorCode, message },
    });
    await expect(
      executeSetRoundScoreFields(
        actorUserId,
        input,
        "80000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toMatchObject({ code });
  });
});
