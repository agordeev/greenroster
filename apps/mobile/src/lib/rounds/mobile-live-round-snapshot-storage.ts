import { z } from "zod";

import { secureSessionStorage } from "../auth/secure-session-storage";
import type { MobileLiveRoundParticipant } from "./mobile-live-round-api";
import type { MobileRoundSummary } from "./mobile-rounds-api";

const uuidSchema = z.uuid();
const instantSchema = z.string().datetime({ offset: true });
const nullableInstantSchema = instantSchema.nullable();
const numericSchema = z.string().nullable();

const scoreSnapshotSchema = z
  .object({
    participantId: uuidSchema,
    version: z.number().int().nonnegative(),
    revisionId: uuidSchema.nullable(),
    grossScore: numericSchema,
    netScore: numericSchema,
    golfPoints: numericSchema,
    manualMerit: numericSchema,
    plusMinus: numericSchema,
    rankingValue: numericSchema,
    changedAt: nullableInstantSchema,
  })
  .strict();

const roundSnapshotSchema = z
  .object({
    roundId: uuidSchema,
    groupId: uuidSchema,
    description: z.string().nullable(),
    scheduledAt: nullableInstantSchema,
    groupTimeZone: z.string().min(1),
    venue: z.string().nullable(),
    format: z.enum(["individual_net", "individual_gross"]),
    state: z.enum(["published", "live", "completed", "cancelled"]),
    version: z.number().int().positive(),
    participantStatus: z.enum(["no_response", "playing", "not_playing"]),
    participantVersion: z.number().int().positive().nullable(),
    participantCount: z.number().int().nonnegative(),
    playingCount: z.number().int().nonnegative(),
    updatedAt: instantSchema,
  })
  .strict();

const participantSnapshotSchema = z
  .object({
    roundId: uuidSchema,
    groupId: uuidSchema,
    format: z.enum(["individual_net", "individual_gross"]),
    scheduledAt: nullableInstantSchema,
    groupTimeZone: z.string().min(1),
    roundVersion: z.number().int().positive(),
    participantId: uuidSchema,
    participantKind: z.enum(["member", "guest"]),
    membershipId: uuidSchema.nullable(),
    sponsorMembershipId: uuidSchema.nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    rsvpStatus: z.enum(["no_response", "playing", "not_playing"]),
    participantVersion: z.number().int().positive(),
    quotaSnapshot: numericSchema,
    handicapSnapshot: numericSchema,
    teeSnapshot: z.enum(["pro", "back", "middle", "front"]).nullable(),
    enabledFields: z
      .object({
        golfPoints: z.literal(true),
        grossScore: z.boolean(),
        netScore: z.boolean(),
      })
      .strict(),
    score: scoreSnapshotSchema,
    canEdit: z.boolean(),
    canAuthorManualMerit: z.boolean(),
  })
  .strict();

const snapshotSchema = z
  .object({
    userId: uuidSchema,
    groupId: uuidSchema,
    roundId: uuidSchema,
    savedAt: instantSchema,
    round: roundSnapshotSchema,
    participants: z.array(participantSnapshotSchema),
  })
  .strict();

const scopeSchema = z
  .object({ userId: uuidSchema, groupId: uuidSchema, roundId: uuidSchema })
  .strict();

export type MobileLiveRoundSnapshotScope = z.infer<typeof scopeSchema>;
export type MobileLiveRoundSnapshot = Readonly<{
  savedAt: string;
  round: MobileRoundSummary;
  participants: readonly MobileLiveRoundParticipant[];
}>;

export type MobileLiveRoundCachedRound = Readonly<{
  scope: MobileLiveRoundSnapshotScope;
  round: MobileRoundSummary;
  savedAt: string;
}>;

export type MobileLiveRoundSnapshotStorage = Readonly<{
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}>;

export type MobileLiveRoundSnapshotDependencies = Readonly<{
  storage?: MobileLiveRoundSnapshotStorage;
  now?: () => string;
}>;

const keyPrefix = "greenroster.mobile.live-round-snapshot";
const indexPrefix = `${keyPrefix}-index`;

export function mobileLiveRoundSnapshotStorageKey(
  scope: MobileLiveRoundSnapshotScope,
) {
  const parsed = scopeSchema.parse(scope);
  return `${keyPrefix}:${parsed.userId}:${parsed.groupId}:${parsed.roundId}`;
}

function indexKey(userId: string) {
  return `${indexPrefix}:${uuidSchema.parse(userId)}`;
}

function parseIndex(value: string | null, userId: string) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const prefix = `${keyPrefix}:${userId}:`;
    return parsed.filter(
      (key): key is string => typeof key === "string" && key.startsWith(prefix),
    );
  } catch {
    return [];
  }
}

export function createMobileLiveRoundSnapshotStorage(
  dependencies: MobileLiveRoundSnapshotDependencies = {},
) {
  const storage = dependencies.storage ?? secureSessionStorage;
  const now = dependencies.now ?? (() => new Date().toISOString());

  async function remember(scope: MobileLiveRoundSnapshotScope) {
    const parsedScope = scopeSchema.parse(scope);
    const key = mobileLiveRoundSnapshotStorageKey(parsedScope);
    const keyForUser = indexKey(parsedScope.userId);
    const current = parseIndex(
      await storage.getItem(keyForUser),
      parsedScope.userId,
    );
    if (!current.includes(key)) {
      await storage.setItem(keyForUser, JSON.stringify([...current, key]));
    }
  }

  async function forget(scope: MobileLiveRoundSnapshotScope) {
    const parsedScope = scopeSchema.parse(scope);
    const keyForUser = indexKey(parsedScope.userId);
    const key = mobileLiveRoundSnapshotStorageKey(parsedScope);
    const current = parseIndex(
      await storage.getItem(keyForUser),
      parsedScope.userId,
    );
    const next = current.filter((value) => value !== key);
    if (next.length === 0) await storage.removeItem(keyForUser);
    else if (next.length !== current.length) {
      await storage.setItem(keyForUser, JSON.stringify(next));
    }
  }

  return {
    async save(
      scope: MobileLiveRoundSnapshotScope,
      participants: readonly MobileLiveRoundParticipant[],
      round: MobileRoundSummary,
    ) {
      const parsedScope = scopeSchema.parse(scope);
      const savedAt = now();
      const parsed = snapshotSchema.safeParse({
        ...parsedScope,
        savedAt,
        round,
        participants,
      });
      if (!parsed.success)
        throw new Error("mobile_live_round_snapshot:invalid");
      if (
        parsed.data.participants.some(
          (participant) =>
            participant.groupId !== parsedScope.groupId ||
            participant.roundId !== parsedScope.roundId,
        )
      ) {
        throw new Error("mobile_live_round_snapshot:scope_mismatch");
      }
      if (
        parsed.data.round.groupId !== parsedScope.groupId ||
        parsed.data.round.roundId !== parsedScope.roundId
      ) {
        throw new Error("mobile_live_round_snapshot:scope_mismatch");
      }
      await remember(parsedScope);
      await storage.setItem(
        mobileLiveRoundSnapshotStorageKey(parsedScope),
        JSON.stringify(parsed.data),
      );
      return {
        savedAt,
        round: parsed.data.round,
        participants: parsed.data.participants,
      } satisfies MobileLiveRoundSnapshot;
    },

    async load(
      scope: MobileLiveRoundSnapshotScope,
    ): Promise<MobileLiveRoundSnapshot | null> {
      const parsedScope = scopeSchema.parse(scope);
      const value = await storage.getItem(
        mobileLiveRoundSnapshotStorageKey(parsedScope),
      );
      if (!value) return null;
      try {
        const parsed = snapshotSchema.safeParse(JSON.parse(value));
        if (!parsed.success) return null;
        if (
          parsed.data.userId !== parsedScope.userId ||
          parsed.data.groupId !== parsedScope.groupId ||
          parsed.data.roundId !== parsedScope.roundId
        ) {
          return null;
        }
        return {
          savedAt: parsed.data.savedAt,
          round: parsed.data.round,
          participants: parsed.data.participants,
        } satisfies MobileLiveRoundSnapshot;
      } catch {
        return null;
      }
    },

    async listUser(
      userId: string,
    ): Promise<readonly MobileLiveRoundCachedRound[]> {
      const parsedUserId = uuidSchema.parse(userId);
      const keys = parseIndex(
        await storage.getItem(indexKey(parsedUserId)),
        parsedUserId,
      );
      const snapshots = await Promise.all(
        keys.map(async (key) => {
          try {
            const parsed = snapshotSchema.safeParse(
              JSON.parse((await storage.getItem(key)) ?? ""),
            );
            if (!parsed.success || parsed.data.userId !== parsedUserId) {
              return null;
            }
            return {
              scope: {
                userId: parsed.data.userId,
                groupId: parsed.data.groupId,
                roundId: parsed.data.roundId,
              },
              round: parsed.data.round,
              savedAt: parsed.data.savedAt,
            } satisfies MobileLiveRoundCachedRound;
          } catch {
            return null;
          }
        }),
      );
      return snapshots.filter(
        (snapshot): snapshot is MobileLiveRoundCachedRound => snapshot !== null,
      );
    },

    async clear(scope: MobileLiveRoundSnapshotScope) {
      const parsedScope = scopeSchema.parse(scope);
      await storage.removeItem(mobileLiveRoundSnapshotStorageKey(parsedScope));
      await forget(parsedScope);
    },

    async clearUser(userId: string) {
      const parsedUserId = uuidSchema.parse(userId);
      const key = indexKey(parsedUserId);
      const keys = parseIndex(await storage.getItem(key), parsedUserId);
      await Promise.all(keys.map((value) => storage.removeItem(value)));
      await storage.removeItem(key);
    },
  };
}

export const mobileLiveRoundSnapshotStorage =
  createMobileLiveRoundSnapshotStorage();
