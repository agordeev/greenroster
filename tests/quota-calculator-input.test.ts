import { describe, expect, it } from "vitest";

import {
  calculateFromForm,
  defaultQuotaCalculatorForm,
  parseCalculatorQuery,
  toCalculatorQuery,
  toQuotaInput,
  type QuotaCalculatorForm,
} from "../apps/web/src/domain/quota-calculator-input";
import { calculateQuota } from "../apps/web/src/domain/quota-rules";

const oneToTwenty = Array.from({ length: 20 }, (_, index) => String(index + 1));

function form(overrides: Partial<QuotaCalculatorForm>): QuotaCalculatorForm {
  return { ...defaultQuotaCalculatorForm, ...overrides };
}

describe("quota calculator input", () => {
  it("gives the portal's moving average for the same point totals", () => {
    const entered = form({ points: oneToTwenty, roundsCounted: "4" });
    const portal = calculateQuota({
      eligiblePointTotals: oneToTwenty,
      historyLength: 4,
      method: "moving_average",
      precision: 1,
      useInitialQuota: false,
    });

    expect(calculateQuota(toQuotaInput(entered))).toEqual(portal);
    expect(calculateFromForm(entered)).toMatchObject({
      status: "ready",
      quota: "18.5",
      countedPoints: ["17", "18", "19", "20"],
      usedStartingQuota: false,
    });
  });

  it("gives the portal's Best 10 of 20 for the same point totals", () => {
    const entered = form({ method: "best_10_of_20", points: oneToTwenty });
    const portal = calculateQuota({
      eligiblePointTotals: oneToTwenty,
      method: "best_10_of_20",
      precision: 1,
      useInitialQuota: false,
    });

    expect(calculateQuota(toQuotaInput(entered))).toEqual(portal);
    expect(calculateFromForm(entered)).toMatchObject({
      status: "ready",
      quota: "15.5",
      countedPoints: [
        "20",
        "19",
        "18",
        "17",
        "16",
        "15",
        "14",
        "13",
        "12",
        "11",
      ],
    });
  });

  it("skips blank rounds and leaves the rounds counted out of Best 10 of 20", () => {
    expect(
      toQuotaInput(
        form({
          method: "best_10_of_20",
          points: ["20", " ", "", " 22.5 "],
          roundsCounted: "10",
        }),
      ),
    ).toEqual({
      eligiblePointTotals: ["20", "22.5"],
      initialQuota: null,
      method: "best_10_of_20",
      precision: 1,
      useInitialQuota: false,
    });
  });

  it("holds a starting quota until enough rounds build up", () => {
    expect(
      calculateFromForm(
        form({ points: ["20", "30", "40"], startingQuota: "18.5" }),
      ),
    ).toMatchObject({
      status: "ready",
      quota: "18.5",
      countedPoints: [],
      roundsEntered: 3,
      roundsNeeded: 10,
      usedStartingQuota: true,
    });
    expect(
      calculateFromForm(
        form({
          points: ["20", "30", "40", "50"],
          roundsCounted: "4",
          startingQuota: "18.5",
        }),
      ),
    ).toMatchObject({ quota: "35.0", usedStartingQuota: false });
  });

  it("averages the rounds entered when there is no starting quota", () => {
    expect(calculateFromForm(form({ points: ["20", "25"] }))).toMatchObject({
      status: "ready",
      quota: "22.5",
      roundsEntered: 2,
      usedStartingQuota: false,
    });
  });

  it("asks for a starting quota when nothing is entered", () => {
    expect(calculateFromForm(form({ points: ["", ""] }))).toEqual({
      status: "starting_quota_needed",
    });
  });

  it("passes on the messages the quota rules write", () => {
    expect(calculateFromForm(form({ points: ["twenty"] }))).toEqual({
      status: "invalid",
      message: "Enter point total as a number with up to 2 decimal places.",
    });
    expect(
      calculateFromForm(form({ points: ["20"], roundsCounted: "" })),
    ).toEqual({
      status: "invalid",
      message: "Enter a whole number from 4 through 20.",
    });
  });

  it("works out the latest round's plus/minus against the new quota", () => {
    const latest = (points: readonly string[]) => {
      const outcome = calculateFromForm(form({ points, roundsCounted: "4" }));
      return outcome.status === "ready" ? outcome.latestRound : null;
    };

    expect(latest(["20", "22", "25", "27"])).toEqual({
      plusMinus: "+3.5",
      points: "27",
    });
    expect(latest(["27", "25", "22", "20.5"])).toEqual({
      plusMinus: "−3.1",
      points: "20.5",
    });
    expect(latest(["24", "24", "24", "24"])).toEqual({
      plusMinus: "0",
      points: "24",
    });
  });

  it("round-trips a shared address", () => {
    const shared = form({
      method: "moving_average",
      points: ["20", "22.5", "25"],
      roundsCounted: "6",
      startingQuota: "21",
    });
    const query = toCalculatorQuery(shared);

    expect(query).toBe(
      "method=moving_average&rounds=6&points=20,22.5,25&start=21",
    );
    expect(parseCalculatorQuery(`?${query}`)).toEqual(shared);
  });

  it("falls back to the defaults for an address it does not understand", () => {
    expect(parseCalculatorQuery("?method=previous_plus_minus")).toEqual(
      defaultQuotaCalculatorForm,
    );
    expect(
      parseCalculatorQuery(`?points=${Array(30).fill("20").join(",")}`).points,
    ).toHaveLength(20);
  });
});
