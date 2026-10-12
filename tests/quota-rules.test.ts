import { describe, expect, it } from "vitest";

import {
  calculateQuota,
  validateParticipationMerit,
  validateAdjustmentBands,
  validatePlacementMeritRows,
  validateStandingsResetDate,
  type QuotaAdjustmentBand,
} from "../apps/web/src/domain/quota-rules";

const completeBands: readonly QuotaAdjustmentBand[] = [
  {
    adjustment: "1.25",
    lowerBound: "-100",
    lowerInclusive: true,
    upperBound: "0",
    upperInclusive: false,
  },
  {
    adjustment: "-0.75",
    lowerBound: "0",
    lowerInclusive: true,
    upperBound: "100",
    upperInclusive: true,
  },
];

describe("quota rules", () => {
  it("calculates Method A from the most recent N totals with one final exact rounding", () => {
    expect(
      calculateQuota({
        eligiblePointTotals: ["99", "10", "10", "10.01", "10.01"],
        historyLength: 4,
        method: "moving_average",
        precision: 2,
        useInitialQuota: false,
      }),
    ).toEqual({
      deactivateInitialQuota: false,
      matchedBandPosition: null,
      quota: "10.01",
      ready: true,
      sourcePointTotals: ["10.00", "10.00", "10.01", "10.01"],
    });
  });

  it("keeps and then deactivates the Method A initial-quota bootstrap", () => {
    expect(
      calculateQuota({
        eligiblePointTotals: ["20", "30", "40"],
        historyLength: 4,
        initialQuota: "18.5",
        method: "moving_average",
        precision: 1,
        useInitialQuota: true,
      }),
    ).toMatchObject({ quota: "18.5", deactivateInitialQuota: false });

    expect(
      calculateQuota({
        eligiblePointTotals: ["10", "20", "30", "40"],
        historyLength: 4,
        initialQuota: "18.5",
        method: "moving_average",
        precision: 1,
        useInitialQuota: true,
      }),
    ).toMatchObject({ quota: "25.0", deactivateInitialQuota: true });
  });

  it("averages partial Method A history when the initial bootstrap is inactive", () => {
    expect(
      calculateQuota({
        eligiblePointTotals: ["20", "30", "40"],
        historyLength: 4,
        initialQuota: "18.5",
        method: "moving_average",
        precision: 1,
        useInitialQuota: false,
      }),
    ).toMatchObject({
      quota: "30.0",
      sourcePointTotals: ["20.00", "30.00", "40.00"],
    });
  });

  it("calculates Method B from the best 10 of only the latest 20 totals", () => {
    expect(
      calculateQuota({
        eligiblePointTotals: [
          "100",
          ...Array.from({ length: 20 }, (_, index) => String(index + 1)),
        ],
        method: "best_10_of_20",
        precision: 1,
        useInitialQuota: false,
      }),
    ).toMatchObject({
      quota: "15.5",
      sourcePointTotals: [
        "20.00",
        "19.00",
        "18.00",
        "17.00",
        "16.00",
        "15.00",
        "14.00",
        "13.00",
        "12.00",
        "11.00",
      ],
    });
  });

  it("applies partial Method B history and deactivates its bootstrap at 10 totals", () => {
    expect(
      calculateQuota({
        eligiblePointTotals: ["10", "20", "30"],
        initialQuota: "17",
        method: "best_10_of_20",
        precision: 1,
        useInitialQuota: false,
      }),
    ).toMatchObject({ quota: "20.0", deactivateInitialQuota: false });
    expect(
      calculateQuota({
        eligiblePointTotals: ["10", "20", "30"],
        initialQuota: "17",
        method: "best_10_of_20",
        precision: 1,
        useInitialQuota: true,
      }),
    ).toMatchObject({ quota: "17.0", deactivateInitialQuota: false });
    expect(
      calculateQuota({
        eligiblePointTotals: Array.from({ length: 10 }, (_, index) =>
          String(index + 1),
        ),
        initialQuota: "17",
        method: "best_10_of_20",
        precision: 1,
        useInitialQuota: true,
      }),
    ).toMatchObject({ quota: "5.5", deactivateInitialQuota: true });
  });

  it("returns not ready for zero history without an initial quota", () => {
    expect(
      calculateQuota({
        eligiblePointTotals: [],
        method: "best_10_of_20",
        precision: 0,
        useInitialQuota: false,
      }),
    ).toEqual({ ready: false, reason: "initial_quota_required" });
  });

  it("calculates Method C from the prior quota and the single matching band", () => {
    expect(
      calculateQuota({
        adjustmentBands: completeBands,
        eligiblePointTotals: [],
        initialQuota: "20.00",
        method: "previous_plus_minus",
        plusMinus: "-0.01",
        precision: 1,
        useInitialQuota: true,
      }),
    ).toEqual({
      deactivateInitialQuota: true,
      matchedBandPosition: 1,
      quota: "21.3",
      ready: true,
      sourcePointTotals: [],
    });

    expect(
      calculateQuota({
        adjustmentBands: completeBands,
        eligiblePointTotals: [],
        method: "previous_plus_minus",
        plusMinus: "0",
        precision: 2,
        previousQuota: "20",
        useInitialQuota: false,
      }),
    ).toMatchObject({ matchedBandPosition: 2, quota: "19.25" });
  });

  it("rounds every Method C step before using it as the next prior quota", () => {
    const first = calculateQuota({
      adjustmentBands: completeBands,
      eligiblePointTotals: [],
      initialQuota: "20",
      method: "previous_plus_minus",
      plusMinus: "-1",
      precision: 1,
      useInitialQuota: true,
    });
    expect(first).toMatchObject({
      quota: "21.3",
      deactivateInitialQuota: true,
    });
    if (!first.ready)
      throw new Error("Expected first Method C result to be ready");

    expect(
      calculateQuota({
        adjustmentBands: completeBands,
        eligiblePointTotals: [],
        method: "previous_plus_minus",
        plusMinus: "-1",
        precision: 1,
        previousQuota: first.quota,
        useInitialQuota: false,
      }),
    ).toMatchObject({ quota: "22.6", deactivateInitialQuota: false });
  });

  it.each([
    { expected: "11", precision: 0 as const, totals: ["10", "10", "11", "11"] },
    {
      expected: "10.1",
      precision: 1 as const,
      totals: ["10", "10", "10.1", "10.1"],
    },
    {
      expected: "10.01",
      precision: 2 as const,
      totals: ["10", "10", "10.01", "10.01"],
    },
  ])(
    "rounds an exact positive half away from zero at precision $precision",
    ({ expected, precision, totals }) => {
      expect(
        calculateQuota({
          eligiblePointTotals: totals,
          historyLength: 4,
          method: "moving_average",
          precision,
          useInitialQuota: false,
        }),
      ).toMatchObject({ quota: expected });
    },
  );

  it("rejects incomplete, overlapping, and out-of-range Method C policies", () => {
    expect(() => validateAdjustmentBands(completeBands.slice(1))).toThrow(
      "include -100",
    );
    expect(() =>
      validateAdjustmentBands([
        { ...completeBands[0]!, upperInclusive: true },
        completeBands[1]!,
      ]),
    ).toThrow("in one band only");
    expect(() =>
      calculateQuota({
        adjustmentBands: completeBands,
        eligiblePointTotals: [],
        method: "previous_plus_minus",
        plusMinus: "-1",
        precision: 2,
        previousQuota: "99.50",
        useInitialQuota: false,
      }),
    ).toThrow("Enter calculated quota from 0 to 100.");
  });

  it("validates history length, decimal scale, and precision boundaries", () => {
    expect(() =>
      calculateQuota({
        eligiblePointTotals: ["10"],
        historyLength: 3,
        method: "moving_average",
        precision: 2,
        useInitialQuota: false,
      }),
    ).toThrow("from 4 through 20");
    expect(() =>
      calculateQuota({
        eligiblePointTotals: ["10.001"],
        method: "best_10_of_20",
        precision: 2,
        useInitialQuota: false,
      }),
    ).toThrow("up to 2 decimal places");
  });

  it("validates merit boundaries, ordered placement rows, and local reset dates", () => {
    expect(() => validateParticipationMerit("0")).not.toThrow();
    expect(() => validateParticipationMerit("100.00")).not.toThrow();
    expect(() => validateParticipationMerit("100.001")).toThrow();
    expect(() => validateParticipationMerit("-0.01")).toThrow();

    expect(() =>
      validatePlacementMeritRows([
        { rank: 1, points: "10" },
        { rank: 3, points: "4.00" },
      ]),
    ).not.toThrow();
    expect(() =>
      validatePlacementMeritRows([
        { rank: 2, points: "5" },
        { rank: 1, points: "10" },
      ]),
    ).toThrow("each higher than the one above");
    expect(() =>
      validatePlacementMeritRows([{ rank: 1, points: "500.01" }]),
    ).toThrow();
    for (const points of ["-0", "-00", "-00.00"]) {
      expect(() => validatePlacementMeritRows([{ rank: 1, points }])).toThrow(
        "instead of -0",
      );
    }

    expect(() => validateStandingsResetDate(null)).not.toThrow();
    expect(() => validateStandingsResetDate("2026-02-28")).not.toThrow();
    expect(() => validateStandingsResetDate("2026-02-30")).toThrow();
  });
});
