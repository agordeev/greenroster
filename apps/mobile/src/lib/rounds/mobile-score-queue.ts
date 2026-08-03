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
  item?: MobileScoreQueueItem;
  receipt?: MobileLiveRoundScoreReceipt;
}>;

export type MobileScoreQueuePermanentFailure = Readonly<{
  code: Exclude<MobileScoreQueueItem["failure"], null>["code"];
  message: string;
}>;

const queueKeyPrefix = "greenroster.mobile.score-queue";
const queueIndexKeyPrefix = `${queueKeyPrefix}-index`;

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
          operationFingerprint(existing) !== operationFingerprint(parsed.data)
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

    async remove(scope: MobileScoreQueueScope, deviceOperationId: string) {
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
    },

    async clear(scope: MobileScoreQueueScope) {
      ensureNative(platform);
      const parsedScope = scopeSchema.parse(scope);
      await storage.removeItem(mobileScoreQueueStorageKey(parsedScope));
      await forgetScope(parsedScope);
    },

    markPendingFailed,

    async markRoundLocked(scope: MobileScoreQueueScope) {
      return markPendingFailed(scope, {
        code: "locked",
        message: "This round is no longer accepting score changes.",
      });
    },

    async clearUser(userId: string) {
      ensureNative(platform);
      const parsedUserId = uuidSchema.parse(userId);
      const indexKey = mobileScoreQueueIndexKey(parsedUserId);
      const keys = parseStoredQueueKeys(
        await storage.getItem(indexKey),
        parsedUserId,
      );
      await Promise.all(keys.map((key) => storage.removeItem(key)));
      await storage.removeItem(indexKey);
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
      let processed = 0;
      while (true) {
        const items = await read(scope);
        const item = items[0];
        if (!item) {
          return {
            processed,
            status: processed === 0 ? "empty" : "drained",
          };
        }
        if (item.status === "failed") {
          return { item, processed, status: "permanent" };
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
          return { item: attempted, processed, status: "transient" };
        }
        if (result.ok) {
          if (items.length === 1) {
            await storage.removeItem(mobileScoreQueueStorageKey(scope));
            await forgetScope(scope);
          } else {
            await write(scope, items.slice(1));
          }
          processed += 1;
          continue;
        }

        if (result.code === "unavailable") {
          return { item: attempted, processed, status: "transient" };
        }

        const failed: MobileScoreQueueItem = {
          ...attempted,
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
        await write(scope, [failed, ...items.slice(1)]);
        return { item: failed, processed, status: "permanent" };
      }
    },
  };
}

export const mobileScoreQueue = createMobileScoreQueue();
export const createMobileScoreQueueStore = createMobileScoreQueue;
