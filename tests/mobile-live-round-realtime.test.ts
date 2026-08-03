import { describe, expect, it, vi } from "vitest";

import {
  applyMobileLiveRoundRealtimeEvent,
  createMobileLiveRoundRealtime,
  parseMobileLiveRoundRealtimePayload,
} from "../apps/mobile/src/lib/rounds/mobile-live-round-realtime";
import { createMobileLiveRoundState } from "../apps/mobile/src/lib/rounds/mobile-live-round-state";

const roundId = "10000000-0000-4000-8000-000000000001";
const groupId = "20000000-0000-4000-8000-000000000001";
const participantId = "30000000-0000-4000-8000-000000000001";

const participant = {
  roundId,
  groupId,
  format: "individual_net" as const,
  scheduledAt: null,
  groupTimeZone: "America/New_York",
  roundVersion: 4,
  participantId,
  participantKind: "member" as const,
  membershipId: "40000000-0000-4000-8000-000000000001",
  sponsorMembershipId: null,
  firstName: "A",
  lastName: "Player",
  rsvpStatus: "playing" as const,
  participantVersion: 1,
  quotaSnapshot: "12.30",
  handicapSnapshot: null,
  teeSnapshot: null,
  enabledFields: {
    golfPoints: true as const,
    grossScore: false,
    netScore: false,
  },
  score: {
    participantId,
    version: 0,
    revisionId: null,
    grossScore: null,
    netScore: null,
    golfPoints: null,
    manualMerit: null,
    plusMinus: null,
    rankingValue: null,
    changedAt: null,
  },
  canEdit: true,
  canAuthorManualMerit: false,
};

function event(version: number, points: string) {
  return {
    participantId,
    groupId,
    roundId,
    score: {
      ...participant.score,
      version,
      golfPoints: points,
      changedAt: "2026-08-04T12:00:01.000Z",
    },
  };
}

function payload(version: number, points: string) {
  return {
    new: {
      participant_id: participantId,
      group_id: groupId,
      round_id: roundId,
      gross_score: null,
      net_score: null,
      golf_points: points,
      manual_merit: null,
      plus_minus: "6.70",
      ranking_value: "6.70",
      version,
      last_revision_id: "50000000-0000-4000-8000-000000000001",
      created_at: "2026-08-04T12:00:00.000Z",
      updated_at: "2026-08-04T12:00:01.000Z",
    },
  };
}

describe("mobile live round realtime", () => {
  it("applies the next version, ignores duplicates, and flags gaps for refetch", () => {
    const initial = createMobileLiveRoundState({ participants: [participant] });
    const applied = applyMobileLiveRoundRealtimeEvent(
      initial,
      event(1, "19.00"),
    );
    expect(applied.status).toBe("applied");
    expect(applied.state.participants[0]?.confirmed.version).toBe(1);

    const duplicate = applyMobileLiveRoundRealtimeEvent(
      applied.state,
      event(1, "19.00"),
    );
    expect(duplicate.status).toBe("duplicate");
    const gap = applyMobileLiveRoundRealtimeEvent(
      applied.state,
      event(3, "21.00"),
    );
    expect(gap).toMatchObject({
      status: "gap",
      needsRefetch: true,
      state: { stale: true },
    });
  });

  it("strictly parses projection payloads and refetches after reconnect", async () => {
    expect(
      parseMobileLiveRoundRealtimePayload(payload(1, "19.00")),
    ).toMatchObject({
      participantId,
      score: { version: 1, golfPoints: "19.00" },
    });
    expect(
      parseMobileLiveRoundRealtimePayload({
        ...payload(1, "19.00"),
        new: { ...payload(1, "19.00").new, extra: true },
      }),
    ).toBeNull();

    let onStatus: ((status: string) => void) | undefined;
    const subscribe = vi.fn((callback?: (status: string) => void) => {
      onStatus = callback;
    });
    const on = vi.fn();
    const channel = { on, subscribe, unsubscribe: vi.fn() };
    on.mockReturnValue(channel);
    const client = { channel: vi.fn().mockReturnValue(channel) };
    const refetch = vi.fn().mockResolvedValue({ participants: [participant] });
    const realtime = createMobileLiveRoundRealtime({
      client,
      groupId,
      roundId,
      refetch,
    });
    await realtime.start();
    expect(refetch).toHaveBeenCalled();
    onStatus?.("CHANNEL_ERROR");
    expect(realtime.getView().status).toBe("reconnecting");
    await realtime.reconnect();
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
