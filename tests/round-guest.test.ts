import { describe, expect, it, vi } from "vitest";

import {
  runCreateRoundGuestMutation,
  runUpdateRoundGuestMutation,
  runWithdrawRoundGuestMutation,
} from "../apps/web/src/domain/round-guest";

const ids = {
  roundId: "e4000000-0000-4000-8000-000000000001",
  participantId: "e5000000-0000-4000-8000-000000000001",
  operationId: "e7000000-0000-4000-8000-000000000001",
  correlationId: "e6000000-0000-4000-8000-000000000001",
};

const verifySession = vi.fn(async () => ({
  userId: "e1000000-0000-4000-8000-000000000003",
  groupId: "e2000000-0000-4000-8000-000000000001",
  role: "member" as const,
}));

describe("round guest mutation boundaries", () => {
  it("normalizes a member-sponsored create and derives the source", async () => {
    const execute = vi.fn(async () => ({
      roundId: ids.roundId,
      groupId: "e2000000-0000-4000-8000-000000000001",
      participantId: ids.participantId,
      participantKind: "guest" as const,
      membershipId: null,
      sponsorMembershipId: "e3000000-0000-4000-8000-000000000003",
      firstName: "Pat",
      lastName: "Player",
      rsvpStatus: "playing" as const,
      version: 1,
      quotaSnapshot: "18.50",
      quotaSnapshotSource: { source: "guest_input" },
      handicapSnapshot: "12.3",
      handicapSnapshotSource: "manual" as const,
      handicapSnapshotAsOf: "2026-08-10",
      teeSnapshot: "middle",
      duplicateLike: false,
      changedAt: "2026-08-10T00:00:00.000Z",
    }));

    const result = await runCreateRoundGuestMutation(
      {
        roundId: ids.roundId,
        operationId: ids.operationId,
        firstName: "  Pat ",
        lastName: "Player",
        quotaSnapshot: "18.50",
        handicapSnapshot: 12.3,
        teeSnapshot: "middle",
      },
      ids.correlationId,
      { source: "mobile", execute, verifySession },
    );

    expect(result).toMatchObject({
      ok: true,
      data: expect.objectContaining({ participantId: ids.participantId }),
    });
    expect(execute).toHaveBeenCalledWith(
      "e1000000-0000-4000-8000-000000000003",
      expect.objectContaining({ source: "mobile", quotaSnapshot: 18.5 }),
      ids.correlationId,
    );
  });

  it("rejects a malformed guest edit before calling the server", async () => {
    const execute = vi.fn();
    const result = await runUpdateRoundGuestMutation(
      {
        participantId: ids.participantId,
        firstName: "Pat",
        lastName: "Player",
        quotaSnapshot: null,
        handicapSnapshot: null,
        teeSnapshot: null,
        expectedParticipantVersion: 0,
        reason: null,
        operationId: ids.operationId,
      },
      ids.correlationId,
      { source: "portal", execute, verifySession },
    );

    expect(result.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation and a reason for withdrawal", async () => {
    const execute = vi.fn();
    const result = await runWithdrawRoundGuestMutation(
      {
        roundId: ids.roundId,
        participantId: ids.participantId,
        expectedParticipantVersion: 1,
        confirmed: false,
        reason: "",
        operationId: ids.operationId,
      },
      ids.correlationId,
      { source: "portal", execute, verifySession },
    );

    expect(result.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
