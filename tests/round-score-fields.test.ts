import { describe, expect, it, vi } from "vitest";

import {
  roundScoreFieldsInputSchema,
  runRoundScoreFieldsMutation,
} from "../apps/web/src/domain/round-score-fields";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const input = {
  roundId: "60000000-0000-4000-8000-000000000001",
  enableGrossScore: true,
  enableNetScore: true,
  expectedRoundVersion: 2,
  operationId: "70000000-0000-4000-8000-000000000001",
};

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-08-03T00:00:00.000Z",
};

describe("round score-field domain boundary", () => {
  it("accepts both optional final totals and rejects unknown fields", () => {
    expect(roundScoreFieldsInputSchema.safeParse(input).success).toBe(true);
    expect(
      roundScoreFieldsInputSchema.safeParse({
        ...input,
        enableNetScore: false,
      }).success,
    ).toBe(true);
    expect(
      roundScoreFieldsInputSchema.safeParse({
        ...input,
        format: "individual_gross",
      }).success,
    ).toBe(false);
  });

  it("authenticates before executing the capability mutation", async () => {
    const execute = vi.fn();
    const result = await runRoundScoreFieldsMutation(input, null, {
      execute,
      verifySession: vi
        .fn()
        .mockRejectedValue(new MutationError("authentication_required")),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe(
      "authentication_required",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves stale draft versions for a refresh", async () => {
    const result = await runRoundScoreFieldsMutation(input, null, {
      execute: vi.fn().mockRejectedValue(new MutationError("stale_version")),
      verifySession: vi.fn().mockResolvedValue(session),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("stale_version");
  });
});
