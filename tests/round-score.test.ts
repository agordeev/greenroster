import { describe, expect, it, vi } from "vitest";

import {
  roundScoreChangedFieldsSchema,
  roundScoreInputSchema,
  runRoundScoreMutation,
} from "../apps/web/src/domain/round-score";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const input = {
  participantId: "60000000-0000-4000-8000-000000000001",
  changedFields: { golf_points: 20 },
  expectedScoreVersion: 0,
  deviceOperationId: "70000000-0000-4000-8000-000000000001",
  reason: null,
  clientChangedAt: "2026-08-03T12:00:00.000Z",
  operationId: "80000000-0000-4000-8000-000000000001",
};

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-08-03T00:00:00.000Z",
};

describe("round score domain boundary", () => {
  it("accepts explicit authored values and nullable clears", () => {
    expect(
      roundScoreChangedFieldsSchema.safeParse({ golf_points: 0 }).success,
    ).toBe(true);
    expect(
      roundScoreChangedFieldsSchema.safeParse({ gross_score: null }).success,
    ).toBe(true);
    expect(
      roundScoreChangedFieldsSchema.safeParse({ plus_minus: 1 }).success,
    ).toBe(false);
    expect(
      roundScoreChangedFieldsSchema.safeParse({ golf_points: 100.01 }).success,
    ).toBe(false);
    expect(
      roundScoreChangedFieldsSchema.safeParse({ gross_score: 72.5 }).success,
    ).toBe(false);
  });

  it("requires an idempotency context and rejects malformed score input", () => {
    expect(roundScoreInputSchema.safeParse(input).success).toBe(true);
    expect(
      roundScoreInputSchema.safeParse({ ...input, expectedScoreVersion: -1 })
        .success,
    ).toBe(false);
    expect(
      roundScoreInputSchema.safeParse({
        ...input,
        clientChangedAt: "not-a-date",
      }).success,
    ).toBe(false);
    expect(
      roundScoreInputSchema.safeParse({
        ...input,
        expectedScoreVersion: 1,
        reason: "   ",
      }).success,
    ).toBe(true);
  });

  it("injects the server-selected source channel", async () => {
    const execute = vi.fn().mockResolvedValue({});
    await runRoundScoreMutation(input, null, {
      source: "portal",
      execute,
      verifySession: vi.fn().mockResolvedValue(session),
    });
    expect(execute).toHaveBeenCalledWith(
      session.userId,
      expect.objectContaining({ source: "portal" }),
      expect.any(String),
    );
  });

  it("authenticates before executing the score mutation", async () => {
    const execute = vi.fn();
    const result = await runRoundScoreMutation(input, null, {
      source: "portal",
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

  it("preserves stale-version failures for deliberate re-entry", async () => {
    const result = await runRoundScoreMutation(input, null, {
      source: "portal",
      execute: vi.fn().mockRejectedValue(new MutationError("stale_version")),
      verifySession: vi.fn().mockResolvedValue(session),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("stale_version");
  });

  it("preserves the authorized current score on a stale failure", async () => {
    const currentScore = {
      participantId: input.participantId,
      version: 2,
      revisionId: "63000000-0000-4000-8000-000000000001",
      grossScore: null,
      netScore: null,
      golfPoints: "18.00",
      manualMerit: null,
      plusMinus: "5.70",
      rankingValue: "5.70",
      changedAt: "2026-08-03T12:00:01.000Z",
    };
    const result = await runRoundScoreMutation(input, null, {
      source: "portal",
      execute: vi.fn().mockRejectedValue(
        new MutationError("stale_version", {
          details: { currentScore },
        }),
      ),
      verifySession: vi.fn().mockResolvedValue(session),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.details).toEqual({ currentScore });
  });
});
