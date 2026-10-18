import { describe, expect, it, vi } from "vitest";

import { runSetEmailPreferenceMutation } from "../apps/web/src/domain/notification-preference";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-07-26T00:00:00.000Z",
};

const input = {
  category: "round_published",
  enabled: false,
  expectedVersion: 2,
  operationId: "30000000-0000-4000-8000-000000000001",
};

const receipt = {
  category: "round_published",
  emailEnabled: false,
  version: 3,
};

describe("set e-mail preference mutation", () => {
  it("binds the actor to the verified session and preserves correlation", async () => {
    const execute = vi.fn().mockResolvedValue(receipt);

    const response = await runSetEmailPreferenceMutation(
      input,
      "20000000-0000-4000-8000-000000000001",
      {
        execute,
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );

    expect(response).toEqual({
      ok: true,
      data: receipt,
      correlationId: "20000000-0000-4000-8000-000000000001",
    });
    expect(execute).toHaveBeenCalledWith(
      session.userId,
      input,
      "20000000-0000-4000-8000-000000000001",
    );
  });

  it("returns a validation error and does not execute for a bad category", async () => {
    const execute = vi.fn();

    const response = await runSetEmailPreferenceMutation(
      { ...input, category: "Round-Published!" },
      null,
      {
        execute,
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );

    expect(response.ok ? null : response.error.code).toBe("validation");
    expect(response.ok ? null : response.error.fieldErrors).toHaveProperty(
      "category",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns authentication_required when the session cannot be verified", async () => {
    const execute = vi.fn();

    const response = await runSetEmailPreferenceMutation(input, null, {
      execute,
      verifySession: vi
        .fn()
        .mockRejectedValue(new MutationError("authentication_required")),
    });

    expect(response.ok ? null : response.error.code).toBe(
      "authentication_required",
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
