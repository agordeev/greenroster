import { describe, expect, it, vi } from "vitest";

import {
  shouldAllowDirtyNavigation,
  validateBandFormRows,
} from "../apps/web/src/lib/groups/quota-settings-form-rules";

describe("quota settings form rules", () => {
  it("associates a Method C gap with the later row and a page summary", () => {
    expect(
      validateBandFormRows([
        {
          adjustment: "1",
          lowerBound: "-100",
          lowerInclusive: true,
          upperBound: "0",
          upperInclusive: false,
        },
        {
          adjustment: "-1",
          lowerBound: "1",
          lowerInclusive: true,
          upperBound: "100",
          upperInclusive: true,
        },
      ]),
    ).toEqual({
      rowErrors: [
        null,
        "Band 1 and band 2 have a gap or overlap at their shared boundary.",
      ],
      summary: "Fix the highlighted gap or overlap between bands.",
    });
  });

  it("accepts exactly one owner for a shared boundary", () => {
    expect(
      validateBandFormRows([
        {
          adjustment: "1",
          lowerBound: "-100",
          lowerInclusive: true,
          upperBound: "0",
          upperInclusive: false,
        },
        {
          adjustment: "-1",
          lowerBound: "0",
          lowerInclusive: true,
          upperBound: "100",
          upperInclusive: true,
        },
      ]).summary,
    ).toBeNull();
  });

  it("associates missing endpoint inclusivity with the endpoint row", () => {
    expect(
      validateBandFormRows([
        {
          adjustment: "0",
          lowerBound: "-100",
          lowerInclusive: false,
          upperBound: "100",
          upperInclusive: true,
        },
      ]),
    ).toEqual({
      rowErrors: ["The first band must include -100."],
      summary: "Fix the highlighted gap or overlap between bands.",
    });
  });

  it("confirms only dirty in-app navigation", () => {
    const confirmDeparture = vi.fn(() => false);
    expect(shouldAllowDirtyNavigation(false, confirmDeparture)).toBe(true);
    expect(confirmDeparture).not.toHaveBeenCalled();
    expect(shouldAllowDirtyNavigation(true, confirmDeparture)).toBe(false);
    expect(confirmDeparture).toHaveBeenCalledOnce();
  });
});
