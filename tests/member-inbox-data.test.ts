import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import {
  executeMarkMemberInboxRead,
  executeReadMemberInbox,
} from "../apps/web/src/lib/notifications/member-inbox-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const inboxItemId = "20000000-0000-4000-8000-000000000001";
const announcementId = "30000000-0000-4000-8000-000000000001";
const groupId = "40000000-0000-4000-8000-000000000001";
const roundId = "50000000-0000-4000-8000-000000000001";
const correlationId = "60000000-0000-4000-8000-000000000001";
const operationId = "70000000-0000-4000-8000-000000000001";

const itemRow = {
  announcement_id: announcementId,
  author_display_name: "Alex Golfer",
  author_role: "coordinator",
  body: "Meet by the first tee.",
  created_at: "2026-08-10T12:00:00.000Z",
  group_id: groupId,
  inbox_item_id: inboxItemId,
  read_at: null,
  round_description: "Saturday DogFight",
  round_id: roundId,
};

describe("member inbox data adapters", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("maps the tenant-scoped read projection", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [itemRow], error: null });
    await expect(executeReadMemberInbox(actorUserId)).resolves.toEqual([
      {
        announcementId,
        authorDisplayName: "Alex Golfer",
        authorRole: "coordinator",
        body: "Meet by the first tee.",
        createdAt: itemRow.created_at,
        groupId,
        inboxItemId,
        readAt: null,
        roundDescription: "Saturday DogFight",
        roundId,
      },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("read_member_inbox", {
      p_actor_user_id: actorUserId,
      p_limit: 50,
    });
  });

  it("forwards the operation context when marking an item read", async () => {
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
    await expect(
      executeMarkMemberInboxRead(
        actorUserId,
        { inboxItemId, operationId },
        correlationId,
      ),
    ).resolves.toEqual({
      inboxItemId,
      readAt: "2026-08-10T12:01:00.000Z",
      version: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("mark_member_inbox_read", {
      p_actor_user_id: actorUserId,
      p_correlation_id: correlationId,
      p_inbox_item_id: inboxItemId,
      p_operation_id: operationId,
    });
  });

  it("fails closed for an unexpected projection shape", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ ...itemRow, extra: true }],
      error: null,
    });
    await expect(executeReadMemberInbox(actorUserId)).rejects.toMatchObject({
      code: "unexpected",
    });
  });
});
