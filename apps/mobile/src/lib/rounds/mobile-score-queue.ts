import { z } from "zod";

import { secureSessionStorage } from "../auth/secure-session-storage";
import { createMobileOperationId } from "../mobile-operation-id";
import {
  mobileScoreChangedFieldsSchema,
  type MobileLiveRoundResult,
  type MobileLiveRoundScoreReceipt,
  type MobileScoreChangedFields,
} from "./mobile-live-round-api";

const uuidSchema = z.uuid();
const instantSchema = z.string().datetime({ offset: true });
const queuedCurrentScoreSchema = z
  .object({
    participantId: uuidSchema,
    version: z.number().int().nonnegative(),
    revisionId: uuidSchema.nullable(),
    grossScore: z.string().nullable(),
    netScore: z.string().nullable(),
    golfPoints: z.string().nullable(),
    manualMerit: z.string().nullable(),
    plusMinus: z.string().nullable(),
    rankingValue: z.string().nullable(),
    changedAt: instantSchema.nullable(),
  })
  .strict();

const queueItemSchema = z
  .object({
    userId: uuidSchema,
    groupId: uuidSchema,
    roundId: uuidSchema,
    participantId: uuidSchema,
    baseVersion: z.number().int().nonnegative(),
    deviceOperationId: uuidSchema,
    operationId: uuidSchema,
    correlationId: uuidSchema,
    payload: mobileScoreChangedFieldsSchema,
    reason: z.string().trim().max(500).nullable(),
    clientChangedAt: instantSchema,
    queuedAt: instantSchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
    attempts: z.number().int().nonnegative(),
    status: z.enum(["pending", "failed"]),
    failure: z
      .object({
        code: z.enum([
          "permission_denied",
          "stale",
          "locked",
          "validation",
          "unavailable",
        ]),
        message: z.string().min(1),
        currentScore: queuedCurrentScoreSchema.optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();

const scopeSchema = z
  .object({ userId: uuidSchema, groupId: uuidSchema, roundId: uuidSchema })
  .strict();

export type MobileScoreQueueScope = z.infer<typeof scopeSchema>;
export type MobileScoreQueueItem = z.infer<typeof queueItemSchema>;

export const mobileScoreQueueItemSchema = queueItemSchema;
export const mobileScoreQueueScopeSchema = scopeSchema;

export type MobileScoreQueueInput = Readonly<
  MobileScoreQueueScope & {
    participantId: string;
    baseVersion: number;
    deviceOperationId?: string;
    operationId?: string;
    correlationId?: string;
    payload: MobileScoreChangedFields;
    reason?: string | null;
    clientChangedAt?: string;
  }
>;

export type MobileScoreQueueStorage = Readonly<{
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}>;

export type MobileScoreQueueDependencies = Readonly<{
  platform?: string;
  storage?: MobileScoreQueueStorage;
  now?: () => string;
  createOperationId?: () => string;
}>;

export type MobileScoreQueueSend = (
  item: MobileScoreQueueItem,
) => Promise<MobileLiveRoundResult<MobileLiveRoundScoreReceipt>>;

export type MobileScoreQueueDrainResult = Readonly<{
  status: "drained" | "empty" | "transient" | "permanent" | "unsupported";
  processed: number;
  receipts: readonly MobileLiveRoundScoreReceipt[];
  item?: MobileScoreQueueItem;
  receipt?: MobileLiveRoundScoreReceipt;
}>;

export type MobileScoreQueuePermanentFailure = Readonly<{
  code: Exclude<MobileScoreQueueItem["failure"], null>["code"];
  message: string;
}>;

const participantLockedFailure: MobileScoreQueuePermanentFailure = {
  code: "locked",
  message:
    "This participant is no longer eligible for score changes. The pending score was not sent.",
};

const queueKeyPrefix = "greenroster.mobile.score-queue";
const queueIndexKeyPrefix = `${queueKeyPrefix}-index`;

type MobileScoreQueueCoordinator = {
  drainingScopes: Set<string>;
  scopeMutationTails: Map<string, Promise<void>>;
  userMutationTails: Map<string, Promise<void>>;
};

// Multiple round surfaces can create queue objects over the same storage. Keep
// their in-memory coordination shared without retaining storage instances.
const queueCoordinators = new WeakMap<
  MobileScoreQueueStorage,
  MobileScoreQueueCoordinator
>();

function coordinatorForStorage(
  storage: MobileScoreQueueStorage,
): MobileScoreQueueCoordinator {
  const existing = queueCoordinators.get(storage);
  if (existing) return existing;
  const coordinator: MobileScoreQueueCoordinator = {
    drainingScopes: new Set<string>(),
    scopeMutationTails: new Map<string, Promise<void>>(),
    userMutationTails: new Map<string, Promise<void>>(),
  };
  queueCoordinators.set(storage, coordinator);
  return coordinator;
}

export function mobileScoreQueueStorageKey(scope: MobileScoreQueueScope) {
  const parsed = scopeSchema.parse(scope);
  return `${queueKeyPrefix}:${parsed.userId}:${parsed.groupId}:${parsed.roundId}`;
}

function mobileScoreQueueIndexKey(userId: string) {
  return `${queueIndexKeyPrefix}:${uuidSchema.parse(userId)}`;
}

function parseStoredQueueKeys(value: string | null, userId: string) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const prefix = `${queueKeyPrefix}:${userId}:`;
    return parsed.filter(
      (key): key is string => typeof key === "string" && key.startsWith(prefix),
    );
  } catch {
    return [];
  }
}

export const scoreQueueStorageKey = mobileScoreQueueStorageKey;

function isNative(platform: string) {
  return platform === "ios" || platform === "android";
}

function operationFingerprint(
  item: Pick<
    MobileScoreQueueItem,
    | "participantId"
    | "baseVersion"
    | "deviceOperationId"
    | "operationId"
    | "correlationId"
    | "payload"
    | "reason"
    | "clientChangedAt"
  >,
) {
  return JSON.stringify([
    item.participantId,
    item.baseVersion,
    item.deviceOperationId,
    item.operationId,
    item.correlationId,
    item.payload,
    item.reason,
    item.clientChangedAt,
  ]);
}

function parseStored(value: string | null): MobileScoreQueueItem[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    const result = z.array(queueItemSchema).safeParse(parsed);
    return result.success ? [...result.data] : [];
  } catch {
    return [];
  }
}

function queueError(message: string) {
  return new Error(`mobile_score_queue:${message}`);
}

function ensureNative(platform: string) {
  if (!isNative(platform)) throw queueError("native_storage_required");
}

export function createMobileScoreQueue(
  dependencies: MobileScoreQueueDependencies = {},
) {
  // Keep the module free of a React Native runtime import so shared Vitest/SSR
  // tooling can inspect the strict queue contract without parsing React Native
  // Flow. Callers on native pass Platform.OS; an unknown runtime fails closed.
  const platform = dependencies.platform ?? "web";
  const storage = dependencies.storage ?? secureSessionStorage;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const nextOperationId =
    dependencies.createOperationId ?? createMobileOperationId;
  const { drainingScopes, scopeMutationTails, userMutationTails } =
    coordinatorForStorage(storage);

  async function withLock<T>(
    locks: Map<string, Promise<void>>,
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (locks.get(key) === current) locks.delete(key);
    }
  }

  function withUserMutation<T>(userId: string, operation: () => Promise<T>) {
    ensureNative(platform);
    const parsedUserId = uuidSchema.parse(userId);
    return withLock(userMutationTails, parsedUserId, operation);
  }

  function withScopedMutation<T>(
    scope: MobileScoreQueueScope,
    operation: () => Promise<T>,
  ) {
    ensureNative(platform);
    const parsedScope = scopeSchema.parse(scope);
    return withUserMutation(parsedScope.userId, () =>
      withLock(
        scopeMutationTails,
        mobileScoreQueueStorageKey(parsedScope),
        operation,
      ),
    );
  }

  async function read(scope: MobileScoreQueueScope) {
    ensureNative(platform);
    const parsedScope = scopeSchema.parse(scope);
    return parseStored(
      await storage.getItem(mobileScoreQueueStorageKey(parsedScope)),
    );
  }

  async function write(
    scope: MobileScoreQueueScope,
    items: readonly MobileScoreQueueItem[],
  ) {
    ensureNative(platform);
    const parsedScope = scopeSchema.parse(scope);
    await storage.setItem(
      mobileScoreQueueStorageKey(parsedScope),
      JSON.stringify(items),
    );
  }

  async function rememberScope(scope: MobileScoreQueueScope) {
    const parsedScope = scopeSchema.parse(scope);
    const indexKey = mobileScoreQueueIndexKey(parsedScope.userId);
    const existing = parseStoredQueueKeys(
      await storage.getItem(indexKey),
      parsedScope.userId,
    );
    const storageKey = mobileScoreQueueStorageKey(parsedScope);
    if (existing.includes(storageKey)) return;
    await storage.setItem(indexKey, JSON.stringify([...existing, storageKey]));
  }

  async function forgetScope(scope: MobileScoreQueueScope) {
    const parsedScope = scopeSchema.parse(scope);
    const indexKey = mobileScoreQueueIndexKey(parsedScope.userId);
    const storageKey = mobileScoreQueueStorageKey(parsedScope);
    const existing = parseStoredQueueKeys(
      await storage.getItem(indexKey),
      parsedScope.userId,
    );
    const next = existing.filter((key) => key !== storageKey);
    if (next.length === 0) {
      await storage.removeItem(indexKey);
    } else if (next.length !== existing.length) {
      await storage.setItem(indexKey, JSON.stringify(next));
    }
  }

  async function markPendingFailed(
    scope: MobileScoreQueueScope,
    failure: MobileScoreQueuePermanentFailure = {
      code: "locked",
      message: "This round is no longer accepting score changes.",
    },
  ) {
    const items = await read(scope);
    let changed = false;
    const updated = items.map((item) => {
      if (item.status !== "pending") return item;
      changed = true;
      return {
        ...item,
        status: "failed" as const,
        failure,
        updatedAt: now(),
      };
    });
    if (changed) await write(scope, updated);
    return updated;
  }

  async function markParticipantsPendingFailed(
    scope: MobileScoreQueueScope,
    participantIds: readonly string[],
    failure: MobileScoreQueuePermanentFailure = participantLockedFailure,
  ) {
    const parsedParticipantIds = new Set(
      participantIds.map((participantId) => uuidSchema.parse(participantId)),
    );
    if (parsedParticipantIds.size === 0) return read(scope);
    const items = await read(scope);
    let changed = false;
    const updated = items.map((item) => {
      if (
        item.status !== "pending" ||
        !parsedParticipantIds.has(item.participantId)
      ) {
        return item;
      }
      changed = true;
      return {
        ...item,
        status: "failed" as const,
        failure,
        updatedAt: now(),
      };
    });
    if (changed) await write(scope, updated);
    return updated;
  }

  async function markParticipantPendingFailed(
    scope: MobileScoreQueueScope,
    participantId: string,
    failure: MobileScoreQueuePermanentFailure = participantLockedFailure,
  ) {
    return markParticipantsPendingFailed(scope, [participantId], failure);
  }

  return {
    platform,
    isSupported: isNative(platform),

    async list(scope: MobileScoreQueueScope) {
      return read(scope);
    },

    async peek(scope: MobileScoreQueueScope) {
      return (await read(scope))[0] ?? null;
    },

    async enqueue(input: MobileScoreQueueInput): Promise<MobileScoreQueueItem> {
      return withScopedMutation(
        {
          userId: input.userId,
          groupId: input.groupId,
          roundId: input.roundId,
        },
        async () => {
          ensureNative(platform);
          const timestamp = input.clientChangedAt ?? now();
          const queuedAt = now();
          const parsed = queueItemSchema.safeParse({
            userId: input.userId,
            groupId: input.groupId,
            roundId: input.roundId,
            participantId: input.participantId,
            baseVersion: input.baseVersion,
            deviceOperationId: input.deviceOperationId ?? nextOperationId(),
            operationId: input.operationId ?? nextOperationId(),
            correlationId: input.correlationId ?? nextOperationId(),
            payload: input.payload,
            reason: input.reason?.trim() || null,
            clientChangedAt: timestamp,
            queuedAt,
            createdAt: queuedAt,
            updatedAt: queuedAt,
            attempts: 0,
            status: "pending",
            failure: null,
          });
          if (!parsed.success) {
            throw queueError("invalid_operation");
          }

          const scope = {
            userId: parsed.data.userId,
            groupId: parsed.data.groupId,
            roundId: parsed.data.roundId,
          } satisfies MobileScoreQueueScope;
          const items = await read(scope);
          const existing = items.find(
            (item) => item.deviceOperationId === parsed.data.deviceOperationId,
          );
          if (existing) {
            if (
              operationFingerprint(existing) !==
              operationFingerprint(parsed.data)
            ) {
              throw queueError("operation_id_reused");
            }
            return existing;
          }
          const next = [...items, parsed.data];
          await rememberScope(scope);
          await write(scope, next);
          return parsed.data;
        },
      );
    },

    async remove(scope: MobileScoreQueueScope, deviceOperationId: string) {
      return withScopedMutation(scope, async () => {
        const items = await read(scope);
        const next = items.filter(
          (item) => item.deviceOperationId !== deviceOperationId,
        );
        if (next.length !== items.length) {
          if (next.length === 0) {
            const parsedScope = scopeSchema.parse(scope);
            await storage.removeItem(mobileScoreQueueStorageKey(parsedScope));
            await forgetScope(parsedScope);
          } else {
            await write(scope, next);
          }
        }
        return next.length !== items.length;
      });
    },

    async removeParticipant(
      scope: MobileScoreQueueScope,
      participantId: string,
    ) {
      return withScopedMutation(scope, async () => {
        const parsedParticipantId = uuidSchema.parse(participantId);
        const items = await read(scope);
        const next = items.filter(
          (item) => item.participantId !== parsedParticipantId,
        );
        if (next.length === items.length) return false;
        const parsedScope = scopeSchema.parse(scope);
        if (next.length === 0) {
          await storage.removeItem(mobileScoreQueueStorageKey(parsedScope));
          await forgetScope(parsedScope);
        } else {
          await write(parsedScope, next);
        }
        return true;
      });
    },

    async clear(scope: MobileScoreQueueScope) {
      return withScopedMutation(scope, async () => {
        const parsedScope = scopeSchema.parse(scope);
        await storage.removeItem(mobileScoreQueueStorageKey(parsedScope));
        await forgetScope(parsedScope);
      });
    },

    markPendingFailed(
      scope: MobileScoreQueueScope,
      failure?: MobileScoreQueuePermanentFailure,
    ) {
      return withScopedMutation(scope, () => markPendingFailed(scope, failure));
    },

    markParticipantsPendingFailed(
      scope: MobileScoreQueueScope,
      participantIds: readonly string[],
      failure?: MobileScoreQueuePermanentFailure,
    ) {
      return withScopedMutation(scope, () =>
        markParticipantsPendingFailed(scope, participantIds, failure),
      );
    },
    markParticipantPendingFailed(
      scope: MobileScoreQueueScope,
      participantId: string,
      failure?: MobileScoreQueuePermanentFailure,
    ) {
      return withScopedMutation(scope, () =>
        markParticipantPendingFailed(scope, participantId, failure),
      );
    },

    async markRoundLocked(scope: MobileScoreQueueScope) {
      return withScopedMutation(scope, () =>
        markPendingFailed(scope, {
          code: "locked",
          message: "This round is no longer accepting score changes.",
        }),
      );
    },

    async clearUser(userId: string) {
      return withUserMutation(userId, async () => {
        const parsedUserId = uuidSchema.parse(userId);
        const indexKey = mobileScoreQueueIndexKey(parsedUserId);
        const keys = parseStoredQueueKeys(
          await storage.getItem(indexKey),
          parsedUserId,
        );
        await Promise.all(keys.map((key) => storage.removeItem(key)));
        await storage.removeItem(indexKey);
      });
    },

    async hasPendingUser(userId: string) {
      ensureNative(platform);
      const parsedUserId = uuidSchema.parse(userId);
      const keys = parseStoredQueueKeys(
        await storage.getItem(mobileScoreQueueIndexKey(parsedUserId)),
        parsedUserId,
      );
      for (const key of keys) {
        if (parseStored(await storage.getItem(key)).length > 0) return true;
      }
      return false;
    },

    async drain(
      scope: MobileScoreQueueScope,
      send: MobileScoreQueueSend,
    ): Promise<MobileScoreQueueDrainResult> {
      ensureNative(platform);
      const scopeKey = mobileScoreQueueStorageKey(scope);
      drainingScopes.add(scopeKey);
      return withScopedMutation<MobileScoreQueueDrainResult>(
        scope,
        async (): Promise<MobileScoreQueueDrainResult> => {
          let processed = 0;
          const receipts: MobileLiveRoundScoreReceipt[] = [];
          while (true) {
            const items = await read(scope);
            const item = items[0];
            if (!item) {
              return {
                processed,
                receipts,
                status: processed === 0 ? "empty" : "drained",
              };
            }
            if (item.status === "failed") {
              return { item, processed, receipts, status: "permanent" };
            }

            const attempted: MobileScoreQueueItem = {
              ...item,
              attempts: item.attempts + 1,
              updatedAt: now(),
            };
            await write(scope, [attempted, ...items.slice(1)]);

            let result: MobileLiveRoundResult<MobileLiveRoundScoreReceipt>;
            try {
              result = await send(attempted);
            } catch {
              const currentItems = await read(scope);
              const currentItem = currentItems.find(
                (candidate) =>
                  candidate.deviceOperationId === attempted.deviceOperationId,
              );
              if (!currentItem) continue;
              if (currentItem.status === "failed") {
                return {
                  item: currentItem,
                  processed,
                  receipts,
                  status: "permanent",
                };
              }
              return {
                item: currentItem,
                processed,
                receipts,
                status: "transient",
              };
            }

            // A deferred send can overlap a participant lock, discard, sign-out,
            // or another queue writer. Reconcile by operation ID before applying
            // the result so a stale pre-send array cannot resurrect removed data.
            const currentItems = await read(scope);
            const currentItem = currentItems.find(
              (candidate) =>
                candidate.deviceOperationId === attempted.deviceOperationId,
            );
            if (!currentItem) continue;
            if (currentItem.status === "failed") {
              return {
                item: currentItem,
                processed,
                receipts,
                status: "permanent",
              };
            }

            if (result.ok) {
              const next = currentItems.filter(
                (candidate) =>
                  candidate.deviceOperationId !== attempted.deviceOperationId,
              );
              if (next.length === 0) {
                await storage.removeItem(mobileScoreQueueStorageKey(scope));
                await forgetScope(scope);
              } else {
                await write(scope, next);
              }
              receipts.push(result.data);
              processed += 1;
              continue;
            }

            if (result.code === "unavailable") {
              return {
                item: currentItem,
                processed,
                receipts,
                status: "transient",
              };
            }

            const failed: MobileScoreQueueItem = {
              ...currentItem,
              status: "failed",
              failure: {
                code: result.code,
                message: result.message,
                ...(result.details?.currentScore
                  ? { currentScore: result.details.currentScore }
                  : {}),
              },
              updatedAt: now(),
            };
            await write(
              scope,
              currentItems.map((candidate) =>
                candidate.deviceOperationId === attempted.deviceOperationId
                  ? failed
                  : candidate,
              ),
            );
            return { item: failed, processed, receipts, status: "permanent" };
          }
        },
      ).finally(() => {
        drainingScopes.delete(scopeKey);
      });
    },

    isDraining(scope: MobileScoreQueueScope) {
      ensureNative(platform);
      return drainingScopes.has(mobileScoreQueueStorageKey(scope));
    },
  };
}

export const mobileScoreQueue = createMobileScoreQueue();
export const createMobileScoreQueueStore = createMobileScoreQueue;
