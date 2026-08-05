import { describe, expect, it, vi } from "vitest";

vi.mock("../apps/mobile/src/lib/auth/secure-session-storage", () => ({
  secureSessionStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

import {
  createMobileLiveRoundSnapshotStorage,
  mobileLiveRoundSnapshotStorageKey,
} from "../apps/mobile/src/lib/rounds/mobile-live-round-snapshot-storage";

const scope = {
  userId: "10000000-0000-4000-8000-000000000001",
  groupId: "20000000-0000-4000-8000-000000000001",
  roundId: "30000000-0000-4000-8000-000000000001",
};

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

function participant() {
  return {
    groupId: scope.groupId,
    roundId: scope.roundId,
    format: "individual_net" as const,
    scheduledAt: "2026-08-04T12:00:00.000Z",
    groupTimeZone: "America/New_York",
    roundVersion: 4,
    participantId: "40000000-0000-4000-8000-000000000001",
    participantKind: "member" as const,
    membershipId: "50000000-0000-4000-8000-000000000001",
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
      participantId: "40000000-0000-4000-8000-000000000001",
      version: 1,
      revisionId: "60000000-0000-4000-8000-000000000001",
      grossScore: null,
      netScore: null,
      golfPoints: "18.00",
      manualMerit: null,
      plusMinus: "5.70",
      rankingValue: "5.70",
      changedAt: "2026-08-04T12:00:01.000Z",
    },
    canEdit: true,
    canAuthorManualMerit: false,
  };
}

function round(roundId = scope.roundId) {
  return {
    roundId,
    groupId: scope.groupId,
    description: "August round",
    scheduledAt: "2026-08-04T12:00:00.000Z",
    groupTimeZone: "America/New_York",
    venue: "Green Valley",
    format: "individual_net" as const,
    state: "live" as const,
    version: 4,
    participantStatus: "playing" as const,
    participantVersion: 2,
    participantCount: 1,
    playingCount: 1,
    updatedAt: "2026-08-04T12:00:01.000Z",
  };
}

describe("mobile live-round snapshot storage", () => {
  it("restores a strict authorized snapshot and purges all rounds for a user", async () => {
    const secure = storage();
    const snapshots = createMobileLiveRoundSnapshotStorage({
      storage: secure,
      now: () => "2026-08-04T12:00:02.000Z",
    });
    const secondScope = {
      ...scope,
      roundId: "30000000-0000-4000-8000-000000000002",
    };

    await snapshots.save(scope, [participant()], round());
    await snapshots.save(
      secondScope,
      [{ ...participant(), roundId: secondScope.roundId }],
      round(secondScope.roundId),
    );

    await expect(snapshots.load(scope)).resolves.toEqual({
      savedAt: "2026-08-04T12:00:02.000Z",
      round: round(),
      participants: [participant()],
    });
    await expect(
      snapshots.load({
        ...scope,
        userId: "10000000-0000-4000-8000-000000000002",
      }),
    ).resolves.toBeNull();
    await expect(snapshots.listUser(scope.userId)).resolves.toEqual([
      { scope, round: round(), savedAt: "2026-08-04T12:00:02.000Z" },
      {
        scope: secondScope,
        round: round(secondScope.roundId),
        savedAt: "2026-08-04T12:00:02.000Z",
      },
    ]);

    await snapshots.clearUser(scope.userId);
    await expect(snapshots.load(scope)).resolves.toBeNull();
    await expect(snapshots.load(secondScope)).resolves.toBeNull();
    expect([...secure.values.keys()]).toEqual([]);
  });

  it("rejects a participant that is outside the snapshot scope", async () => {
    const snapshots = createMobileLiveRoundSnapshotStorage({
      storage: storage(),
    });
    await expect(
      snapshots.save(
        scope,
        [{ ...participant(), roundId: secondRoundId }],
        round(),
      ),
    ).rejects.toThrow("scope_mismatch");
  });

  it("rejects a participant from a different group", async () => {
    const snapshots = createMobileLiveRoundSnapshotStorage({
      storage: storage(),
    });

    await expect(
      snapshots.save(
        scope,
        [
          {
            ...participant(),
            groupId: "20000000-0000-4000-8000-000000000002",
          },
        ],
        round(),
      ),
    ).rejects.toThrow("mobile_live_round_snapshot:scope_mismatch");
  });

  it("rejects a cached snapshot tampered with a foreign top-level group", async () => {
    const secure = storage();
    const snapshots = createMobileLiveRoundSnapshotStorage({
      storage: secure,
    });

    await snapshots.save(scope, [participant()], round());

    const key = mobileLiveRoundSnapshotStorageKey(scope);
    const cached = JSON.parse(secure.values.get(key) ?? "") as {
      groupId: string;
    };
    cached.groupId = "20000000-0000-4000-8000-000000000002";
    secure.values.set(key, JSON.stringify(cached));

    await expect(snapshots.load(scope)).resolves.toBeNull();
  });
});

const secondRoundId = "30000000-0000-4000-8000-000000000002";
