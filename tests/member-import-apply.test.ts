import { describe, expect, it, vi } from "vitest";

import { runMemberImportApplyRequest } from "../apps/web/src/lib/member-imports/member-import-apply";

const input = {
  jobId: "30000000-0000-4000-8000-000000000001",
  expectedRevision: 3,
  confirmed: true as const,
  reason: "Confirm initial roster import",
  operationId: "40000000-0000-4000-8000-000000000001",
};

describe("member import apply request", () => {
  it("authenticates before validating input and binds the actor", async () => {
    const execute = vi.fn().mockResolvedValue({
      jobId: input.jobId,
      state: "applying",
      revision: 4,
    });
    const result = await runMemberImportApplyRequest(input, null, {
      execute,
      verifySession: vi.fn().mockResolvedValue({
        userId: "10000000-0000-4000-8000-000000000001",
      }),
    });
    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
      input,
      expect.any(String),
    );
  });

  it("rejects missing confirmation and reason before execution", async () => {
    const execute = vi.fn();
    const result = await runMemberImportApplyRequest(
      { ...input, confirmed: false, reason: "" },
      null,
      {
        execute,
        verifySession: vi.fn().mockResolvedValue({
          userId: "10000000-0000-4000-8000-000000000001",
        }),
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "validation" },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves a durable settings-drift requeue receipt", async () => {
    const execute = vi.fn().mockResolvedValue({
      jobId: input.jobId,
      state: "uploaded",
      revision: 5,
    });
    await expect(
      runMemberImportApplyRequest(input, null, {
        execute,
        verifySession: vi.fn().mockResolvedValue({
          userId: "10000000-0000-4000-8000-000000000001",
        }),
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: { state: "uploaded", revision: 5 },
    });
  });
});
