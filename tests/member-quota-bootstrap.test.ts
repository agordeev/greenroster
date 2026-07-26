import { describe, expect, it } from "vitest";

import { projectMemberQuotaBootstrap } from "../apps/web/src/domain/member-quota-bootstrap";

describe("member quota bootstrap projection", () => {
  it("preserves Method A initial freeze until N seed totals", () => {
    expect(
      projectMemberQuotaBootstrap({
        adjustmentBands: [],
        historyLength: 4,
        initialQuota: "18.5",
        method: "moving_average",
        precision: 1,
        seedTotals: ["20", "30", "40"],
        useInitialQuota: true,
      }),
    ).toEqual({
      quota: "18.5",
      ready: true,
      source: { seedPositions: [], type: "initial" },
      usesInitialQuota: true,
    });
  });

  it("projects Method B from ordered seeds with exact source positions", () => {
    expect(
      projectMemberQuotaBootstrap({
        adjustmentBands: [],
        historyLength: null,
        initialQuota: null,
        method: "best_10_of_20",
        precision: 1,
        seedTotals: Array.from({ length: 20 }, (_, index) => String(index + 1)),
        useInitialQuota: false,
      }),
    ).toEqual({
      quota: "15.5",
      ready: true,
      source: {
        seedPositions: [20, 19, 18, 17, 16, 15, 14, 13, 12, 11],
        type: "seed_history",
      },
      usesInitialQuota: false,
    });
  });

  it("uses initial quota—not seed totals—as Method C current chain state", () => {
    expect(
      projectMemberQuotaBootstrap({
        adjustmentBands: [],
        historyLength: null,
        initialQuota: "20",
        method: "previous_plus_minus",
        precision: 2,
        seedTotals: ["30", "31"],
        useInitialQuota: true,
      }),
    ).toEqual({
      quota: "20.00",
      ready: true,
      source: { seedPositions: [], type: "initial" },
      usesInitialQuota: true,
    });
  });

  it("rejects invalid seed and initial values before method projection", () => {
    const base = {
      adjustmentBands: [],
      historyLength: 10,
      initialQuota: "20",
      method: "moving_average" as const,
      precision: 1 as const,
      seedTotals: [] as readonly string[],
      useInitialQuota: true,
    };
    expect(() =>
      projectMemberQuotaBootstrap({
        ...base,
        seedTotals: Array.from({ length: 21 }, () => "20"),
      }),
    ).toThrow("at most 20");
    expect(() =>
      projectMemberQuotaBootstrap({
        ...base,
        initialQuota: null,
      }),
    ).toThrow("requires an initial quota");
    expect(() =>
      projectMemberQuotaBootstrap({
        ...base,
        initialQuota: "20.05",
      }),
    ).toThrow("exceeds the group precision");
    expect(() =>
      projectMemberQuotaBootstrap({
        ...base,
        adjustmentBands: [],
        historyLength: null,
        method: "previous_plus_minus",
        precision: 2,
        seedTotals: ["20.001"],
      }),
    ).toThrow("at most 2 decimal places");
    expect(() =>
      projectMemberQuotaBootstrap({
        ...base,
        initialQuota: "100.01",
        precision: 2,
      }),
    ).toThrow("between 0 and 100");
  });
});
