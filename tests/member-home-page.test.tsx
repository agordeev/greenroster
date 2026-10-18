import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSession: vi.fn(),
  readNextRound: vi.fn(),
  readOfficialResults: vi.fn(),
  readQuotaHistory: vi.fn().mockResolvedValue([]),
  readStandings: vi.fn().mockResolvedValue([]),
  readClubhouseContent: vi.fn().mockResolvedValue(null),
}));

vi.mock("../apps/web/src/lib/auth/member-page-session", () => ({
  resolveMemberPageSession: mocks.resolveSession,
}));
vi.mock("../apps/web/src/lib/rounds/member-next-round-data", () => ({
  executeReadMemberNextRound: mocks.readNextRound,
}));
vi.mock("../apps/web/src/lib/rounds/member-results-data", () => ({
  executeReadMemberOfficialResults: mocks.readOfficialResults,
  executeReadMemberQuotaHistory: mocks.readQuotaHistory,
  executeReadMemberStandings: mocks.readStandings,
}));
vi.mock("../apps/web/src/lib/clubhouse/clubhouse-content-data", () => ({
  executeReadClubhouseContent: mocks.readClubhouseContent,
}));
vi.mock("../apps/web/src/app/member/home/member-next-round-rsvp", () => ({
  MemberNextRoundRsvp: () => null,
}));
vi.mock("../apps/web/src/app/actions/notifications", () => ({
  setEmailPreferenceAction: vi.fn(),
}));

import { MemberNotificationPreferences } from "../apps/web/src/app/member/home/member-notification-preferences";
import MemberHomePage from "../apps/web/src/app/member/home/page";

const userId = "10000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";
const roundId = "60000000-0000-4000-8000-000000000001";

function readyAccess(preferencesData: unknown = []) {
  const rpc = vi.fn((name: string) =>
    Promise.resolve(
      name === "resolve_mobile_member_notification_preferences"
        ? { data: preferencesData, error: null }
        : { data: [{ is_complete: true }], error: null },
    ),
  );
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

  it("passes e-mail preferences with a numeric version when the RPC returns extra columns", async () => {
    mocks.resolveSession.mockResolvedValueOnce(
      readyAccess([
        {
          category: "round_published",
          mandatory: false,
          email_enabled: true,
          email_allowed: true,
          version: "3",
          membership_id: "70000000-0000-4000-8000-000000000001",
          group_id: groupId,
          push_enabled: false,
          push_allowed: false,
          updated_at: "2026-08-03T12:00:00.000Z",
        },
      ]),
    );
    mocks.readNextRound.mockResolvedValueOnce(null);

    const page = await MemberHomePage();
    const element = findElement(page, MemberNotificationPreferences);

    expect(element).not.toBeNull();
    expect(element?.props.preferences).toEqual([
      {
        category: "round_published",
        mandatory: false,
        email_enabled: true,
        email_allowed: true,
        version: 3,
      },
    ]);
  });
});

// Walks the rendered element tree looking for a component by type.
function findElement(
  node: unknown,
  type: unknown,
): { props: Record<string, unknown> } | null {
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === type && element.props) {
    return { props: element.props };
  }
  return findElement(element.props?.children, type);
}
