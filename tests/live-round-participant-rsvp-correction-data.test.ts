import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { executeSetLiveRoundParticipantNotPlaying } from "../apps/web/src/lib/rounds/live-round-participant-rsvp-correction-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const roundId = "60000000-0000-4000-8000-000000000001";
const participantId = "80000000-0000-4000-8000-000000000001";
const input = {
  roundId,
  participantId,
  expectedParticipantVersion: 4,
  confirmed: true as const,
  reason: "Player withdrew after entering a score.",
  source: "portal" as const,
  operationId: "70000000-0000-4000-8000-000000000001",
};

describe("live participant RSVP correction RPC adapter", () => {
  it("passes the migration contract and maps the invalidation receipt", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          round_id: roundId,
          group_id: "50000000-0000-4000-8000-000000000001",
          participant_id: participantId,
          membership_id: null,
          rsvp_status: "not_playing",
          version: "5",
          score_invalidated: true,
          changed_at: "2026-08-03T12:00:00.000Z",
        },
      ],
      error: null,
    });

    await expect(
      executeSetLiveRoundParticipantNotPlaying(
        actorUserId,
        input,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({
      roundId,
      groupId: "50000000-0000-4000-8000-000000000001",
      participantId,
      membershipId: null,
      rsvpStatus: "not_playing",
      version: 5,
      scoreInvalidated: true,
      changedAt: "2026-08-03T12:00:00.000Z",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "set_live_round_participant_not_playing",
      {
        p_actor_user_id: actorUserId,
        p_round_id: roundId,
        p_participant_id: participantId,
        p_expected_participant_version: 4,
        p_confirmed: true,
        p_reason: input.reason,
        p_source: "portal",
        p_correlation_id: "20000000-0000-4000-8000-000000000001",
        p_operation_id: input.operationId,
      },
    );
  });

  it.each([
    ["actor_not_authorized", "forbidden", "P0003"],
    ["round_not_found", "unavailable", "P0002"],
    ["round_state_locked", "locked", "P0001"],
    ["participant_version_changed", "stale_version", "40001"],
    ["operation_id_reused", "operation_reused", "23505"],
    ["rsvp_change_reason_required", "validation", "22023"],
  ] as const)("maps %s to %s", async (message, code, errorCode) => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: errorCode, message },
    });
    await expect(
      executeSetLiveRoundParticipantNotPlaying(
        actorUserId,
        input,
        "20000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toMatchObject({ code });
  });
});
