import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import {
  executeReadGroupGuestPermission,
  executeUpdateGroupGuestPermission,
} from "../apps/web/src/lib/groups/group-guest-permission-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const groupId = "40000000-0000-4000-8000-000000000001";
const input = {
  allowMemberGuests: true,
  expectedGroupVersion: 1,
  operationId: "30000000-0000-4000-8000-000000000001",
  reason: "Permit guests",
};

describe("group guest-permission RPC adapter", () => {
  it("maps the actor-derived read projection", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        { group_id: groupId, allow_member_guests: false, group_version: 2 },
      ],
      error: null,
    });
    await expect(executeReadGroupGuestPermission(actorUserId)).resolves.toEqual(
      {
        groupId,
        allowMemberGuests: false,
        groupVersion: 2,
      },
    );
    expect(mocks.rpc).toHaveBeenCalledWith("read_group_guest_permission", {
      p_actor_user_id: actorUserId,
    });
  });

  it("maps the update receipt and sends only approved fields", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          updated_group_id: groupId,
          updated_allow_member_guests: true,
          updated_group_version: 2,
        },
      ],
      error: null,
    });
    await expect(
      executeUpdateGroupGuestPermission(
        actorUserId,
        input,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({
      groupId,
      allowMemberGuests: true,
      groupVersion: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("update_group_guest_permission", {
      p_actor_user_id: actorUserId,
      p_allow_member_guests: true,
      p_expected_group_version: 1,
      p_reason: "Permit guests",
      p_correlation_id: "20000000-0000-4000-8000-000000000001",
      p_operation_id: input.operationId,
    });
  });

  it.each([
    ["P0003", "forbidden"],
    ["40001", "stale_version"],
    ["23505", "operation_reused"],
  ] as const)("maps RPC code %s to %s", async (code, expectedCode) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code } });
    await expect(
      executeUpdateGroupGuestPermission(
        actorUserId,
        input,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toMatchObject({ code: expectedCode });
  });

  it("rejects an envelope with an unapproved field", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          updated_group_id: groupId,
          updated_allow_member_guests: true,
          updated_group_version: 2,
          secret: "no",
        },
      ],
      error: null,
    });
    await expect(
      executeUpdateGroupGuestPermission(
        actorUserId,
        input,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toMatchObject({ code: "unexpected" });
  });
});
