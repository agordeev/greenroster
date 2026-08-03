import { describe, expect, it, vi } from "vitest";

import {
  roundCancellationInputSchema,
  roundCancellationBlockedByDraftChanges,
  runRoundCancellationMutation,
} from "../apps/web/src/domain/round-cancellation";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-08-03T00:00:00.000Z",
};

const input = {
  roundId: "60000000-0000-4000-8000-000000000001",
  reason: "Course closed for weather",
  expectedRoundVersion: 2,
  operationId: "70000000-0000-4000-8000-000000000001",
};

describe("round cancellation domain boundary", () => {
  it("blocks cancellation while a draft has unsaved changes", () => {
    expect(roundCancellationBlockedByDraftChanges("draft", true)).toBe(true);
    expect(roundCancellationBlockedByDraftChanges("draft", false)).toBe(false);
    expect(roundCancellationBlockedByDraftChanges("published", true)).toBe(
      false,
    );
  });
  it("requires a bounded reason and server version", () => {
    expect(roundCancellationInputSchema.safeParse(input).success).toBe(true);
    expect(
      roundCancellationInputSchema.safeParse({
        ...input,
        reason: "",
      }).success,
    ).toBe(false);
    expect(
      roundCancellationInputSchema.safeParse({
        ...input,
        expectedRoundVersion: 0,
      }).success,
    ).toBe(false);
  });

  it("authenticates before executing the cancellation", async () => {
    const execute = vi.fn();
    const result = await runRoundCancellationMutation(input, null, {
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

  it("preserves stale cancellation failures", async () => {
    const result = await runRoundCancellationMutation(input, null, {
      execute: vi.fn().mockRejectedValue(new MutationError("stale_version")),
      verifySession: vi.fn().mockResolvedValue(session),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("stale_version");
  });
});
