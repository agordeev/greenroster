import { roundHalfAwayFromZero, type DecimalScale } from "./exact-decimal";
import {
  calculateQuota,
  type QuotaAdjustmentBand,
  type QuotaMethod,
} from "./quota-rules";

export type MemberQuotaBootstrapProjection = Readonly<{
  quota: string | null;
  ready: boolean;
  source: Readonly<{
    seedPositions: readonly number[];
    type: "initial" | "seed_history" | "unavailable";
  }>;
  usesInitialQuota: boolean;
}>;

export function projectMemberQuotaBootstrap(
  input: Readonly<{
    adjustmentBands: readonly QuotaAdjustmentBand[];
    historyLength: number | null;
    initialQuota: string | null;
    method: QuotaMethod;
    precision: DecimalScale;
    seedTotals: readonly string[];
    useInitialQuota: boolean;
  }>,
): MemberQuotaBootstrapProjection {
  if (input.seedTotals.length > 20) {
    throw new Error("Initial history accepts at most 20 point totals");
  }
  if (input.initialQuota === null && input.useInitialQuota) {
    throw new Error("Use Initial Quota requires an initial quota");
  }
  for (const seedTotal of input.seedTotals) {
    golfValueHundredths(seedTotal, "Seed total");
  }
  if (input.initialQuota !== null) {
    golfValueHundredths(input.initialQuota, "Initial quota");
    const rounded = roundHalfAwayFromZero(input.initialQuota, input.precision);
    if (
      roundHalfAwayFromZero(input.initialQuota, 2) !==
      roundHalfAwayFromZero(rounded, 2)
    ) {
      throw new Error("Initial quota exceeds the group precision");
    }
  }

  if (input.method === "previous_plus_minus") {
    if (input.initialQuota === null) {
      return {
        quota: null,
        ready: false,
        source: { seedPositions: [], type: "unavailable" },
        usesInitialQuota: false,
      };
    }
    return {
      quota: roundHalfAwayFromZero(input.initialQuota, input.precision),
      ready: true,
      source: { seedPositions: [], type: "initial" },
      usesInitialQuota: input.useInitialQuota,
    };
  }

  const result = calculateQuota({
    adjustmentBands: input.adjustmentBands,
    eligiblePointTotals: input.seedTotals,
    ...(input.method === "moving_average"
      ? { historyLength: input.historyLength ?? undefined }
      : {}),
    initialQuota: input.initialQuota,
    method: input.method,
    precision: input.precision,
    useInitialQuota: input.useInitialQuota,
  });
  if (!result.ready) {
    return {
      quota: null,
      ready: false,
      source: { seedPositions: [], type: "unavailable" },
      usesInitialQuota: false,
    };
  }

  const seedPositions = resolveSourceSeedPositions(
    input.method,
    input.seedTotals,
    result.sourcePointTotals,
  );
  return {
    quota: result.quota,
    ready: true,
    source:
      seedPositions.length > 0
        ? { seedPositions, type: "seed_history" }
        : { seedPositions: [], type: "initial" },
    usesInitialQuota: input.useInitialQuota && !result.deactivateInitialQuota,
  };
}

function resolveSourceSeedPositions(
  method: "moving_average" | "best_10_of_20",
  seedTotals: readonly string[],
  sourceTotals: readonly string[],
) {
  if (sourceTotals.length === 0) return [];
  if (method === "moving_average") {
    return Array.from(
      { length: sourceTotals.length },
      (_, index) => seedTotals.length - sourceTotals.length + index + 1,
    );
  }
  return seedTotals
    .map((value, index) => ({
      position: index + 1,
      value: golfValueHundredths(value, "Seed total"),
    }))
    .slice(-20)
    .sort((left, right) =>
      left.value === right.value
        ? left.position - right.position
        : left.value > right.value
          ? -1
          : 1,
    )
    .slice(0, sourceTotals.length)
    .map(({ position }) => position);
}

function golfValueHundredths(value: string, label: string) {
  const match = /^[+]?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `${label} must use base-10 notation with at most 2 decimal places`,
    );
  }
  const parsed =
    BigInt(match[1] ?? "0") * BigInt(100) +
    BigInt((match[2] ?? "").padEnd(2, "0"));
  if (parsed > BigInt(10_000)) {
    throw new Error(`${label} must be between 0 and 100`);
  }
  return parsed;
}
