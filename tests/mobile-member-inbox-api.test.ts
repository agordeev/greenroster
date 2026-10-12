import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/mobile/src/lib/auth/mobile-supabase", () => ({
  mobileSupabase: { rpc: mocks.rpc },
}));
vi.mock("../apps/mobile/src/lib/mobile-operation-id", () => ({
  createMobileOperationId: vi
    .fn()
    .mockReturnValueOnce("60000000-0000-4000-8000-000000000001")
    .mockReturnValueOnce("70000000-0000-4000-8000-000000000001"),
}));

import { mobileMemberInboxApi } from "../apps/mobile/src/lib/notifications/mobile-member-inbox-api";

const inboxItemId = "10000000-0000-4000-8000-000000000001";

describe("mobile member inbox API", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("maps the authenticated inbox projection", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          announcement_id: "20000000-0000-4000-8000-000000000001",
          author_display_name: "Coordinator",
          author_role: "coordinator",
          body: "Meet by the first tee.",
          created_at: "2026-08-10T12:00:00.000Z",
          group_id: "30000000-0000-4000-8000-000000000001",
          inbox_item_id: inboxItemId,
          read_at: null,
          round_description: "Saturday DogFight",
          round_id: "40000000-0000-4000-8000-000000000001",
        },
      ],
      error: null,
    });
    await expect(mobileMemberInboxApi.read()).resolves.toMatchObject({
      ok: true,
      data: [{ inboxItemId, body: "Meet by the first tee." }],
    });
    expect(mocks.rpc).toHaveBeenCalledWith("resolve_mobile_member_inbox", {
      p_limit: 50,
    });
  });

  it("passes fresh correlation and operation ids to mark-read", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          inbox_item_id: inboxItemId,
          read_at: "2026-08-10T12:01:00.000Z",
          version: 2,
        },
      ],
      error: null,
    });
    await expect(mobileMemberInboxApi.markRead(inboxItemId)).resolves.toEqual({
      data: {
        inboxItemId,
        readAt: "2026-08-10T12:01:00.000Z",
        version: 2,
      },
      ok: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("mark_mobile_member_inbox_read", {
      p_correlation_id: "60000000-0000-4000-8000-000000000001",
      p_inbox_item_id: inboxItemId,
      p_operation_id: "70000000-0000-4000-8000-000000000001",
    });
  });

  it("maps authorization failures to a member-safe result", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0003", message: "actor_not_authorized" },
    });
    await expect(mobileMemberInboxApi.read()).resolves.toEqual({
      code: "permission_denied",
      message: "You can't open your round updates.",
      ok: false,
    });
  });
});
