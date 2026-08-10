import { describe, expect, it, vi } from "vitest";

import {
  roundHoleScoreInputSchema,
  runRoundHoleScoreMutation,
} from "../apps/web/src/domain/round-hole-scorecard";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const input = {
  participantId: "d5000000-0000-4000-8000-000000000001",
  holeNumber: 1,
  changedFields: {
    strokes: 4,
    putts: 2,
    fairway_hit: true,
    green_in_regulation: false,
    sand_save: null,
    hole_comment: "Good start",
  },
  expectedVersion: 0,
  deviceOperationId: "d6000000-0000-4000-8000-000000000001",
  clientChangedAt: "2026-08-10T00:00:00.000Z",
  operationId: "d8000000-0000-4000-8000-000000000001",
};

describe("hole scorecard domain boundary", () => {
  it("accepts documented values and rejects unsupported ranges", () => {
    expect(roundHoleScoreInputSchema.safeParse(input).success).toBe(true);
    expect(
      roundHoleScoreInputSchema.safeParse({
        ...input,
        holeNumber: 19,
      }).success,
    ).toBe(false);
    expect(
      roundHoleScoreInputSchema.safeParse({
        ...input,
        changedFields: { strokes: 31 },
      }).success,
    ).toBe(false);
    expect(
      roundHoleScoreInputSchema.safeParse({
        ...input,
        changedFields: { penalty_strokes: 1 },
      }).success,
    ).toBe(false);
  });

  it("does not execute when the session cannot be verified", async () => {
    const execute = vi.fn();
    const result = await runRoundHoleScoreMutation(input, null, {
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
});
