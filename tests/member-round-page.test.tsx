import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSession: vi.fn(),
  readRound: vi.fn(),
  readGuests: vi.fn(),
  readScores: vi.fn(),
  rsvp: vi.fn(() => null),
  guests: vi.fn(() => null),
  scorePanel: vi.fn(() => null),
}));

vi.mock("../apps/web/src/lib/auth/member-page-session", () => ({
  resolveMemberPageSession: mocks.resolveSession,
}));
vi.mock("../apps/web/src/lib/rounds/member-round-detail-data", () => ({
  executeReadMemberRoundDetail: mocks.readRound,
  executeReadMemberRoundGuestContext: mocks.readGuests,
}));
vi.mock("../apps/web/src/lib/rounds/live-round-score-data", () => ({
  executeReadLiveRoundScores: mocks.readScores,
}));
vi.mock("../apps/web/src/app/member/home/member-next-round-rsvp", () => ({
  MemberNextRoundRsvp: mocks.rsvp,
}));
vi.mock(
  "../apps/web/src/app/member/rounds/[roundId]/member-round-guests",
  () => ({
    MemberRoundGuests: mocks.guests,
  }),
);
vi.mock(
  "../apps/web/src/app/portal/rounds/live-round-score-entry-panel",
  () => ({
    LiveRoundScoreEntryPanel: mocks.scorePanel,
  }),
);

import MemberRoundPage from "../apps/web/src/app/member/rounds/[roundId]/page";

const roundId = "60000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000001";

function readyAccess() {
  return {
    state: "ready" as const,
    client: {},
    groupId,
    userId,
  };
}

function guestContext(canManage: boolean) {
  return {
    roundId,
    groupId,
    format: "individual_net" as const,
    state: "published" as const,
    canManage,
    guests: [],
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
    mocks.readGuests.mockResolvedValue(guestContext(false));
    mocks.readScores.mockResolvedValue([]);
  });

  it("renders the authenticated round detail and RSVP without round-day mutations", async () => {
    mocks.readRound.mockResolvedValue(round());
    mocks.readGuests.mockResolvedValue(guestContext(false));

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

  it("lets a member enter their own and their guests' points in a live round", async () => {
    mocks.readRound.mockResolvedValue(round("live"));
    mocks.readScores.mockResolvedValue([
      { participantId: "p-member", canEdit: true },
      { participantId: "p-other", canEdit: false },
    ]);

    const page = await MemberRoundPage({
      params: Promise.resolve({ roundId }),
    });
    const rendered = pageText(page);

    expect(mocks.readScores).toHaveBeenCalledWith(userId, roundId);
    expect(rendered).toContain('"audience":"member"');
    expect(rendered).toContain("p-member");
    expect(rendered).not.toContain("p-other");
    expect(rendered).not.toContain("Open the GreenRoster app");
    expect(mocks.rsvp).not.toHaveBeenCalled();
    expect(rendered).not.toContain("Save score");
    expect(rendered).not.toContain("Add guest");
  });

  it("shows a retry note when live scores can't be read", async () => {
    mocks.readRound.mockResolvedValue(round("live"));
    mocks.readScores.mockRejectedValue(new Error("boom"));

    const page = await MemberRoundPage({
      params: Promise.resolve({ roundId }),
    });

    expect(pageText(page)).toContain("We couldn't load your scores");
  });

  it("offers guests on a published round the member is playing in", async () => {
    mocks.readRound.mockResolvedValue(round("published"));
    mocks.readGuests.mockResolvedValue(guestContext(true));

    const page = await MemberRoundPage({
      params: Promise.resolve({ roundId }),
    });

    expect(mocks.readGuests).toHaveBeenCalledWith(userId, roundId);
    expect(pageText(page)).toContain('"canManage":true');
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
