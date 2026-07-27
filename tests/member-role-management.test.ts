import { describe, expect, it, vi } from "vitest";

import {
  canChangeMemberRole,
  runMemberRoleMutation,
} from "../apps/web/src/lib/memberships/member-management";
import { executeChangeMemberRole } from "../apps/web/src/lib/memberships/member-management-data";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-07-27T00:00:00.000Z",
};
const membershipId = "60000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";
const operationId = "30000000-0000-4000-8000-000000000001";
const correlationId = "20000000-0000-4000-8000-000000000001";

const input = {
  membershipId,
  newRole: "coordinator" as const,
  expectedMembershipVersion: 3,
  confirmed: true,
  reason: "  Operations coverage  ",
  operationId,
};

describe("member role mutation boundary", () => {
  it("authenticates before parsing and rejects actor/tenant authority fields", async () => {
    const execute = vi.fn();
    const unauthenticated = await runMemberRoleMutation(null, null, {
      execute,
      verifySession: vi
        .fn()
        .mockRejectedValue(new MutationError("authentication_required")),
    });
    expect(unauthenticated.ok ? null : unauthenticated.error.code).toBe(
      "authentication_required",
    );
    expect(execute).not.toHaveBeenCalled();

    const invalid = await runMemberRoleMutation(
      { ...input, actorUserId: "10000000-0000-4000-8000-000000000999" },
      null,
      { execute, verifySession: vi.fn().mockResolvedValue(session) },
    );
    expect(invalid.ok ? null : invalid.error.code).toBe("validation");
    expect(execute).not.toHaveBeenCalled();
  });

  it("normalizes the reason and binds the verified actor and correlation", async () => {
    const execute = vi.fn().mockResolvedValue({
      membershipId,
      groupId,
      membershipVersion: 4,
      oldRole: "member",
      newRole: "coordinator",
      roleChanged: true,
    });
    const response = await runMemberRoleMutation(input, correlationId, {
      execute,
      verifySession: vi.fn().mockResolvedValue(session),
    });
    expect(response.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      session.userId,
      { ...input, reason: "Operations coverage" },
      correlationId,
    );
  });

  it.each([
    [{ ...input, confirmed: false }, "confirmed"],
    [{ ...input, reason: "   " }, "reason"],
    [{ ...input, expectedMembershipVersion: 0 }, "expectedMembershipVersion"],
  ])("requires valid consequential input (%s)", async (invalid, field) => {
    const response = await runMemberRoleMutation(invalid, null, {
      execute: vi.fn(),
      verifySession: vi.fn().mockResolvedValue(session),
    });
    expect(response.ok ? null : response.error.fieldErrors).toHaveProperty(
      field,
    );
  });

  it("calls the role RPC with no client tenant or actor fields and parses confirmed state", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          membership_id: membershipId,
          group_id: groupId,
          membership_version: 4,
          old_role: "member",
          new_role: "coordinator",
          role_changed: true,
        },
      ],
      error: null,
    });
    const result = await executeChangeMemberRole(
      session.userId,
      input,
      correlationId,
      { createClient: () => ({ rpc }) },
    );
    expect(result).toEqual({
      membershipId,
      groupId,
      membershipVersion: 4,
      oldRole: "member",
      newRole: "coordinator",
      roleChanged: true,
    });
    expect(rpc).toHaveBeenCalledWith("change_member_role", {
      p_actor_user_id: session.userId,
      p_membership_id: membershipId,
      p_new_role: "coordinator",
      p_expected_membership_version: 3,
      p_confirmed: true,
      p_reason: "  Operations coverage  ",
      p_correlation_id: correlationId,
      p_operation_id: operationId,
    });
  });

  it("exposes role controls only to administrators with active targets", () => {
    expect(
      canChangeMemberRole("coordinator", {
        role: "member",
        status: "active",
      }),
    ).toBe(false);
    expect(
      canChangeMemberRole("administrator", {
        role: "member",
        status: "pending",
      }),
    ).toBe(false);
    expect(
      canChangeMemberRole("administrator", {
        role: "member",
        status: "active",
      }),
    ).toBe(true);
  });
});
