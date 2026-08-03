import { describe, expect, it, vi } from "vitest";

import {
  runGroupGuestPermissionMutation,
  type GroupGuestPermission,
} from "../apps/web/src/lib/groups/group-guest-permission";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-08-03T00:00:00.000Z",
};
const input = {
  allowMemberGuests: true,
  expectedGroupVersion: 3,
  operationId: "30000000-0000-4000-8000-000000000001",
  reason: "  Permit guests for summer rounds  ",
};
const result: GroupGuestPermission = {
  groupId: "40000000-0000-4000-8000-000000000001",
  allowMemberGuests: true,
  groupVersion: 4,
};

describe("group guest-permission mutation boundary", () => {
  it("binds the verified actor, normalizes the reason, and preserves correlation", async () => {
    const executeUpdate = vi.fn().mockResolvedValue(result);
    await expect(
      runGroupGuestPermissionMutation(
        input,
        "20000000-0000-4000-8000-000000000001",
        {
          executeUpdate,
          verifySession: vi.fn().mockResolvedValue(session),
        },
      ),
    ).resolves.toEqual({
      ok: true,
      data: result,
      correlationId: "20000000-0000-4000-8000-000000000001",
    });
    expect(executeUpdate).toHaveBeenCalledWith(
      session.userId,
      { ...input, reason: "Permit guests for summer rounds" },
      "20000000-0000-4000-8000-000000000001",
    );
  });

  it("authenticates before validating untrusted input", async () => {
    const executeUpdate = vi.fn();
    await expect(
      runGroupGuestPermissionMutation(null, null, {
        executeUpdate,
        verifySession: vi
          .fn()
          .mockRejectedValue(new MutationError("authentication_required")),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "authentication_required" },
    });
    expect(executeUpdate).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...input, allowMemberGuests: "yes" }, "validation"],
    [{ ...input, expectedGroupVersion: 0 }, "validation"],
    [{ ...input, reason: " " }, "validation"],
    [{ ...input, actorUserId: session.userId }, "validation"],
  ])(
    "rejects client-authority or invalid fields",
    async (invalidInput, code) => {
      const executeUpdate = vi.fn();
      await expect(
        runGroupGuestPermissionMutation(invalidInput, null, {
          executeUpdate,
          verifySession: vi.fn().mockResolvedValue(session),
        }),
      ).resolves.toMatchObject({ ok: false, error: { code } });
      expect(executeUpdate).not.toHaveBeenCalled();
    },
  );

  it("preserves stale and operation-reuse error classes", async () => {
    await expect(
      runGroupGuestPermissionMutation(input, null, {
        verifySession: vi.fn().mockResolvedValue(session),
        executeUpdate: vi
          .fn()
          .mockRejectedValue(new MutationError("stale_version")),
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "stale_version" } });
    await expect(
      runGroupGuestPermissionMutation(input, null, {
        verifySession: vi.fn().mockResolvedValue(session),
        executeUpdate: vi
          .fn()
          .mockRejectedValue(new MutationError("operation_reused")),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "operation_reused" },
    });
  });
});
