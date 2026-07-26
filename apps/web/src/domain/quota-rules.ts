import type { DecimalScale } from "./exact-decimal";

export type QuotaMethod =
  "moving_average" | "best_10_of_20" | "previous_plus_minus";

export type QuotaAdjustmentBand = Readonly<{
  adjustment: string;
  lowerBound: string;
  lowerInclusive: boolean;
  upperBound: string;
  upperInclusive: boolean;
}>;

export type QuotaCalculation =
  | Readonly<{
      ready: false;
      reason: "initial_quota_required";
    }>
  | Readonly<{
      deactivateInitialQuota: boolean;
      matchedBandPosition: number | null;
      quota: string;
      ready: true;
      sourcePointTotals: readonly string[];
    }>;

type CalculateQuotaInput = Readonly<{
  adjustmentBands?: readonly QuotaAdjustmentBand[];
  eligiblePointTotals: readonly string[];
  historyLength?: number;
  initialQuota?: string | null;
  method: QuotaMethod;
  plusMinus?: string;
  precision: DecimalScale;
  previousQuota?: string | null;
  useInitialQuota: boolean;
}>;

const HUNDRED = BigInt(100);

export function validateAdjustmentBands(
  bands: readonly QuotaAdjustmentBand[],
): void {
  if (bands.length === 0)
    throw new Error("Method C bands must cover -100 to 100");

  const parsed = bands.map((band) => ({
    adjustment: parseHundredths(band.adjustment, -20, 20, "Adjustment"),
    lower: parseHundredths(band.lowerBound, -100, 100, "Lower bound"),
    lowerInclusive: band.lowerInclusive,
    upper: parseHundredths(band.upperBound, -100, 100, "Upper bound"),
    upperInclusive: band.upperInclusive,
  }));

  for (const band of parsed) {
    if (band.lower > band.upper)
      throw new Error("Band lower bound exceeds upper bound");
    if (
      band.lower === band.upper &&
      !(band.lowerInclusive && band.upperInclusive)
    ) {
      throw new Error("A single-point band must include its bound");
    }
  }

  const first = parsed[0];
  const last = parsed.at(-1);
  if (!first || first.lower !== BigInt(-10_000) || !first.lowerInclusive) {
    throw new Error("Method C bands must include -100");
  }
  if (!last || last.upper !== BigInt(10_000) || !last.upperInclusive) {
    throw new Error("Method C bands must include 100");
  }

  for (let index = 1; index < parsed.length; index += 1) {
    const previous = parsed[index - 1];
    const current = parsed[index];
    if (!previous || !current) throw new Error("Band ordering is invalid");
    if (previous.upper !== current.lower) {
      throw new Error("Method C bands contain a gap or overlap");
    }
    if (previous.upperInclusive === current.lowerInclusive) {
      throw new Error("A shared band boundary must belong to exactly one band");
    }
  }
}

export function calculateQuota(input: CalculateQuotaInput): QuotaCalculation {
  validatePrecision(input.precision);
  const pointTotals = input.eligiblePointTotals.map((total) =>
    parseHundredths(total, 0, 100, "Point total"),
  );
  const initialQuota = parseOptionalQuota(input.initialQuota, "Initial quota");

  if (input.method === "moving_average") {
    const historyLength = input.historyLength ?? 10;
    if (
      !Number.isInteger(historyLength) ||
      historyLength < 4 ||
      historyLength > 20
    ) {
      throw new Error("Moving-average history length must be between 4 and 20");
    }

    if (pointTotals.length === 0) {
      return initialOrNotReady(initialQuota, input.precision, false);
    }
    if (input.useInitialQuota && pointTotals.length < historyLength) {
      return initialOrNotReady(initialQuota, input.precision, false);
    }

    const source = pointTotals.slice(-historyLength);
    return calculatedAverage(
      source,
      input.precision,
      input.useInitialQuota && pointTotals.length >= historyLength,
    );
  }

  if (input.method === "best_10_of_20") {
    if (input.historyLength !== undefined) {
      throw new Error("Best 10 of 20 does not accept a history length");
    }
    if (pointTotals.length === 0) {
      return initialOrNotReady(initialQuota, input.precision, false);
    }
    if (input.useInitialQuota && pointTotals.length < 10) {
      return initialOrNotReady(initialQuota, input.precision, false);
    }

    const recent = pointTotals.slice(-20);
    const source =
      recent.length < 10
        ? recent
        : [...recent]
            .sort((left, right) => (left > right ? -1 : left < right ? 1 : 0))
            .slice(0, 10);
    return calculatedAverage(
      source,
      input.precision,
      input.useInitialQuota && pointTotals.length >= 10,
    );
  }

  if (input.historyLength !== undefined) {
    throw new Error("Method C does not accept a history length");
  }
  if (input.plusMinus === undefined)
    throw new Error("Method C requires plus/minus");
  const bands = input.adjustmentBands ?? [];
  validateAdjustmentBands(bands);
  const plusMinus = parseHundredths(input.plusMinus, -100, 100, "Plus/minus");
  const priorQuota =
    parseOptionalQuota(input.previousQuota, "Previous quota") ?? initialQuota;
  if (priorQuota === null)
    return { ready: false, reason: "initial_quota_required" };

  const position = bands.findIndex((band) => {
    const lower = parseHundredths(band.lowerBound, -100, 100, "Lower bound");
    const upper = parseHundredths(band.upperBound, -100, 100, "Upper bound");
    return (
      (plusMinus > lower || (plusMinus === lower && band.lowerInclusive)) &&
      (plusMinus < upper || (plusMinus === upper && band.upperInclusive))
    );
  });
  if (position < 0) throw new Error("No Method C band matches plus/minus");

  const adjustment = parseHundredths(
    bands[position]?.adjustment ?? "",
    -20,
    20,
    "Adjustment",
  );
  const quota = roundHundredths(priorQuota + adjustment, input.precision);
  const quotaHundredths = parseHundredths(quota, 0, 100, "Calculated quota");

  return {
    deactivateInitialQuota: input.useInitialQuota,
    matchedBandPosition: position + 1,
    quota: formatHundredths(quotaHundredths, input.precision),
    ready: true,
    sourcePointTotals: [],
  };
}

function calculatedAverage(
  source: readonly bigint[],
  precision: DecimalScale,
  deactivateInitialQuota: boolean,
): QuotaCalculation {
  const sum = source.reduce((total, value) => total + value, BigInt(0));
  return {
    deactivateInitialQuota,
    matchedBandPosition: null,
    quota: roundRatio(sum, BigInt(source.length) * HUNDRED, precision),
    ready: true,
    sourcePointTotals: source.map((value) => formatHundredths(value, 2)),
  };
}

function initialOrNotReady(
  initialQuota: bigint | null,
  precision: DecimalScale,
  deactivateInitialQuota: boolean,
): QuotaCalculation {
  if (initialQuota === null)
    return { ready: false, reason: "initial_quota_required" };
  return {
    deactivateInitialQuota,
    matchedBandPosition: null,
    quota: roundHundredths(initialQuota, precision),
    ready: true,
    sourcePointTotals: [],
  };
}

function parseOptionalQuota(
  value: string | null | undefined,
  label: string,
): bigint | null {
  return value === null || value === undefined
    ? null
    : parseHundredths(value, 0, 100, label);
}

function parseHundredths(
  value: string,
  minimum: number,
  maximum: number,
  label: string,
): bigint {
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match)
    throw new Error(
      `${label} must be a base-10 value with at most 2 decimal places`,
    );
  const [, sign, integer = "0", fraction = ""] = match;
  const magnitude = BigInt(integer) * HUNDRED + BigInt(fraction.padEnd(2, "0"));
  const parsed = sign === "-" ? -magnitude : magnitude;
  if (parsed < BigInt(minimum * 100) || parsed > BigInt(maximum * 100)) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function roundHundredths(value: bigint, precision: DecimalScale): string {
  return roundRatio(value, HUNDRED, precision);
}

function roundRatio(
  numerator: bigint,
  denominator: bigint,
  precision: DecimalScale,
): string {
  const scaleFactor = BigInt(10) ** BigInt(precision);
  const scaledNumerator = numerator * scaleFactor;
  const negative = scaledNumerator < 0;
  const magnitude = negative ? -scaledNumerator : scaledNumerator;
  let quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  if (remainder * BigInt(2) >= denominator) quotient += BigInt(1);
  return formatScaled(negative ? -quotient : quotient, precision);
}

function formatHundredths(value: bigint, precision: DecimalScale): string {
  return roundHundredths(value, precision);
}

function formatScaled(value: bigint, precision: DecimalScale): string {
  const negative = value < 0;
  const magnitude = (negative ? -value : value)
    .toString()
    .padStart(precision + 1, "0");
  if (precision === 0) return `${negative ? "-" : ""}${magnitude}`;
  const splitAt = magnitude.length - precision;
  return `${negative ? "-" : ""}${magnitude.slice(0, splitAt)}.${magnitude.slice(splitAt)}`;
}

function validatePrecision(
  precision: number,
): asserts precision is DecimalScale {
  if (precision !== 0 && precision !== 1 && precision !== 2) {
    throw new Error("Quota precision must be 0, 1, or 2");
  }
}
