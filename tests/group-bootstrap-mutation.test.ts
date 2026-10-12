import { describe, expect, it, vi } from "vitest";

import { runGroupBootstrapMutation } from "../apps/web/src/lib/groups/bootstrap-group";
import {
  MutationError,
  mutationErrorCodes,
  mutationFailure,
} from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-07-25T00:00:00.000Z",
};

const input = {
  groupName: "  Green Hills  ",
  groupTimeZone: "  America/New_York  ",
  operationId: "30000000-0000-4000-8000-000000000001",
};

const result = {
  groupId: "40000000-0000-4000-8000-000000000001",
  administratorMembershipId: "50000000-0000-4000-8000-000000000001",
};

describe("group bootstrap mutation boundary", () => {
  it("defines every client-distinguishable service error class", () => {
    expect(mutationErrorCodes).toEqual([
      "authentication_required",
      "forbidden",
      "unavailable",
      "validation",
      "operation_reused",
      "stale_version",
      "locked",
      "rate_limited",
      "transient",
      "unexpected",
    ]);
  });

  it("binds the database actor to the verified session and preserves correlation", async () => {
    const executeBootstrap = vi.fn().mockResolvedValue(result);

    const response = await runGroupBootstrapMutation(
      input,
      "20000000-0000-4000-8000-000000000001",
      {
        verifySession: vi.fn().mockResolvedValue(session),
        executeBootstrap,
      },
    );

    expect(response).toEqual({
      ok: true,
      data: result,
      correlationId: "20000000-0000-4000-8000-000000000001",
    });
    expect(executeBootstrap).toHaveBeenCalledWith(
      session.userId,
      {
        groupName: "Green Hills",
        groupTimeZone: "America/New_York",
        operationId: input.operationId,
      },
      "20000000-0000-4000-8000-000000000001",
    );
  });

  it("rejects an attacker-supplied administrator identity", async () => {
    const executeBootstrap = vi.fn();

    const response = await runGroupBootstrapMutation(
      { ...input, administratorUserId: "10000000-0000-4000-8000-000000000999" },
      null,
      {
        verifySession: vi.fn().mockResolvedValue(session),
        executeBootstrap,
      },
    );

    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.error.code).toBe("validation");
    expect(executeBootstrap).not.toHaveBeenCalled();
  });

  it("authenticates before validating untrusted input", async () => {
    const order: string[] = [];

    const response = await runGroupBootstrapMutation(null, null, {
      verifySession: vi.fn(async () => {
        order.push("authenticate");
        throw new MutationError("authentication_required");
      }),
      executeBootstrap: vi.fn(async () => {
        order.push("execute");
        return result;
      }),
    });

    expect(order).toEqual(["authenticate"]);
    expect(response.ok ? null : response.error.code).toBe(
      "authentication_required",
    );
  });

  it("returns field-associated validation without exposing internals", async () => {
    const response = await runGroupBootstrapMutation(
      { ...input, groupName: " ", groupTimeZone: "Mars/Olympus_Mons" },
      null,
      {
        verifySession: vi.fn().mockResolvedValue(session),
        executeBootstrap: vi.fn(),
      },
    );

    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.error.fieldErrors).toMatchObject({
      groupName: expect.any(Array),
      groupTimeZone: expect.any(Array),
    });
  });

  it("generates a server correlation identifier when the header is invalid", async () => {
    const response = await runGroupBootstrapMutation(input, "not-a-uuid", {
      verifySession: vi.fn().mockResolvedValue(session),
      executeBootstrap: vi.fn().mockResolvedValue(result),
    });

    expect(response.ok).toBe(true);
    expect(response.ok ? response.correlationId : null).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("preserves safe business error classes", async () => {
    const response = await runGroupBootstrapMutation(input, null, {
      verifySession: vi.fn().mockResolvedValue(session),
      executeBootstrap: vi
        .fn()
        .mockRejectedValue(new MutationError("validation")),
    });

    expect(response.ok ? null : response.error).toMatchObject({
      code: "validation",
      message: "Check the highlighted fields and try again.",
    });
  });

  it("replaces unexpected details with a support correlation reference", () => {
    const failure = mutationFailure(
      new Error("secret provider payload"),
      "20000000-0000-4000-8000-000000000001",
    );

    expect(failure.ok).toBe(false);
    expect(failure.ok ? null : failure.error.message).toBe(
      "We couldn't save your changes. Try again, or contact support with reference 20000000-0000-4000-8000-000000000001.",
    );
    expect(JSON.stringify(failure)).not.toContain("secret provider payload");
  });
});
