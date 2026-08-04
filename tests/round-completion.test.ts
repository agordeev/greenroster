import { describe, expect, it, vi } from "vitest";

import {
  roundCompletionInputSchema,
  roundCompletionPreviewInputSchema,
  roundReopenInputSchema,
  runRoundCompletionMutation,
  runRoundCompletionPreview,
  runRoundReopenMutation,
} from "../apps/web/src/domain/round-completion";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-08-04T00:00:00.000Z",
};

const previewInput = {
  roundId: "60000000-0000-4000-8000-000000000001",
  groupId: "50000000-0000-4000-8000-000000000001",
};

const completionInput = {
  roundId: previewInput.roundId,
  expectedRoundVersion: 3,
  confirmed: true as const,
  operationId: "70000000-0000-4000-8000-000000000001",
};

describe("round completion domain boundary", () => {
  it("keeps preview and mutation payloads closed and server-versioned", () => {
    expect(
      roundCompletionPreviewInputSchema.safeParse(previewInput).success,
    ).toBe(true);
    expect(
      roundCompletionPreviewInputSchema.safeParse({
        ...previewInput,
        actorUserId: session.userId,
      }).success,
    ).toBe(false);
    expect(roundCompletionInputSchema.safeParse(completionInput).success).toBe(
      true,
    );
    expect(
      roundCompletionInputSchema.safeParse({
        ...completionInput,
        expectedRoundVersion: 0,
      }).success,
    ).toBe(false);
  });

  it("requires a bounded reason and explicit confirmation for reopen", () => {
    expect(
      roundReopenInputSchema.safeParse({
        ...completionInput,
        reason: "Correct an authoritative score",
      }).success,
    ).toBe(true);
    expect(
      roundReopenInputSchema.safeParse({
        ...completionInput,
        reason: "",
      }).success,
    ).toBe(false);
    expect(
      roundReopenInputSchema.safeParse({
        ...completionInput,
        reason: "Correct an authoritative score",
        confirmed: false,
      }).success,
    ).toBe(false);
  });

  it("authenticates preview before invoking the protected reader", async () => {
    const execute = vi.fn();
    const result = await runRoundCompletionPreview(previewInput, null, {
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

  it("preserves stale completion and reopen failures", async () => {
    const completionResult = await runRoundCompletionMutation(
      completionInput,
      null,
      {
        execute: vi.fn().mockRejectedValue(new MutationError("stale_version")),
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );
    expect(completionResult.ok).toBe(false);
    expect(completionResult.ok ? null : completionResult.error.code).toBe(
      "stale_version",
    );

    const reopenResult = await runRoundReopenMutation(
      {
        ...completionInput,
        reason: "Correct an authoritative score",
      },
      null,
      {
        execute: vi.fn().mockRejectedValue(new MutationError("locked")),
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );
    expect(reopenResult.ok).toBe(false);
    expect(reopenResult.ok ? null : reopenResult.error.code).toBe("locked");
  });
});
