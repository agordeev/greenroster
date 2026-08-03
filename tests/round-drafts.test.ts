import { describe, expect, it, vi } from "vitest";

import {
  isLocalDateTimeOrBlank,
  toLocalDateTimeInput,
} from "../apps/web/src/domain/round-drafts";
import {
  runCreateRoundDraftMutation,
  selectRoundDraft,
  runUpdateRoundDraftMutation,
} from "../apps/web/src/lib/rounds/round-drafts";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-08-03T00:00:00.000Z",
};

const createInput = {
  description: "  August round  ",
  scheduledLocal: "2026-08-15T09:30",
  venue: "  North Course  ",
  roundUrl: "https://example.com/round",
  notes: "  Bring a cart.  ",
  notesVisibleToPlayers: true,
  rsvpDeadlineLocal: "2026-08-14T09:30",
  format: "individual_net" as const,
  operationId: "30000000-0000-4000-8000-000000000001",
};

const round = {
  roundId: "40000000-0000-4000-8000-000000000001",
  groupId: "50000000-0000-4000-8000-000000000001",
  groupTimeZone: "America/New_York",
  description: "August round",
  scheduledAt: "2026-08-15T13:30:00.000Z",
  venue: "North Course",
  roundUrl: "https://example.com/round",
  notes: "Bring a cart.",
  notesVisibleToPlayers: true,
  rsvpDeadlineAt: "2026-08-14T13:30:00.000Z",
  format: "individual_net" as const,
  state: "draft" as const,
  version: 1,
};

describe("round draft domain boundary", () => {
  it("authenticates before validating and trims accepted fields", async () => {
    const execute = vi.fn().mockResolvedValue(round);
    const response = await runCreateRoundDraftMutation(createInput, null, {
      execute,
      verifySession: vi.fn().mockResolvedValue(session),
    });

    expect(response).toEqual({
      ok: true,
      data: round,
      correlationId: expect.any(String),
    });
    expect(execute).toHaveBeenCalledWith(
      session.userId,
      {
        ...createInput,
        description: "August round",
        venue: "North Course",
        notes: "Bring a cart.",
      },
      expect.any(String),
    );
  });

  it("rejects malformed local dates and attacker-supplied authority fields", async () => {
    const execute = vi.fn();
    const response = await runCreateRoundDraftMutation(
      {
        ...createInput,
        scheduledLocal: "2026-02-30T09:30",
        groupId: "90000000-0000-4000-8000-000000000001",
      },
      null,
      { execute, verifySession: vi.fn().mockResolvedValue(session) },
    );

    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.error.code).toBe("validation");
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves stale-version failures for edits", async () => {
    const response = await runUpdateRoundDraftMutation(
      {
        ...createInput,
        roundId: round.roundId,
        expectedRoundVersion: 1,
      },
      null,
      {
        execute: vi.fn().mockRejectedValue(new MutationError("stale_version")),
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );

    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.error.code).toBe("stale_version");
  });

  it("accepts incomplete draft values while validating datetime-local shape", () => {
    expect(isLocalDateTimeOrBlank("")).toBe(true);
    expect(isLocalDateTimeOrBlank("2026-02-30T09:30")).toBe(false);
    expect(isLocalDateTimeOrBlank("2026-08-15T09:30")).toBe(true);
    expect(isLocalDateTimeOrBlank("2026-08-15 09:30")).toBe(false);
  });

  it("formats stored instants in the snapshotted group zone and selects safe ids", () => {
    expect(toLocalDateTimeInput(round.scheduledAt, round.groupTimeZone)).toBe(
      "2026-08-15T09:30",
    );
    expect(selectRoundDraft([round], round.roundId)).toEqual(round);
    expect(selectRoundDraft([round], "not-a-uuid")).toBeNull();
  });
});
