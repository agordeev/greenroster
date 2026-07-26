import { describe, expect, it, vi } from "vitest";

import { runAdministratorRoleTransferMutation } from "../apps/web/src/lib/memberships/administrator-role-transfer";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-07-26T00:00:00.000Z",
};

const input = {
  replacementMembershipId: "60000000-0000-4000-8000-000000000002",
  expectedGroupVersion: 4,
  confirmed: true,
  reason: "  Planned ownership handoff  ",
  operationId: "30000000-0000-4000-8000-000000000001",
};

const result = {
  groupId: "50000000-0000-4000-8000-000000000001",
  groupVersion: 5,
  previousAdministratorMembershipId: "60000000-0000-4000-8000-000000000001",
  previousAdministratorRole: "coordinator" as const,
  replacementMembershipId: input.replacementMembershipId,
  replacementRole: "administrator" as const,
};

describe("administrator role-transfer mutation boundary", () => {
  it("binds the actor to the verified session and preserves correlation", async () => {
    const executeTransfer = vi.fn().mockResolvedValue(result);

    const response = await runAdministratorRoleTransferMutation(
      input,
      "20000000-0000-4000-8000-000000000001",
      {
        verifySession: vi.fn().mockResolvedValue(session),
        executeTransfer,
      },
    );

    expect(response).toEqual({
      ok: true,
      data: result,
      correlationId: "20000000-0000-4000-8000-000000000001",
    });
    expect(executeTransfer).toHaveBeenCalledWith(
      session.userId,
      { ...input, reason: "Planned ownership handoff" },
      "20000000-0000-4000-8000-000000000001",
    );
  });

  it("authenticates before validating attacker-controlled input", async () => {
    const executeTransfer = vi.fn();
    const response = await runAdministratorRoleTransferMutation(null, null, {
      verifySession: vi
        .fn()
        .mockRejectedValue(new MutationError("authentication_required")),
      executeTransfer,
    });

    expect(response.ok ? null : response.error.code).toBe(
      "authentication_required",
    );
    expect(executeTransfer).not.toHaveBeenCalled();
  });

  it("rejects client-supplied tenant and actor authority", async () => {
    const executeTransfer = vi.fn();
    const response = await runAdministratorRoleTransferMutation(
      {
        ...input,
        actorUserId: "10000000-0000-4000-8000-000000000999",
        groupId: "50000000-0000-4000-8000-000000000999",
      },
      null,
      {
        verifySession: vi.fn().mockResolvedValue(session),
        executeTransfer,
      },
    );

    expect(response.ok ? null : response.error.code).toBe("validation");
    expect(executeTransfer).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...input, confirmed: false }, "confirmed"],
    [{ ...input, reason: " " }, "reason"],
    [{ ...input, expectedGroupVersion: 0 }, "expectedGroupVersion"],
  ])(
    "returns a field error for an invalid consequential input",
    async (invalidInput, field) => {
      const response = await runAdministratorRoleTransferMutation(
        invalidInput,
        null,
        {
          verifySession: vi.fn().mockResolvedValue(session),
          executeTransfer: vi.fn(),
        },
      );

      expect(response.ok ? null : response.error.fieldErrors).toHaveProperty(
        field,
      );
    },
  );

  it("preserves client-distinguishable authorization and stale errors", async () => {
    for (const code of ["forbidden", "unavailable", "stale_version"] as const) {
      const response = await runAdministratorRoleTransferMutation(input, null, {
        verifySession: vi.fn().mockResolvedValue(session),
        executeTransfer: vi.fn().mockRejectedValue(new MutationError(code)),
      });

      expect(response.ok ? null : response.error.code).toBe(code);
    }
  });

  it("generates a safe server correlation identifier when the header is invalid", async () => {
    const response = await runAdministratorRoleTransferMutation(
      input,
      "attacker-value",
      {
        verifySession: vi.fn().mockResolvedValue(session),
        executeTransfer: vi.fn().mockResolvedValue(result),
      },
    );

    expect(response.ok ? response.correlationId : null).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
