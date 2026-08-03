import { describe, expect, it } from "vitest";

import { applyMobileLiveRoundRealtimeEvent } from "../apps/mobile/src/lib/rounds/mobile-live-round-realtime";
import {
  applyMobileLiveRoundRealtimeScore,
  applyMobileLiveRoundScoreReceipt,
  clearMobileLiveRoundPending,
  createMobileLiveRoundState,
  markMobileLiveRoundFailed,
  markMobileLiveRoundPending,
  markMobileLiveRoundSyncing,
  mobileLiveRoundOrderIsDeferred,
  mobileLiveRoundVisibleOrder,
  replaceMobileLiveRoundSnapshot,
  sortMobileLiveRoundParticipants,
} from "../apps/mobile/src/lib/rounds/mobile-live-round-state";

const participantId = "30000000-0000-4000-8000-000000000001";
const secondParticipantId = "30000000-0000-4000-8000-000000000002";
const roundId = "10000000-0000-4000-8000-000000000001";
const groupId = "20000000-0000-4000-8000-000000000001";

function participant() {
  return {
    roundId,
    groupId,
    format: "individual_net" as const,
    scheduledAt: "2026-08-04T12:00:00.000Z",
    groupTimeZone: "America/New_York",
    roundVersion: 4,
    participantId,
    participantKind: "member" as const,
    membershipId: "60000000-0000-4000-8000-000000000001",
    sponsorMembershipId: null,
    firstName: "A",
    lastName: "Player",
    rsvpStatus: "playing" as const,
    participantVersion: 2,
    quotaSnapshot: "12.30",
    handicapSnapshot: null,
    teeSnapshot: "middle" as const,
    enabledFields: {
      golfPoints: true as const,
      grossScore: true,
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
}

describe("mobile live round state", () => {
  it("keeps confirmed values separate from pending and syncing labels", () => {
    let state = createMobileLiveRoundState({ participants: [participant()] });
    const pending = {
      participantId,
      baseVersion: 0,
      changedFields: { golf_points: 19 },
      deviceOperationId: "40000000-0000-4000-8000-000000000001",
      operationId: "40000000-0000-4000-8000-000000000002",
      correlationId: "40000000-0000-4000-8000-000000000003",
      clientChangedAt: "2026-08-04T12:00:00.000Z",
      queuedAt: "2026-08-04T12:00:00.000Z",
    };
    state = markMobileLiveRoundPending(state, pending);
    expect(state.participants[0]).toMatchObject({
      syncState: "Pending sync",
      pending,
      confirmed: { golfPoints: null, version: 0 },
    });
    state = markMobileLiveRoundSyncing(state, participantId);
    expect(state.participants[0]?.syncState).toBe("Syncing");
  });

  it("locks pending metadata when an authoritative snapshot removes edit access", () => {
    const second = {
      ...participant(),
      participantId: secondParticipantId,
      firstName: "B",
      score: { ...participant().score, participantId: secondParticipantId },
    };
    const firstPending = {
      participantId,
      baseVersion: 0,
      changedFields: { golf_points: 19 },
      deviceOperationId: "40000000-0000-4000-8000-000000000001",
      operationId: "40000000-0000-4000-8000-000000000002",
      correlationId: "40000000-0000-4000-8000-000000000003",
      clientChangedAt: "2026-08-04T12:00:00.000Z",
      queuedAt: "2026-08-04T12:00:00.000Z",
    };
    const secondPending = {
      ...firstPending,
      participantId: secondParticipantId,
      deviceOperationId: "40000000-0000-4000-8000-000000000004",
    };
    let state = createMobileLiveRoundState({
      participants: [participant(), second],
    });
    state = markMobileLiveRoundPending(state, firstPending);
    state = markMobileLiveRoundPending(state, secondPending);

    const lockedFirst = {
      ...participant(),
      rsvpStatus: "not_playing" as const,
      canEdit: false,
    };
    const replaced = replaceMobileLiveRoundSnapshot(state, {
      participants: [lockedFirst, second],
      syncedAt: "2026-08-04T12:00:01.000Z",
    });
    expect(replaced.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participant: expect.objectContaining({ participantId }),
          syncState: "Locked",
          pending: firstPending,
          failure: expect.objectContaining({ code: "locked", permanent: true }),
        }),
        expect.objectContaining({
          participant: expect.objectContaining({
            participantId: secondParticipantId,
          }),
          syncState: "Pending sync",
          pending: secondPending,
        }),
      ]),
    );

    const discarded = clearMobileLiveRoundPending(
      replaced,
      participantId,
      firstPending.deviceOperationId,
    );
    expect(discarded.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participant: expect.objectContaining({ participantId }),
          syncState: "Locked",
          pending: null,
          failure: null,
        }),
      ]),
    );
  });

  it("shows stale current values on permanent rejection and clears on receipt", () => {
    let state = createMobileLiveRoundState({ participants: [participant()] });
    state = markMobileLiveRoundFailed(state, participantId, {
      code: "stale",
      message: "changed elsewhere",
      currentScore: {
        ...participant().score,
        version: 1,
        golfPoints: "18.00",
      },
      permanent: true,
    });
    expect(state.participants[0]).toMatchObject({
      syncState: "Failed",
      staleCurrentValue: { version: 1, golfPoints: "18.00" },
    });
    state = applyMobileLiveRoundScoreReceipt(state, {
      participantId,
      roundId,
      groupId,
      version: 2,
      revisionId: "50000000-0000-4000-8000-000000000001",
      grossScore: null,
      netScore: null,
      golfPoints: "19.00",
      manualMerit: null,
      plusMinus: "6.70",
      rankingValue: "6.70",
      changedAt: "2026-08-04T12:00:02.000Z",
    });
    expect(state.participants[0]).toMatchObject({
      syncState: "Confirmed",
      pending: null,
      failure: null,
      confirmed: { version: 2, golfPoints: "19.00" },
    });
  });

  it("applies the next realtime version without changing local sync metadata", () => {
    const state = createMobileLiveRoundState({ participants: [participant()] });
    const result = applyMobileLiveRoundRealtimeScore(state, {
      ...participant().score,
      version: 2,
      golfPoints: "18.00",
    });
    expect(result.stale).toBe(false);
    expect(result.participants[0]).toMatchObject({
      syncState: "Confirmed",
      confirmed: { version: 2, golfPoints: "18.00" },
    });
  });

  it("reorders participants after an authoritative ranking change", () => {
    const first = {
      ...participant(),
      score: {
        ...participant().score,
        version: 1,
        rankingValue: "10.00",
        golfPoints: "20.00",
      },
    };
    const second = {
      ...participant(),
      participantId: secondParticipantId,
      firstName: "B",
      score: {
        ...participant().score,
        participantId: secondParticipantId,
        version: 1,
        rankingValue: "5.00",
        golfPoints: "15.00",
      },
    };
    const state = createMobileLiveRoundState({
      participants: [first, second],
    });
    expect(
      state.participants.map((entry) => entry.participant.participantId),
    ).toEqual([participantId, secondParticipantId]);

    const changed = applyMobileLiveRoundRealtimeEvent(state, {
      roundId,
      groupId,
      participantId,
      score: {
        ...first.score,
        version: 2,
        rankingValue: "1.00",
        golfPoints: "11.00",
      },
    });
    expect(
      changed.state.participants.map(
        (entry) => entry.participant.participantId,
      ),
    ).toEqual([secondParticipantId, participantId]);
  });

  it("uses deterministic name and id fallbacks for ties and null rankings", () => {
    const alpha = {
      ...participant(),
      participantId: secondParticipantId,
      lastName: "Alpha",
      firstName: "A",
      score: {
        ...participant().score,
        participantId: secondParticipantId,
        rankingValue: "5.00",
      },
    };
    const alphaSameName = {
      ...alpha,
      participantId: "30000000-0000-4000-8000-000000000003",
      score: {
        ...alpha.score,
        participantId: "30000000-0000-4000-8000-000000000003",
      },
    };
    const zulu = {
      ...participant(),
      lastName: "Zulu",
      firstName: "Z",
      score: { ...participant().score, rankingValue: "5.00" },
    };
    const missing = {
      ...participant(),
      participantId: "30000000-0000-4000-8000-000000000004",
      lastName: "Aardvark",
      score: {
        ...participant().score,
        participantId: "30000000-0000-4000-8000-000000000004",
        rankingValue: null,
      },
    };
    const state = createMobileLiveRoundState({
      participants: [missing, zulu, alphaSameName, alpha],
    });
    expect(
      sortMobileLiveRoundParticipants(state.participants).map(
        (entry) => entry.participant.participantId,
      ),
    ).toEqual([
      secondParticipantId,
      "30000000-0000-4000-8000-000000000003",
      participantId,
      "30000000-0000-4000-8000-000000000004",
    ]);
  });

  it("keeps an accessibility-deferred order across blur until explicit review", () => {
    const serverOrder = ["a", "b", "c"];
    const deferredOrder = ["b", "a", "c"];
    const whileFocused = mobileLiveRoundVisibleOrder(
      serverOrder,
      deferredOrder,
    );
    expect(whileFocused).toEqual(deferredOrder);
    expect(
      mobileLiveRoundOrderIsDeferred(serverOrder, whileFocused, deferredOrder),
    ).toBe(true);

    // Row blur does not clear deferredOrder; only Review updated standings
    // clears it and applies the latest authoritative order.
    const afterReview = mobileLiveRoundVisibleOrder(serverOrder, null);
    expect(afterReview).toEqual(serverOrder);
    expect(mobileLiveRoundOrderIsDeferred(serverOrder, afterReview, null)).toBe(
      false,
    );
  });
});
