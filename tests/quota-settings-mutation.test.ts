import { describe, expect, it, vi } from "vitest";

import {
  runQuotaSettingsMutation,
  type QuotaSettingsResult,
} from "../apps/web/src/lib/groups/quota-settings";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-07-26T00:00:00.000Z",
};

const input = {
  bands: [],
  expectedSettingsVersion: 0,
  historyLength: 10,
  method: "moving_average" as const,
  operationId: "30000000-0000-4000-8000-000000000001",
  precision: 1 as const,
  reason: "  Establish the initial quota policy  ",
  roundingRule: "half_away_from_zero" as const,
};

const result: QuotaSettingsResult = {
  groupId: "50000000-0000-4000-8000-000000000001",
  historyLength: 10,
  method: "moving_average",
  precision: 1,
  roundingRule: "half_away_from_zero",
  settingsVersion: 1,
};

const completeBands = [
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
] as const;

describe("quota settings mutation boundary", () => {
  it("binds the verified actor, trims reason, and preserves correlation", async () => {
    const executeConfigure = vi.fn().mockResolvedValue(result);

    const response = await runQuotaSettingsMutation(
      input,
      "20000000-0000-4000-8000-000000000001",
      {
        executeConfigure,
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );

    expect(response).toEqual({
      ok: true,
      data: result,
      correlationId: "20000000-0000-4000-8000-000000000001",
    });
    expect(executeConfigure).toHaveBeenCalledWith(
      session.userId,
      { ...input, reason: "Establish the initial quota policy" },
      "20000000-0000-4000-8000-000000000001",
    );
  });

  it("authenticates before parsing untrusted settings", async () => {
    const executeConfigure = vi.fn();
    const response = await runQuotaSettingsMutation(null, null, {
      executeConfigure,
      verifySession: vi
        .fn()
        .mockRejectedValue(new MutationError("authentication_required")),
    });

    expect(response.ok ? null : response.error.code).toBe(
      "authentication_required",
    );
    expect(executeConfigure).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...input, historyLength: 3 }, "historyLength"],
    [{ ...input, precision: 3 }, "precision"],
    [{ ...input, expectedSettingsVersion: -1 }, "expectedSettingsVersion"],
    [{ ...input, reason: " " }, "reason"],
    [{ ...input, roundingRule: "bankers" }, "roundingRule"],
    [{ ...input, groupId: "50000000-0000-4000-8000-000000000001" }, null],
  ])(
    "rejects invalid or client-authority settings fields (%s)",
    async (invalidInput, field) => {
      const executeConfigure = vi.fn();
      const response = await runQuotaSettingsMutation(invalidInput, null, {
        executeConfigure,
        verifySession: vi.fn().mockResolvedValue(session),
      });

      expect(response.ok).toBe(false);
      expect(response.ok ? null : response.error.code).toBe("validation");
      if (field) {
        expect(response.ok ? null : response.error.fieldErrors).toHaveProperty(
          field,
        );
      }
      expect(executeConfigure).not.toHaveBeenCalled();
    },
  );

  it("requires method-specific fields and rejects non-empty A/B bands", async () => {
    const executeConfigure = vi.fn();
    const cases = [
      { ...input, bands: [{ unexpected: true }] },
      { ...input, historyLength: null },
      {
        ...input,
        bands: [],
        historyLength: 4,
        method: "best_10_of_20" as const,
      },
      {
        ...input,
        bands: [],
        historyLength: null,
        method: "previous_plus_minus" as const,
      },
    ];

    for (const invalidInput of cases) {
      const response = await runQuotaSettingsMutation(invalidInput, null, {
        executeConfigure,
        verifySession: vi.fn().mockResolvedValue(session),
      });
      expect(response.ok).toBe(false);
      expect(response.ok ? null : response.error.code).toBe("validation");
    }
    expect(executeConfigure).not.toHaveBeenCalled();
  });

  it("validates a complete Method C band ledger before executing", async () => {
    const executeConfigure = vi.fn().mockResolvedValue({
      ...result,
      historyLength: null,
      method: "previous_plus_minus" as const,
    });
    const methodCInput = {
      ...input,
      bands: completeBands,
      historyLength: null,
      method: "previous_plus_minus" as const,
    };

    const response = await runQuotaSettingsMutation(methodCInput, null, {
      executeConfigure,
      verifySession: vi.fn().mockResolvedValue(session),
    });

    expect(response.ok).toBe(true);
    const normalizedInput = {
      ...methodCInput,
      reason: "Establish the initial quota policy",
    };
    expect(executeConfigure).toHaveBeenCalledWith(
      session.userId,
      normalizedInput,
      expect.any(String),
    );
  });

  it.each([
    [
      [
        {
          adjustment: "1",
          lowerBound: "-100",
          lowerInclusive: true,
          upperBound: "0",
          upperInclusive: true,
        },
        {
          adjustment: "-1",
          lowerBound: "0",
          lowerInclusive: true,
          upperBound: "100",
          upperInclusive: true,
        },
      ],
      "overlap",
    ],
    [
      [
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
      ],
      "gap",
    ],
  ])("rejects Method C %s ledgers", async (bands) => {
    const executeConfigure = vi.fn();
    const response = await runQuotaSettingsMutation(
      {
        ...input,
        bands,
        historyLength: null,
        method: "previous_plus_minus" as const,
      },
      null,
      {
        executeConfigure,
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );

    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.error.fieldErrors).toHaveProperty(
      "bands",
    );
    expect(executeConfigure).not.toHaveBeenCalled();
  });
});
