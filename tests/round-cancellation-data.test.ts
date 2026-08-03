import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { executeCancelRound } from "../apps/web/src/lib/rounds/round-cancellation-data";

const roundId = "60000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";
const input = {
  roundId,
  reason: "Course closed for weather",
  expectedRoundVersion: 2,
  operationId: "70000000-0000-4000-8000-000000000001",
};

describe("round cancellation RPC adapter", () => {
  it("passes the expected version and maps the receipt", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          round_id: roundId,
          group_id: groupId,
          state: "cancelled",
          version: "3",
          cancelled_at: "2026-08-03T12:00:00.000Z",
          cancellation_reason: "Course closed for weather",
          participant_count: "4",
          notification_count: "4",
        },
      ],
      error: null,
    });

    await expect(
      executeCancelRound(
        "10000000-0000-4000-8000-000000000001",
        input,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({
      roundId,
      groupId,
      state: "cancelled",
      version: 3,
      cancelledAt: "2026-08-03T12:00:00.000Z",
      cancellationReason: "Course closed for weather",
      participantCount: 4,
      notificationCount: 4,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_round", {
      p_actor_user_id: "10000000-0000-4000-8000-000000000001",
      p_round_id: roundId,
      p_reason: input.reason,
      p_expected_round_version: 2,
      p_correlation_id: "20000000-0000-4000-8000-000000000001",
      p_operation_id: input.operationId,
    });
  });

  it.each([
    ["round_not_found", "unavailable"],
    ["round_state_locked", "locked"],
    ["round_version_changed", "stale_version"],
    ["round_cancellation_reason_required", "validation"],
  ])("maps %s to %s", async (message, code) => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code:
          message === "round_not_found"
            ? "P0002"
            : message === "round_state_locked"
              ? "P0001"
              : message === "round_version_changed"
                ? "40001"
                : "22023",
        message,
      },
    });
    await expect(
      executeCancelRound(
        "10000000-0000-4000-8000-000000000001",
        input,
        "20000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toMatchObject({ code });
  });
});
