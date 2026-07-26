export type StorageDriver = Readonly<{
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}>;

type ChunkSet = Readonly<{
  chunkCount: number;
  version: string;
}>;

type StorageEnvelope = Readonly<{
  active: ChunkSet;
  cleanupLegacy: boolean;
  stale: readonly ChunkSet[];
}>;

function metadataKey(key: string) {
  return `${key}.meta`;
}

function pendingKey(key: string) {
  return `${key}.pending`;
}

function chunkKey(key: string, chunks: ChunkSet, index: number) {
  return `${key}.${chunks.version}.${index}`;
}

function isChunkSet(value: unknown): value is ChunkSet {
  if (!value || typeof value !== "object") return false;

  const chunks = value as Partial<ChunkSet>;
  return (
    typeof chunks.version === "string" &&
    /^[a-z0-9-]+$/i.test(chunks.version) &&
    Number.isSafeInteger(chunks.chunkCount) &&
    (chunks.chunkCount ?? 0) > 0
  );
}

function parseEnvelope(value: string | null): StorageEnvelope | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;

    // Read the first adapter format so existing sessions survive this upgrade.
    if (isChunkSet(parsed)) {
      return { active: parsed, cleanupLegacy: true, stale: [] };
    }

    if (!parsed || typeof parsed !== "object") return null;

    const envelope = parsed as Partial<StorageEnvelope>;
    if (
      !isChunkSet(envelope.active) ||
      typeof envelope.cleanupLegacy !== "boolean" ||
      !Array.isArray(envelope.stale) ||
      !envelope.stale.every(isChunkSet)
    ) {
      return null;
    }

    return {
      active: envelope.active,
      cleanupLegacy: envelope.cleanupLegacy,
      stale: envelope.stale,
    };
  } catch {
    return null;
  }
}

function parseChunkSet(value: string | null): ChunkSet | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    return isChunkSet(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function removeChunkSet(
  driver: StorageDriver,
  key: string,
  chunks: ChunkSet,
) {
  await Promise.all(
    Array.from({ length: chunks.chunkCount }, (_, index) =>
      driver.removeItem(chunkKey(key, chunks, index)),
    ),
  );
}

async function cleanCommittedStorage(
  driver: StorageDriver,
  key: string,
  envelope: StorageEnvelope,
) {
  for (const stale of envelope.stale) {
    await removeChunkSet(driver, key, stale);
  }

  if (envelope.cleanupLegacy) {
    await driver.removeItem(key);
  }

  if (envelope.stale.length > 0 || envelope.cleanupLegacy) {
    await driver.setItem(
      metadataKey(key),
      JSON.stringify({ ...envelope, cleanupLegacy: false, stale: [] }),
    );
  }
}

async function cleanPendingStorage(
  driver: StorageDriver,
  key: string,
  pending: ChunkSet | null,
  active: ChunkSet | null,
) {
  if (!pending) return;

  if (pending.version !== active?.version) {
    await removeChunkSet(driver, key, pending);
  }

  await driver.removeItem(pendingKey(key));
}

export function createChunkedSessionStorage(
  driver: StorageDriver,
  options: Readonly<{
    chunkSize?: number;
    createVersion?: () => string;
  }> = {},
) {
  // Four-byte Unicode code points keep each encrypted value below the historical
  // iOS Keychain limit documented by Expo.
  const chunkSize = options.chunkSize ?? 400;
  let versionSequence = 0;
  const createVersion =
    options.createVersion ??
    (() =>
      `${Date.now().toString(36)}-${(versionSequence++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new Error("Session storage chunk size must be a positive integer");
  }

  return {
    async getItem(key: string) {
      const [storedEnvelope, storedPending] = await Promise.all([
        driver.getItem(metadataKey(key)),
        driver.getItem(pendingKey(key)),
      ]);
      const envelope = parseEnvelope(storedEnvelope);
      const pending = parseChunkSet(storedPending);

      await cleanPendingStorage(
        driver,
        key,
        pending,
        envelope?.active ?? null,
      ).catch(() => undefined);

      if (!envelope) return driver.getItem(key);

      const chunks = await Promise.all(
        Array.from({ length: envelope.active.chunkCount }, (_, index) =>
          driver.getItem(chunkKey(key, envelope.active, index)),
        ),
      );

      // Cleanup is best-effort after the active value is readable. The durable
      // envelope retains every stale key until a later attempt succeeds.
      await cleanCommittedStorage(driver, key, envelope).catch(() => undefined);

      return chunks.every((chunk): chunk is string => chunk !== null)
        ? chunks.join("")
        : null;
    },

    async removeItem(key: string) {
      const [storedEnvelope, storedPending] = await Promise.all([
        driver.getItem(metadataKey(key)),
        driver.getItem(pendingKey(key)),
      ]);
      const envelope = parseEnvelope(storedEnvelope);
      const pending = parseChunkSet(storedPending);

      if (envelope) {
        await removeChunkSet(driver, key, envelope.active);
        for (const stale of envelope.stale) {
          await removeChunkSet(driver, key, stale);
        }
      }

      if (
        pending &&
        pending.version !== envelope?.active.version &&
        !envelope?.stale.some((stale) => stale.version === pending.version)
      ) {
        await removeChunkSet(driver, key, pending);
      }

      await driver.removeItem(key);
      await driver.removeItem(metadataKey(key));
      await driver.removeItem(pendingKey(key));
    },

    async setItem(key: string, value: string) {
      const [storedEnvelope, storedPending] = await Promise.all([
        driver.getItem(metadataKey(key)),
        driver.getItem(pendingKey(key)),
      ]);
      const prior = parseEnvelope(storedEnvelope);
      const priorPending = parseChunkSet(storedPending);

      // Do not overwrite the only durable pointer to a partial prior write.
      await cleanPendingStorage(
        driver,
        key,
        priorPending,
        prior?.active ?? null,
      );

      const active: ChunkSet = {
        chunkCount: Math.max(1, Math.ceil(value.length / chunkSize)),
        version: createVersion(),
      };

      // The intent is durable before any credential chunk is written. If a
      // chunk write fails, later get/remove/set operations can still erase it.
      await driver.setItem(pendingKey(key), JSON.stringify(active));
      const chunkWrites = await Promise.allSettled(
        Array.from({ length: active.chunkCount }, (_, index) =>
          driver.setItem(
            chunkKey(key, active, index),
            value.slice(index * chunkSize, (index + 1) * chunkSize),
          ),
        ),
      );
      const failedWrite = chunkWrites.find(
        (write): write is PromiseRejectedResult => write.status === "rejected",
      );
      if (failedWrite) throw failedWrite.reason;

      const envelope: StorageEnvelope = {
        active,
        cleanupLegacy: true,
        stale: prior ? [...prior.stale, prior.active] : [],
      };

      // This metadata write is the commit point. Cleanup failure after it does
      // not make the newly readable session report a failed write.
      await driver.setItem(metadataKey(key), JSON.stringify(envelope));
      await driver.removeItem(pendingKey(key)).catch(() => undefined);
      await cleanCommittedStorage(driver, key, envelope).catch(() => undefined);
    },
  };
}
