import { describe, expect, it, vi } from "vitest";

import {
  runGroupProfileMutation,
  type GroupProfileResult,
} from "../apps/web/src/lib/groups/group-profile";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-08-03T00:00:00.000Z",
};

const input = {
  expectedGroupVersion: 3,
  groupName: "  Green Hills  ",
  groupTimeZone: "  America/New_York  ",
  operationId: "30000000-0000-4000-8000-000000000001",
  reason: "  Correct the club display name  ",
};

const result: GroupProfileResult = {
  groupId: "40000000-0000-4000-8000-000000000001",
  groupName: "Green Hills",
  groupTimeZone: "America/New_York",
  groupVersion: 4,
};

describe("group profile mutation boundary", () => {
  it("binds the verified actor, normalizes fields, and preserves correlation", async () => {
    const executeUpdate = vi.fn().mockResolvedValue(result);

    const response = await runGroupProfileMutation(
      input,
      "20000000-0000-4000-8000-000000000001",
      {
        executeUpdate,
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );

    expect(response).toEqual({
      ok: true,
      data: result,
      correlationId: "20000000-0000-4000-8000-000000000001",
    });
    expect(executeUpdate).toHaveBeenCalledWith(
      session.userId,
      {
        ...input,
        groupName: "Green Hills",
        groupTimeZone: "America/New_York",
        reason: "Correct the club display name",
      },
      "20000000-0000-4000-8000-000000000001",
    );
  });

  it("authenticates before validating untrusted profile input", async () => {
    const executeUpdate = vi.fn();
    const response = await runGroupProfileMutation(null, null, {
      executeUpdate,
      verifySession: vi
        .fn()
        .mockRejectedValue(new MutationError("authentication_required")),
    });

    expect(response.ok ? null : response.error.code).toBe(
      "authentication_required",
    );
    expect(executeUpdate).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...input, expectedGroupVersion: 0 }, "expectedGroupVersion"],
    [{ ...input, expectedGroupVersion: -1 }, "expectedGroupVersion"],
    [{ ...input, groupName: " " }, "groupName"],
    [{ ...input, groupTimeZone: "Mars/Olympus_Mons" }, "groupTimeZone"],
    [{ ...input, reason: " " }, "reason"],
    [{ ...input, groupId: "40000000-0000-4000-8000-000000000999" }, null],
    [{ ...input, actorUserId: session.userId }, null],
  ])(
    "rejects invalid or client-authority profile fields (%s)",
    async (invalidInput, field) => {
      const executeUpdate = vi.fn();
      const response = await runGroupProfileMutation(invalidInput, null, {
        executeUpdate,
        verifySession: vi.fn().mockResolvedValue(session),
      });

      expect(response.ok).toBe(false);
      expect(response.ok ? null : response.error.code).toBe("validation");
      if (field) {
        expect(response.ok ? null : response.error.fieldErrors).toHaveProperty(
          field,
        );
      }
      expect(executeUpdate).not.toHaveBeenCalled();
    },
  );

  it("preserves the safe stale-version error class", async () => {
    const response = await runGroupProfileMutation(input, null, {
      verifySession: vi.fn().mockResolvedValue(session),
      executeUpdate: vi
        .fn()
        .mockRejectedValue(new MutationError("stale_version")),
    });

    expect(response.ok ? null : response.error).toMatchObject({
      code: "stale_version",
      message: "This information changed. Refresh it before trying again.",
    });
  });
});
