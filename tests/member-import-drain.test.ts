import { describe, expect, it, vi } from "vitest";

import {
  handleMemberImportDrain,
  runMemberImportDrain,
} from "../apps/web/src/app/api/jobs/member-imports/drain/route";

describe("member import drain", () => {
  it("drains bounded jobs and stops on empty", async () => {
    const runOne = vi
      .fn()
      .mockResolvedValueOnce({ kind: "ready", jobId: "one" })
      .mockResolvedValueOnce({
        kind: "completed",
        jobId: "two",
        appliedRows: 2,
        skippedRows: 0,
      })
      .mockResolvedValueOnce({ kind: "empty" });
    await expect(runMemberImportDrain(runOne, 5)).resolves.toMatchObject({
      kind: "completed",
      jobId: "two",
    });
    expect(runOne).toHaveBeenCalledTimes(3);
  });

  it("requires the configured cron bearer and reports worker availability", async () => {
    const unauthorized = await handleMemberImportDrain(
      new Request("http://localhost/api/jobs/member-imports/drain"),
      { getJobSecret: () => "secret", runOne: vi.fn() },
    );
    expect(unauthorized.status).toBe(401);

    const authorized = await handleMemberImportDrain(
      new Request("http://localhost/api/jobs/member-imports/drain", {
        headers: { authorization: "Bearer secret" },
      }),
      {
        getJobSecret: () => "secret",
        runOne: vi.fn().mockResolvedValue({ kind: "empty" }),
      },
    );
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toEqual({
      ok: true,
      status: "empty",
    });
  });
});
