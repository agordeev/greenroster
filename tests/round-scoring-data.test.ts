import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { executeOpenRoundScoring } from "../apps/web/src/lib/rounds/round-scoring-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const roundId = "60000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";
const operationId = "70000000-0000-4000-8000-000000000001";
const input = {
  roundId,
  expectedRoundVersion: 2,
  confirmed: true as const,
  operationId,
};

describe("round scoring RPC adapter", () => {
  it("passes the expected version and maps the Live receipt", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          round_id: roundId,
          group_id: groupId,
          state: "live",
          version: "3",
          opened_at: "2026-08-03T12:00:00.000Z",
        },
      ],
      error: null,
    });

    await expect(
      executeOpenRoundScoring(
        actorUserId,
        input,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({
      roundId,
      groupId,
      state: "live",
      version: 3,
      openedAt: "2026-08-03T12:00:00.000Z",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("open_round_scoring", {
      p_actor_user_id: actorUserId,
      p_round_id: roundId,
      p_expected_round_version: 2,
      p_confirmed: true,
      p_correlation_id: "20000000-0000-4000-8000-000000000001",
      p_operation_id: operationId,
    });
  });

  it.each([
    ["round_not_found", "unavailable", "P0002"],
    ["round_state_locked", "locked", "P0001"],
    ["round_version_changed", "stale_version", "40001"],
    ["operation_id_reused", "operation_reused", "23505"],
    ["scoring_open_confirmation_required", "validation", "22023"],
  ] as const)("maps %s to %s", async (message, code, errorCode) => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: errorCode, message },
    });
    await expect(
      executeOpenRoundScoring(
        actorUserId,
        input,
        "20000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toMatchObject({ code });
  });
});
