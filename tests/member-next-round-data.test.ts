import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import {
  memberNextRoundEnvelopeSchema,
  memberNextRoundFromEnvelope,
} from "../apps/web/src/domain/member-next-round";
import { executeReadMemberNextRound } from "../apps/web/src/lib/rounds/member-next-round-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const roundId = "60000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";

const envelope = {
  round_id: roundId,
  group_id: groupId,
  description: "Saturday DogFight",
  scheduled_at: "2026-08-08T15:00:00.000Z",
  group_time_zone: "America/New_York",
  venue: "North Course",
  notes: "Meet by the first tee at 8:30.",
  format: "individual_net" as const,
  rsvp_deadline_at: "2026-08-07T15:00:00.000Z",
  participant: {
    rsvp_status: "no_response" as const,
    version: "1",
    changed_at: null,
  },
};

describe("member next-round RPC adapter", () => {
  it("passes the authenticated actor and maps the strict envelope", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: envelope, error: null });

    await expect(executeReadMemberNextRound(actorUserId)).resolves.toEqual({
      roundId,
      groupId,
      description: "Saturday DogFight",
      scheduledAt: "2026-08-08T15:00:00.000Z",
      groupTimeZone: "America/New_York",
      venue: "North Course",
      notes: "Meet by the first tee at 8:30.",
      format: "individual_net",
      rsvpDeadlineAt: "2026-08-07T15:00:00.000Z",
      participant: {
        rsvpStatus: "no_response",
        version: 1,
        changedAt: null,
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("read_member_next_round", {
      p_actor_user_id: actorUserId,
    });
  });

  it("treats a null RPC result as the member's empty next-round state", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(executeReadMemberNextRound(actorUserId)).resolves.toBeNull();
  });

  it("keeps notes hidden when the database redacts them", async () => {
    const parsed = memberNextRoundEnvelopeSchema.parse({
      ...envelope,
      notes: null,
      participant: {
        ...envelope.participant,
        rsvp_status: "playing",
        version: 2,
        changed_at: "2026-08-03T12:00:00.000Z",
      },
    });
    expect(memberNextRoundFromEnvelope(parsed)).toMatchObject({
      notes: null,
      participant: {
        rsvpStatus: "playing",
        version: 2,
        changedAt: "2026-08-03T12:00:00.000Z",
      },
    });
  });

  it("rejects an envelope that contains an unapproved field", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { ...envelope, player_visible_notes: true },
      error: null,
    });
    await expect(executeReadMemberNextRound(actorUserId)).rejects.toMatchObject(
      {
        code: "unexpected",
      },
    );
  });

  it.each([
    ["P0003", "forbidden"],
    ["P0002", "unavailable"],
  ] as const)("maps RPC code %s to %s", async (code, expectedCode) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code } });
    await expect(executeReadMemberNextRound(actorUserId)).rejects.toMatchObject(
      {
        code: expectedCode,
      },
    );
  });
});
