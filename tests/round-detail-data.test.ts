import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { executeReadCoordinatorRoundDetail } from "../apps/web/src/lib/rounds/round-detail-data";

const roundId = "40000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";
const participantId = "60000000-0000-4000-8000-000000000001";
const membershipId = "70000000-0000-4000-8000-000000000001";

const envelope = {
  round: {
    round_id: roundId,
    group_id: groupId,
    description: "August round",
    scheduled_at: "2026-08-15T13:30:00.000Z",
    group_time_zone: "America/New_York",
    venue: "North Course",
    round_url: "https://example.com/round",
    notes: "Bring a cart.",
    notes_visible_to_players: true,
    rsvp_deadline_at: "2026-08-14T13:30:00.000Z",
    format: "individual_net" as const,
    state: "published" as const,
    version: "2",
    published_at: "2026-08-03T00:00:00.000Z",
    cancelled_at: null,
    cancellation_reason: null,
  },
  rule_snapshot: {
    round_id: roundId,
    group_id: groupId,
    format: "individual_net" as const,
    quota_method: "moving_average" as const,
    moving_average_history_length: "10",
    quota_precision: 1,
    quota_rounding_rule: "half_away_from_zero" as const,
    adjustment_bands: [{ min: -2, max: 2 }],
    settings_version: "3",
  },
  participants: [
    {
      round_id: roundId,
      participant_id: participantId,
      group_id: groupId,
      membership_id: membershipId,
      first_name: "Alex",
      last_name: "Golfer",
      rsvp_status: "playing" as const,
      version: "4",
      quota_snapshot: 12.5,
      quota_snapshot_source: { source: "current" },
      handicap_snapshot: "8.25",
      handicap_snapshot_source: "manual" as const,
      handicap_snapshot_as_of: "2026-08-01",
      tee_snapshot: "middle",
    },
  ],
  counts: {
    playing_count: "1",
    not_playing_count: 0,
    no_response_count: 2,
    guest_count: 0,
  },
};

describe("coordinator round detail adapter", () => {
  it("calls the server-only RPC and normalizes numeric values", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: envelope, error: null });

    await expect(
      executeReadCoordinatorRoundDetail(
        "10000000-0000-4000-8000-000000000001",
        roundId,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        roundId,
        state: "published",
        version: 2,
        counts: { playing: 1, notPlaying: 0, noResponse: 2, guests: 0 },
        participants: [
          expect.objectContaining({
            version: 4,
            quotaSnapshot: "12.5",
            handicapSnapshot: "8.25",
          }),
        ],
      }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("read_coordinator_round_detail", {
      p_actor_user_id: "10000000-0000-4000-8000-000000000001",
      p_round_id: roundId,
    });
  });

  it("rejects an unrecognized envelope instead of exposing unvalidated data", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { ...envelope, counts: { ...envelope.counts, unexpected: 1 } },
      error: null,
    });

    await expect(
      executeReadCoordinatorRoundDetail(
        "10000000-0000-4000-8000-000000000001",
        roundId,
      ),
    ).rejects.toMatchObject({ code: "unexpected" });
  });

  it("accepts the contract's incomplete draft envelope without inventing snapshots", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ...envelope,
        round: { ...envelope.round, state: "draft", format: null },
        rule_snapshot: null,
        participants: [],
        counts: {
          playing_count: 0,
          not_playing_count: 0,
          no_response_count: 0,
          guest_count: 0,
        },
      },
      error: null,
    });

    await expect(
      executeReadCoordinatorRoundDetail(
        "10000000-0000-4000-8000-000000000001",
        roundId,
      ),
    ).resolves.toMatchObject({
      state: "draft",
      format: null,
      ruleSnapshot: null,
      participants: [],
    });
  });

  it("preserves safe permission and availability error classes", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0003", message: "actor_not_authorized" },
    });
    await expect(
      executeReadCoordinatorRoundDetail(
        "10000000-0000-4000-8000-000000000001",
        roundId,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0002", message: "round_not_found" },
    });
    await expect(
      executeReadCoordinatorRoundDetail(
        "10000000-0000-4000-8000-000000000001",
        roundId,
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
