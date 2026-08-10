import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { rpc: mocks.rpc },
}));
vi.mock("../apps/mobile/src/lib/mobile-operation-id", () => ({
  createMobileOperationId: vi
    .fn()
    .mockReturnValue("50000000-0000-4000-8000-000000000001"),
}));

import { mobileClubhouseApi } from "../apps/mobile/src/lib/clubhouse/mobile-clubhouse-api";

const messageId = "10000000-0000-4000-8000-000000000001";

describe("mobile clubhouse contact history", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("maps the authenticated coordinator contact projection", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          body: "Can you confirm the tee time?",
          created_at: "2026-08-10T12:00:00.000Z",
          group_id: "20000000-0000-4000-8000-000000000001",
          message_id: messageId,
          recipient_display_name: "Group Coordinator",
          sender_display_name: "Member Golfer",
          sent_by_actor: true,
        },
      ],
      error: null,
    });

    await expect(mobileClubhouseApi.contacts()).resolves.toEqual({
      ok: true,
      data: [
        {
          body: "Can you confirm the tee time?",
          createdAt: "2026-08-10T12:00:00.000Z",
          groupId: "20000000-0000-4000-8000-000000000001",
          messageId,
          recipientDisplayName: "Group Coordinator",
          senderDisplayName: "Member Golfer",
          sentByActor: true,
        },
      ],
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "resolve_mobile_coordinator_contacts",
    );
  });

  it("returns member-safe feedback when contact history cannot load", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0003", message: "actor_not_authorized" },
    });

    await expect(mobileClubhouseApi.contacts()).resolves.toEqual({
      message: "You can't load your coordinator messages right now. Try again.",
      ok: false,
    });
  });
});
