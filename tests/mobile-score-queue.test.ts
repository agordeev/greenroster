import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

vi.mock("../apps/mobile/src/lib/auth/secure-session-storage", () => ({
  secureSessionStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));
vi.mock("../apps/mobile/src/lib/mobile-operation-id", () => ({
  createMobileOperationId: vi.fn(() => "90000000-0000-4000-8000-000000000001"),
}));
vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { rpc: vi.fn() },
}));

import { createMobileScoreQueue } from "../apps/mobile/src/lib/rounds/mobile-score-queue";
import type { MobileScoreQueueSend } from "../apps/mobile/src/lib/rounds/mobile-score-queue";

const scope = {
  userId: "10000000-0000-4000-8000-000000000001",
  groupId: "20000000-0000-4000-8000-000000000001",
  roundId: "30000000-0000-4000-8000-000000000001",
};
const participantId = "40000000-0000-4000-8000-000000000001";
const secondParticipantId = "40000000-0000-4000-8000-000000000002";
const thirdParticipantId = "40000000-0000-4000-8000-000000000003";

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

function input(
  deviceOperationId: string,
  points: number,
  forParticipantId = participantId,
) {
  return {
    ...scope,
    participantId: forParticipantId,
    baseVersion: points === 19 ? 0 : 1,
    deviceOperationId,
    operationId: `50000000-0000-4000-8000-00000000000${points - 18}`,
    correlationId: `60000000-0000-4000-8000-00000000000${points - 18}`,
    payload: { golf_points: points },
    clientChangedAt: "2026-08-04T12:00:00.000Z",
  } as const;
}

describe("mobile score queue", () => {
  it("persists encrypted-storage operations across queue instances in FIFO order", async () => {
    const secure = storage();
    const first = createMobileScoreQueue({
      platform: "ios",
      storage: secure,
      now: () => "2026-08-04T12:00:01.000Z",
    });
    const a = await first.enqueue(
      input("70000000-0000-4000-8000-000000000001", 19),
    );
    const duplicate = await first.enqueue(
      input("70000000-0000-4000-8000-000000000001", 19),
    );
    expect(duplicate).toEqual(a);

    const restarted = createMobileScoreQueue({
      platform: "ios",
      storage: secure,
    });
    expect(await restarted.peek(scope)).toMatchObject({
      deviceOperationId: a.deviceOperationId,
      payload: { golf_points: 19 },
      reason: null,
    });
    await restarted.enqueue(input("70000000-0000-4000-8000-000000000002", 20));
    expect(
      (await restarted.list(scope)).map((item) => item.payload.golf_points),
    ).toEqual([19, 20]);
  });

  it("stops on transient failures and surfaces permanent rejections with current values", async () => {
    const secure = storage();
    const queue = createMobileScoreQueue({
      platform: "android",
      storage: secure,
    });
    await queue.enqueue({
      ...input("70000000-0000-4000-8000-000000000003", 19),
      reason: "corrected after a confirmed entry",
    });
    const transient = await queue.drain(scope, async (item) => {
      expect(item.reason).toBe("corrected after a confirmed entry");
      return {
        ok: false,
        code: "unavailable" as const,
        message: "offline",
      };
    });
    expect(transient.status).toBe("transient");
    expect((await queue.peek(scope))?.attempts).toBe(1);

    const permanent = await queue.drain(scope, async () => ({
      ok: false,
      code: "stale" as const,
      message: "changed elsewhere",
      details: {
        currentScore: {
          participantId,
          version: 2,
          revisionId: null,
          grossScore: null,
          netScore: null,
          golfPoints: "18.00",
          manualMerit: null,
          plusMinus: "5.70",
          rankingValue: "5.70",
          changedAt: "2026-08-04T12:00:01.000Z",
        },
      },
    }));
    expect(permanent.status).toBe("permanent");
    expect(await queue.peek(scope)).toMatchObject({
      status: "failed",
      failure: { code: "stale", currentScore: { version: 2 } },
    });
  });

  it("marks pending items permanently locked without purging the scoped queue", async () => {
    const secure = storage();
    const queue = createMobileScoreQueue({ platform: "ios", storage: secure });
    await queue.enqueue(input("70000000-0000-4000-8000-000000000006", 19));
    await queue.markRoundLocked(scope);
    expect(await queue.peek(scope)).toMatchObject({
      status: "failed",
      failure: {
        code: "locked",
        message: "This round is no longer accepting score changes.",
      },
    });
    expect(await queue.hasPendingUser(scope.userId)).toBe(true);
  });

  it("marks only one participant's pending items locked", async () => {
    const secure = storage();
    const queue = createMobileScoreQueue({ platform: "ios", storage: secure });
    await queue.enqueue(input("70000000-0000-4000-8000-000000000007", 19));
    await queue.enqueue(
      input("70000000-0000-4000-8000-000000000008", 20, secondParticipantId),
    );

    await queue.markParticipantPendingFailed(scope, participantId);

    const items = await queue.list(scope);
    expect(items[0]).toMatchObject({
      participantId,
      status: "failed",
      failure: { code: "locked" },
    });
    expect(items[1]).toMatchObject({
      participantId: secondParticipantId,
      status: "pending",
      failure: null,
    });
    await expect(
      queue.remove(scope, items[0]!.deviceOperationId),
    ).resolves.toBe(true);
    expect(await queue.list(scope)).toHaveLength(1);
    expect((await queue.peek(scope))?.participantId).toBe(secondParticipantId);
  });

  it("batches two locked participants without losing a third queue item", async () => {
    const secure = storage();
    const queue = createMobileScoreQueue({ platform: "ios", storage: secure });
    await queue.enqueue(input("70000000-0000-4000-8000-000000000009", 19));
    await queue.enqueue(input("70000000-0000-4000-8000-000000000012", 22));
    await queue.enqueue(
      input("70000000-0000-4000-8000-000000000010", 20, secondParticipantId),
    );
    await queue.enqueue(
      input("70000000-0000-4000-8000-000000000011", 21, thirdParticipantId),
    );

    await queue.markParticipantsPendingFailed(scope, [
      participantId,
      secondParticipantId,
    ]);

    const items = await queue.list(scope);
    expect(items[0]).toMatchObject({ participantId, status: "failed" });
    expect(items[1]).toMatchObject({ participantId, status: "failed" });
    expect(items[2]).toMatchObject({
      participantId: secondParticipantId,
      status: "failed",
    });
    expect(items[3]).toMatchObject({
      participantId: thirdParticipantId,
      status: "pending",
    });
    await expect(queue.removeParticipant(scope, participantId)).resolves.toBe(
      true,
    );
    expect(
      (await queue.list(scope)).some(
        (item) => item.participantId === participantId,
      ),
    ).toBe(false);
  });

  it("reconciles a deferred drain when the participant becomes locked", async () => {
    const secure = storage();
    const queue = createMobileScoreQueue({ platform: "ios", storage: secure });
    await queue.enqueue(input("70000000-0000-4000-8000-000000000013", 19));

    type SendResult = Awaited<ReturnType<MobileScoreQueueSend>>;
    let resolveSend: ((result: SendResult) => void) | null = null;
    let signalStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const send: MobileScoreQueueSend = () =>
      new Promise((resolve) => {
        resolveSend = resolve;
        signalStarted?.();
      });

    const draining = queue.drain(scope, send);
    await started;
    expect(queue.isDraining(scope)).toBe(true);
    const marking = queue.markParticipantPendingFailed(scope, participantId);
    resolveSend?.({
      code: "unavailable",
      message: "offline",
      ok: false,
    });

    await expect(draining).resolves.toMatchObject({ status: "transient" });
    await marking;
    expect(queue.isDraining(scope)).toBe(false);
    expect(await queue.peek(scope)).toMatchObject({
      status: "failed",
      failure: { code: "locked" },
    });
  });

  it("coordinates a deferred drain across queue instances when a participant locks", async () => {
    const secure = storage();
    const first = createMobileScoreQueue({ platform: "ios", storage: secure });
    const second = createMobileScoreQueue({
      platform: "ios",
      storage: secure,
    });
    await first.enqueue(input("70000000-0000-4000-8000-000000000015", 19));

    type SendResult = Awaited<ReturnType<MobileScoreQueueSend>>;
    let resolveSend: ((result: SendResult) => void) | null = null;
    let signalStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const send: MobileScoreQueueSend = () =>
      new Promise((resolve) => {
        resolveSend = resolve;
        signalStarted?.();
      });

    const draining = first.drain(scope, send);
    await started;
    expect(second.isDraining(scope)).toBe(true);
    let markingFinished = false;
    const marking = second
      .markParticipantPendingFailed(scope, participantId)
      .then(() => {
        markingFinished = true;
      });
    await Promise.resolve();
    expect(markingFinished).toBe(false);

    resolveSend?.({
      code: "unavailable",
      message: "offline",
      ok: false,
    });
    await expect(draining).resolves.toMatchObject({ status: "transient" });
    await marking;
    expect(first.isDraining(scope)).toBe(false);
    expect(await first.peek(scope)).toMatchObject({
      status: "failed",
      failure: { code: "locked" },
    });
  });

  it("does not resurrect a removed participant queue during a deferred drain", async () => {
    const secure = storage();
    const queue = createMobileScoreQueue({ platform: "ios", storage: secure });
    await queue.enqueue(input("70000000-0000-4000-8000-000000000014", 19));

    type SendResult = Awaited<ReturnType<MobileScoreQueueSend>>;
    let resolveSend: ((result: SendResult) => void) | null = null;
    let signalStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const send: MobileScoreQueueSend = () =>
      new Promise((resolve) => {
        resolveSend = resolve;
        signalStarted?.();
      });

    const draining = queue.drain(scope, send);
    await started;
    expect(queue.isDraining(scope)).toBe(true);
    const removal = queue.removeParticipant(scope, participantId);
    resolveSend?.({
      ok: true,
      data: {
        participantId,
        roundId: scope.roundId,
        groupId: scope.groupId,
        version: 1,
        revisionId: "80000000-0000-4000-8000-000000000001",
        grossScore: null,
        netScore: null,
        golfPoints: "19.00",
        manualMerit: null,
        plusMinus: "6.70",
        rankingValue: "6.70",
        changedAt: "2026-08-04T12:00:01.000Z",
      },
    });

    await expect(draining).resolves.toMatchObject({ status: "drained" });
    await expect(removal).resolves.toBe(false);
    expect(queue.isDraining(scope)).toBe(false);
    expect(await queue.list(scope)).toEqual([]);
  });

  it("coordinates a deferred drain across queue instances before removing a participant", async () => {
    const secure = storage();
    const first = createMobileScoreQueue({ platform: "ios", storage: secure });
    const second = createMobileScoreQueue({
      platform: "ios",
      storage: secure,
    });
    await first.enqueue(input("70000000-0000-4000-8000-000000000016", 19));

    type SendResult = Awaited<ReturnType<MobileScoreQueueSend>>;
    let resolveSend: ((result: SendResult) => void) | null = null;
    let signalStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const send: MobileScoreQueueSend = () =>
      new Promise((resolve) => {
        resolveSend = resolve;
        signalStarted?.();
      });

    const draining = first.drain(scope, send);
    await started;
    expect(second.isDraining(scope)).toBe(true);
    let removalFinished = false;
    const removal = second
      .removeParticipant(scope, participantId)
      .then((removed) => {
        removalFinished = true;
        return removed;
      });
    await Promise.resolve();
    expect(removalFinished).toBe(false);

    resolveSend?.({
      ok: true,
      data: {
        participantId,
        roundId: scope.roundId,
        groupId: scope.groupId,
        version: 1,
        revisionId: "80000000-0000-4000-8000-000000000002",
        grossScore: null,
        netScore: null,
        golfPoints: "19.00",
        manualMerit: null,
        plusMinus: "6.70",
        rankingValue: "6.70",
        changedAt: "2026-08-04T12:00:01.000Z",
      },
    });

    await expect(draining).resolves.toMatchObject({ status: "drained" });
    await expect(removal).resolves.toBe(false);
    expect(first.isDraining(scope)).toBe(false);
    expect(await second.list(scope)).toEqual([]);
  });

  it("purges every scoped queue for a user on sign-out", async () => {
    const secure = storage();
    const queue = createMobileScoreQueue({ platform: "ios", storage: secure });
    const secondScope = {
      ...scope,
      roundId: "30000000-0000-4000-8000-000000000002",
    };
    await queue.enqueue(input("70000000-0000-4000-8000-000000000004", 19));
    await queue.enqueue({
      ...input("70000000-0000-4000-8000-000000000005", 20),
      ...secondScope,
    });
    expect(await queue.hasPendingUser(scope.userId)).toBe(true);
    await queue.clearUser(scope.userId);
    expect(await queue.list(scope)).toEqual([]);
    expect(await queue.list(secondScope)).toEqual([]);
    expect(await queue.hasPendingUser(scope.userId)).toBe(false);
    expect([...secure.values.keys()]).toEqual([]);
  });

  it("never writes a score queue on web", async () => {
    const secure = storage();
    const queue = createMobileScoreQueue({ platform: "web", storage: secure });
    expect(queue.isSupported).toBe(false);
    await expect(queue.list(scope)).rejects.toThrow("native_storage_required");
    expect(secure.getItem).not.toHaveBeenCalled();
  });
});
