import { describe, expect, it, vi } from "vitest";

import {
  liveRoundParticipantNotPlayingInputSchema,
  runLiveRoundParticipantNotPlayingMutation,
} from "../apps/web/src/domain/live-round-participant-rsvp-correction";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const input = {
  roundId: "60000000-0000-4000-8000-000000000001",
  participantId: "80000000-0000-4000-8000-000000000001",
  expectedParticipantVersion: 4,
  expectedScoreVersion: 7,
  expectedScoreRevisionId: "81000000-0000-4000-8000-000000000001",
  confirmed: true as const,
  reason: "Player withdrew after entering a score.",
  operationId: "70000000-0000-4000-8000-000000000001",
};

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-08-03T00:00:00.000Z",
};

describe("live participant RSVP correction domain boundary", () => {
  it("requires confirmation, a bounded reason, and a positive participant version", () => {
    expect(
      liveRoundParticipantNotPlayingInputSchema.safeParse(input).success,
    ).toBe(true);
    expect(
      liveRoundParticipantNotPlayingInputSchema.safeParse({
        ...input,
        confirmed: false,
      }).success,
    ).toBe(false);
    expect(
      liveRoundParticipantNotPlayingInputSchema.safeParse({
        ...input,
        expectedParticipantVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      liveRoundParticipantNotPlayingInputSchema.safeParse({
        ...input,
        reason: "   ",
      }).success,
    ).toBe(false);
  });

  it("injects the trusted portal source and authenticates before executing", async () => {
    const execute = vi.fn().mockResolvedValue({
      roundId: input.roundId,
      groupId: "50000000-0000-4000-8000-000000000001",
      participantId: input.participantId,
      membershipId: null,
      rsvpStatus: "not_playing",
      version: 5,
      scoreInvalidated: true,
      changedAt: "2026-08-03T12:00:00.000Z",
    });
    const result = await runLiveRoundParticipantNotPlayingMutation(
      input,
      null,
      {
        source: "portal",
        execute,
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );

    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      session.userId,
      { ...input, source: "portal" },
      expect.any(String),
    );

    const unauthenticated = await runLiveRoundParticipantNotPlayingMutation(
      input,
      null,
      {
        source: "portal",
        execute,
        verifySession: vi
          .fn()
          .mockRejectedValue(new MutationError("authentication_required")),
      },
    );
    expect(unauthenticated.ok).toBe(false);
    expect(unauthenticated.ok ? null : unauthenticated.error.code).toBe(
      "authentication_required",
    );
  });

  it("preserves stale and locked failures for actionable portal handling", async () => {
    for (const code of ["stale_version", "locked"] as const) {
      const result = await runLiveRoundParticipantNotPlayingMutation(
        input,
        null,
        {
          source: "portal",
          execute: vi.fn().mockRejectedValue(new MutationError(code)),
          verifySession: vi.fn().mockResolvedValue(session),
        },
      );
      expect(result.ok).toBe(false);
      expect(result.ok ? null : result.error.code).toBe(code);
    }
  });
});
