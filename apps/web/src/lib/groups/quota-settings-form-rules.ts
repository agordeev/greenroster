import {
  validateAdjustmentBands,
  type QuotaAdjustmentBand,
} from "../../domain/quota-rules";

export type BandFormValidation = Readonly<{
  rowErrors: readonly (string | null)[];
  summary: string | null;
}>;

export function validateBandFormRows(
  bands: readonly QuotaAdjustmentBand[],
): BandFormValidation {
  if (bands.length === 0) {
    return {
      rowErrors: [],
      summary: "Add bands that cover every value from -100 through 100.",
    };
  }

  const rowErrors: (string | null)[] = bands.map((band) =>
    validateRowNumbers(band),
  );
  if (rowErrors.some(Boolean)) {
    return { rowErrors, summary: "Resolve the highlighted band values." };
  }

  const parsed = bands.map((band) => ({
    lower: Number(band.lowerBound),
    upper: Number(band.upperBound),
  }));
  if (parsed[0]?.lower !== -100 || !bands[0]?.lowerInclusive) {
    rowErrors[0] = "The first band must include -100.";
  }
  const lastIndex = bands.length - 1;
  if (parsed[lastIndex]?.upper !== 100 || !bands[lastIndex]?.upperInclusive) {
    rowErrors[lastIndex] = "The last band must include 100.";
  }
  for (let index = 1; index < bands.length; index += 1) {
    const previous = bands[index - 1];
    const current = bands[index];
    if (!previous || !current) continue;
    if (
      parsed[index - 1]?.upper !== parsed[index]?.lower ||
      previous.upperInclusive === current.lowerInclusive
    ) {
      rowErrors[index] =
        `Band ${index} and band ${index + 1} have a gap or overlap at their shared boundary.`;
    }
  }

  if (rowErrors.some(Boolean)) {
    return {
      rowErrors,
      summary: "Resolve the highlighted Method C gap or overlap.",
    };
  }

  try {
    validateAdjustmentBands(bands);
    return { rowErrors, summary: null };
  } catch (error) {
    rowErrors[0] =
      error instanceof Error ? error.message : "Review the adjustment bands.";
    return { rowErrors, summary: "Resolve the highlighted band values." };
  }
}

export function shouldAllowDirtyNavigation(
  dirty: boolean,
  confirmDeparture: () => boolean,
) {
  return !dirty || confirmDeparture();
}

function validateRowNumbers(band: QuotaAdjustmentBand) {
  const decimal = /^[-+]?\d+(?:\.\d{1,2})?$/;
  if (
    !decimal.test(band.lowerBound.trim()) ||
    !decimal.test(band.upperBound.trim()) ||
    !decimal.test(band.adjustment.trim())
  ) {
    return "Bounds and adjustment must use at most two decimal places.";
  }
  const lower = Number(band.lowerBound);
  const upper = Number(band.upperBound);
  const adjustment = Number(band.adjustment);
  if (lower < -100 || lower > 100 || upper < -100 || upper > 100) {
    return "Band bounds must be between -100 and 100.";
  }
  if (adjustment < -20 || adjustment > 20) {
    return "Quota adjustment must be between -20 and 20.";
  }
  if (
    lower > upper ||
    (lower === upper && !(band.lowerInclusive && band.upperInclusive))
  ) {
    return "Lower bound must precede upper bound; a single point must include both bounds.";
  }
  return null;
}
