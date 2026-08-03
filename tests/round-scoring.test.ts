import { describe, expect, it, vi } from "vitest";

import {
  roundScoringBlockedByDraftChanges,
  roundScoringInputSchema,
  runRoundScoringMutation,
} from "../apps/web/src/domain/round-scoring";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-08-03T00:00:00.000Z",
};

const input = {
  roundId: "60000000-0000-4000-8000-000000000001",
  expectedRoundVersion: 2,
  confirmed: true,
  operationId: "70000000-0000-4000-8000-000000000001",
};

describe("round scoring domain boundary", () => {
  it("requires explicit confirmation and a positive expected version", () => {
    expect(roundScoringInputSchema.safeParse(input).success).toBe(true);
    expect(
      roundScoringInputSchema.safeParse({ ...input, confirmed: false }).success,
    ).toBe(false);
    expect(
      roundScoringInputSchema.safeParse({ ...input, expectedRoundVersion: 0 })
        .success,
    ).toBe(false);
  });

  it("blocks opening while published detail edits are dirty", () => {
    expect(roundScoringBlockedByDraftChanges(true)).toBe(true);
    expect(roundScoringBlockedByDraftChanges(false)).toBe(false);
  });

  it("authenticates before executing the scoring transition", async () => {
    const execute = vi.fn();
    const result = await runRoundScoringMutation(input, null, {
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

  it("preserves stale transition failures for the UI to refresh", async () => {
    const result = await runRoundScoringMutation(input, null, {
      execute: vi.fn().mockRejectedValue(new MutationError("stale_version")),
      verifySession: vi.fn().mockResolvedValue(session),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("stale_version");
  });
});
