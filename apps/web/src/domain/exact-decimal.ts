export type DecimalScale = 0 | 1 | 2;

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/**
 * Rounds a base-10 string without ever converting it to a binary floating-point
 * number. Exact halves increase the absolute magnitude, including negatives.
 */
export function roundHalfAwayFromZero(
  input: string,
  scale: DecimalScale,
): string {
  const match = DECIMAL_PATTERN.exec(input.trim());

  if (!match) {
    throw new Error("Decimal input must use plain base-10 notation");
  }

  const [, sign, integerPart, fractionPart = ""] = match;
  const keptFraction = fractionPart.slice(0, scale).padEnd(scale, "0");
  const discardedFraction = fractionPart.slice(scale);
  const unscaledInput = `${integerPart}${keptFraction}`.replace(
    /^0+(?=\d)/,
    "",
  );
  let roundedMagnitude = BigInt(unscaledInput);

  if (discardedFraction[0] >= "5") {
    roundedMagnitude += BigInt(1);
  }

  const negative = sign === "-" && roundedMagnitude !== BigInt(0);
  const paddedMagnitude = roundedMagnitude.toString().padStart(scale + 1, "0");

  if (scale === 0) {
    return `${negative ? "-" : ""}${paddedMagnitude}`;
  }

  const splitAt = paddedMagnitude.length - scale;
  const integer = paddedMagnitude.slice(0, splitAt);
  const fraction = paddedMagnitude.slice(splitAt);

  return `${negative ? "-" : ""}${integer}.${fraction}`;
}
