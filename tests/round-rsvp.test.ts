import { describe, expect, it, vi } from "vitest";

import {
  roundRsvpInputSchema,
  runRoundRsvpMutation,
} from "../apps/web/src/domain/round-rsvp";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-08-03T00:00:00.000Z",
};

const input = {
  roundId: "60000000-0000-4000-8000-000000000001",
  rsvpStatus: "playing" as const,
  expectedParticipantVersion: 1,
  operationId: "70000000-0000-4000-8000-000000000001",
};

describe("round RSVP domain boundary", () => {
  it("accepts only supported states, sources, and versions", () => {
    expect(roundRsvpInputSchema.safeParse(input).success).toBe(true);
    expect(
      roundRsvpInputSchema.safeParse({ ...input, source: "portal" }).success,
    ).toBe(false);
    expect(
      roundRsvpInputSchema.safeParse({
        ...input,
        expectedParticipantVersion: 0,
      }).success,
    ).toBe(false);
  });

  it("authenticates before executing the response", async () => {
    const execute = vi.fn();
    const result = await runRoundRsvpMutation(input, null, {
      source: "member_web",
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

  it("injects the trusted dependency source instead of reading a client field", async () => {
    const execute = vi.fn().mockResolvedValue({
      roundId: input.roundId,
      groupId: "50000000-0000-4000-8000-000000000001",
      participantId: "80000000-0000-4000-8000-000000000001",
      membershipId: "40000000-0000-4000-8000-000000000001",
      rsvpStatus: "playing",
      version: 2,
      changedAt: "2026-08-03T12:00:00.000Z",
    });
    const result = await runRoundRsvpMutation(input, null, {
      source: "member_web",
      execute,
      verifySession: vi.fn().mockResolvedValue(session),
    });

    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      session.userId,
      { ...input, source: "member_web" },
      expect.any(String),
    );
  });

  it("preserves deadline and stale-version failures", async () => {
    const result = await runRoundRsvpMutation(input, null, {
      source: "member_web",
      execute: vi.fn().mockRejectedValue(new MutationError("locked")),
      verifySession: vi.fn().mockResolvedValue(session),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("locked");
  });
});
