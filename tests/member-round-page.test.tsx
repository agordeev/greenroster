import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSession: vi.fn(),
  readRound: vi.fn(),
  rsvp: vi.fn(() => null),
}));

vi.mock("../apps/web/src/lib/auth/member-page-session", () => ({
  resolveMemberPageSession: mocks.resolveSession,
}));
vi.mock("../apps/web/src/lib/rounds/member-round-detail-data", () => ({
  executeReadMemberRoundDetail: mocks.readRound,
}));
vi.mock("../apps/web/src/app/member/home/member-next-round-rsvp", () => ({
  MemberNextRoundRsvp: mocks.rsvp,
}));

import MemberRoundPage from "../apps/web/src/app/member/rounds/[roundId]/page";

const roundId = "60000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";

function readyAccess() {
  return {
    state: "ready" as const,
    client: {},
    groupId,
    userId: "10000000-0000-4000-8000-000000000001",
  };
}

function round(
  state: "published" | "live" | "completed" | "cancelled" = "published",
  participantVersion: number | null = 2,
) {
  return {
    roundId,
    groupId,
    description: "Saturday DogFight",
    scheduledAt: "2026-08-08T15:00:00.000Z",
    groupTimeZone: "America/New_York",
    venue: "North Course",
    roundUrl: "https://example.com/round",
    notes: "Meet by the first tee.",
    format: "individual_net" as const,
    state,
    version: 1,
    rsvpDeadlineAt: "2026-08-07T15:00:00.000Z",
    participantStatus: "playing" as const,
    participantVersion,
    rsvpChangedAt: "2026-08-03T12:00:00.000Z",
    participantCount: 4,
    playingCount: 3,
    cancelledAt: null,
    cancellationReason: null,
    updatedAt: "2026-08-03T12:00:00.000Z",
  };
}

function pageText(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return entry;
    if (seen.has(entry)) return "[Circular]";
    seen.add(entry);
    return entry;
  });
}

describe("member round page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSession.mockResolvedValue(readyAccess());
  });

  it("renders the authenticated round detail and RSVP without round-day mutations", async () => {
    mocks.readRound.mockResolvedValue(round());

    const page = await MemberRoundPage({
      params: Promise.resolve({ roundId }),
    });
    const rendered = pageText(page);

    expect(rendered).toContain("Saturday DogFight");
    expect(rendered).toContain("North Course");
    expect(rendered).toContain('"initialRsvpStatus":"playing"');
    expect(rendered).not.toContain("Save score");
    expect(rendered).not.toContain("Add guest");
    expect(rendered).not.toContain("Withdraw");
  });

  it("keeps a live round read-only in the browser", async () => {
    mocks.readRound.mockResolvedValue(round("live"));

    const page = await MemberRoundPage({
      params: Promise.resolve({ roundId }),
    });
    const rendered = pageText(page);

    expect(rendered).toContain("Your round is live");
    expect(rendered).toContain(
      "Open the GreenRoster app to enter scores and manage guests.",
    );
    expect(mocks.rsvp).not.toHaveBeenCalled();
    expect(rendered).not.toContain("Save score");
    expect(rendered).not.toContain("Add guest");
  });

  it("does not render an RSVP action without a member participant", async () => {
    mocks.readRound.mockResolvedValue(round("published", null));

    const page = await MemberRoundPage({
      params: Promise.resolve({ roundId }),
    });

    expect(mocks.rsvp).not.toHaveBeenCalled();
    expect(pageText(page)).toContain("Saturday DogFight");
  });
});
