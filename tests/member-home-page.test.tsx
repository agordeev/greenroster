import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSession: vi.fn(),
  readNextRound: vi.fn(),
}));

vi.mock("../apps/web/src/lib/auth/member-page-session", () => ({
  resolveMemberPageSession: mocks.resolveSession,
}));
vi.mock("../apps/web/src/lib/rounds/member-next-round-data", () => ({
  executeReadMemberNextRound: mocks.readNextRound,
}));
vi.mock("../apps/web/src/app/member/home/member-next-round-rsvp", () => ({
  MemberNextRoundRsvp: () => null,
}));

import MemberHomePage from "../apps/web/src/app/member/home/page";

const userId = "10000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";
const roundId = "60000000-0000-4000-8000-000000000001";

function readyAccess() {
  const rpc = vi.fn().mockResolvedValue({
    data: [{ is_complete: true }],
    error: null,
  });
  const single = vi.fn().mockResolvedValue({
    data: { name: "North Hills" },
    error: null,
  });
  const client = {
    rpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single })),
      })),
    })),
  };
  return { state: "ready" as const, client, groupId, userId };
}

describe("member home page", () => {
  it("renders the next round details returned for the member", async () => {
    mocks.resolveSession.mockResolvedValueOnce(readyAccess());
    mocks.readNextRound.mockResolvedValueOnce({
      roundId,
      groupId,
      description: "Saturday DogFight",
      scheduledAt: "2026-08-08T15:00:00.000Z",
      groupTimeZone: "America/New_York",
      venue: "North Course",
      notes: "Meet by the first tee.",
      format: "individual_net",
      rsvpDeadlineAt: "2026-08-07T15:00:00.000Z",
      participant: {
        rsvpStatus: "playing",
        version: 2,
        changedAt: "2026-08-03T12:00:00.000Z",
      },
    });

    const page = await MemberHomePage();
    const seen = new WeakSet<object>();
    const pageText = JSON.stringify(page, (_key, value: unknown) => {
      if (typeof value !== "object" || value === null) return value;
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      return value;
    });
    expect(pageText).toContain("Saturday DogFight");
    expect(pageText).toContain("North Course");
    expect(pageText).toContain("Meet by the first tee.");
    expect(mocks.readNextRound).toHaveBeenCalledWith(userId);
  });
});
