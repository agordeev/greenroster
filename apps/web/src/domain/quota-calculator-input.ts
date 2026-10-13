import { calculateQuota } from "./quota-rules";

// Turns the public quota calculator's form into the input `calculateQuota`
// expects. The calculator adds no math of its own, so a golfer sees the same
// quota here as in a group.

export type QuotaCalculatorMethod = "moving_average" | "best_10_of_20";

export type QuotaCalculatorForm = Readonly<{
  method: QuotaCalculatorMethod;
  /** Point totals, oldest first. Blank entries are skipped. */
  points: readonly string[];
  /** Moving average only. */
  roundsCounted: string;
  startingQuota: string;
}>;

export type QuotaCalculatorOutcome =
  | Readonly<{ status: "invalid"; message: string }>
  | Readonly<{ status: "starting_quota_needed" }>
  | Readonly<{
      status: "ready";
      countedPoints: readonly string[];
      latestRound: Readonly<{ plusMinus: string; points: string }> | null;
      quota: string;
      roundsEntered: number;
      roundsNeeded: number;
      usedStartingQuota: boolean;
    }>;

export const QUOTA_CALCULATOR_MAX_ROUNDS = 20;
export const QUOTA_CALCULATOR_PRECISION = 1;

export const defaultQuotaCalculatorForm: QuotaCalculatorForm = {
  method: "moving_average",
  points: [],
  roundsCounted: "10",
  startingQuota: "",
};

type CalculateQuotaInput = Parameters<typeof calculateQuota>[0];

export function enteredPoints(form: QuotaCalculatorForm): string[] {
  return form.points.map((value) => value.trim()).filter(Boolean);
}

/**
 * A starting quota holds until enough rounds build up, as it does for a new
 * member of a group. Without one, the rounds entered so far are averaged.
 */
export function toQuotaInput(form: QuotaCalculatorForm): CalculateQuotaInput {
  const startingQuota = form.startingQuota.trim();
  return {
    eligiblePointTotals: enteredPoints(form),
    ...(form.method === "moving_average"
      ? { historyLength: Number(form.roundsCounted.trim() || Number.NaN) }
      : {}),
    initialQuota: startingQuota || null,
    method: form.method,
    precision: QUOTA_CALCULATOR_PRECISION,
    useInitialQuota: startingQuota !== "",
  };
}

export function calculateFromForm(
  form: QuotaCalculatorForm,
): QuotaCalculatorOutcome {
  const input = toQuotaInput(form);
  let result: ReturnType<typeof calculateQuota>;
  try {
    result = calculateQuota(input);
  } catch (error) {
    return {
      status: "invalid",
      message:
        error instanceof Error ? error.message : "Check the numbers you typed.",
    };
  }
  if (!result.ready) return { status: "starting_quota_needed" };

  const points = input.eligiblePointTotals;
  const latest = points.at(-1);
  return {
    status: "ready",
    countedPoints: result.sourcePointTotals.map(trimFigure),
    latestRound: latest
      ? {
          plusMinus: plusMinus(latest, result.quota),
          points: trimFigure(latest),
        }
      : null,
    quota: result.quota,
    roundsEntered: points.length,
    roundsNeeded:
      form.method === "moving_average" ? (input.historyLength ?? 10) : 10,
    // `calculateQuota` reports no source rounds when the starting quota stands.
    usedStartingQuota: result.sourcePointTotals.length === 0,
  };
}

/** Reads a shared calculator address. Unknown or missing values fall back. */
export function parseCalculatorQuery(search: string): QuotaCalculatorForm {
  const query = new URLSearchParams(search);
  const method = query.get("method");
  return {
    method:
      method === "best_10_of_20" || method === "moving_average"
        ? method
        : defaultQuotaCalculatorForm.method,
    points: (query.get("points") ?? "")
      .split(",")
      .map((value) => value.trim().slice(0, 8))
      .filter(Boolean)
      .slice(0, QUOTA_CALCULATOR_MAX_ROUNDS),
    roundsCounted: (
      query.get("rounds") ?? defaultQuotaCalculatorForm.roundsCounted
    ).slice(0, 4),
    startingQuota: (query.get("start") ?? "").trim().slice(0, 8),
  };
}

export function toCalculatorQuery(form: QuotaCalculatorForm): string {
  const query = new URLSearchParams({ method: form.method });
  if (form.method === "moving_average") {
    query.set("rounds", form.roundsCounted.trim());
  }
  const points = enteredPoints(form);
  if (points.length > 0) query.set("points", points.join(","));
  const startingQuota = form.startingQuota.trim();
  if (startingQuota) query.set("start", startingQuota);
  // Commas are safe in a query and keep a shared address readable.
  return query.toString().replaceAll("%2C", ",");
}

/** Points minus quota, as the app shows it: +2.4, −1.6 or 0. */
function plusMinus(points: string, quota: string): string {
  const difference = hundredths(points) - hundredths(quota);
  if (difference === 0) return "0";
  const magnitude = Math.abs(difference);
  const figure = trimFigure(
    `${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, "0")}`,
  );
  return `${difference > 0 ? "+" : "−"}${figure}`;
}

// Only called with values `calculateQuota` has already accepted.
function hundredths(value: string): number {
  const [integer = "0", fraction = ""] = value
    .trim()
    .replace(/^\+/, "")
    .split(".");
  return Number(integer) * 100 + Number(fraction.padEnd(2, "0"));
}

/** 27.00 reads as 27, 24.50 as 24.5. */
function trimFigure(value: string): string {
  const trimmed = value.trim().replace(/^\+/, "");
  return trimmed.includes(".")
    ? trimmed.replace(/0+$/, "").replace(/\.$/, "")
    : trimmed;
}
