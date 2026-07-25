import { describe, expect, it } from "vitest";

import { roundHalfAwayFromZero } from "../apps/web/src/domain/exact-decimal";

describe("roundHalfAwayFromZero", () => {
  it.each([
    ["1.005", 2, "1.01"],
    ["-1.005", 2, "-1.01"],
    ["2.6749", 2, "2.67"],
    ["2.675", 2, "2.68"],
    ["-2.675", 2, "-2.68"],
    ["999.995", 2, "1000.00"],
    ["12.5", 0, "13"],
    ["-12.5", 0, "-13"],
    ["0.004", 2, "0.00"],
    ["-0.004", 2, "0.00"],
  ] as const)("rounds %s at scale %i to %s", (input, scale, expected) => {
    expect(roundHalfAwayFromZero(input, scale)).toBe(expected);
  });

  it("rejects exponent notation before binary arithmetic can enter", () => {
    expect(() => roundHalfAwayFromZero("1e-3", 2)).toThrowError(
      "Decimal input must use plain base-10 notation",
    );
  });
});
