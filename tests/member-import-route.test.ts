import { describe, expect, it, vi } from "vitest";

import { handleMemberImportUpload } from "../apps/web/src/app/api/member-imports/route";
import { handleGetMemberImport } from "../apps/web/src/app/api/member-imports/[jobId]/route";
import { GET as getTemplate } from "../apps/web/src/app/api/member-imports/template/route";
import { MutationError } from "../apps/web/src/lib/mutations/result";

function request() {
  const form = new FormData();
  form.set(
    "file",
    new File(
      ["first_name,last_name,invited_email\nAlex,Player,a@example.test\n"],
      "members.csv",
    ),
  );
  return new Request("http://localhost/api/member-imports", {
    body: form,
    headers: { "x-correlation-id": "20000000-0000-4000-8000-000000000001" },
    method: "POST",
  });
}

describe("member import HTTP routes", () => {
  it("returns an asynchronous job receipt without caching", async () => {
    const response = await handleMemberImportUpload(request(), {
      createJob: vi.fn().mockResolvedValue({
        jobId: "30000000-0000-4000-8000-000000000001",
        state: "uploaded",
        totalRows: 1,
      }),
      verifySession: vi
        .fn()
        .mockResolvedValue({ userId: "10000000-0000-4000-8000-000000000001" }),
    });
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      correlationId: "20000000-0000-4000-8000-000000000001",
      job: { state: "uploaded", totalRows: 1 },
    });
  });

  it("uses neutral HTTP errors for expired sessions and malformed files", async () => {
    const unauthorized = await handleMemberImportUpload(request(), {
      createJob: vi.fn(),
      verifySession: vi
        .fn()
        .mockRejectedValue(new MutationError("authentication_required")),
    });
    expect(unauthorized.status).toBe(401);

    const malformed = await handleMemberImportUpload(
      new Request("http://localhost/api/member-imports", {
        body: "bad",
        method: "POST",
      }),
      {
        createJob: vi.fn(),
        verifySession: vi.fn().mockResolvedValue({
          userId: "10000000-0000-4000-8000-000000000001",
        }),
      },
    );
    expect(malformed.status).toBe(400);
  });

  it("returns an explicit role denial when job creation is forbidden", async () => {
    const response = await handleMemberImportUpload(request(), {
      createJob: vi.fn().mockRejectedValue(new MutationError("forbidden")),
      verifySession: vi
        .fn()
        .mockResolvedValue({ userId: "10000000-0000-4000-8000-000000000001" }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("downloads the canonical UTF-8 template", async () => {
    const response = getTemplate();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "greenroster-members.csv",
    );
    expect(await response.text()).toContain(
      "first_name,last_name,invited_email",
    );
  });

  it("returns only the authenticated safe job projection", async () => {
    const jobId = "30000000-0000-4000-8000-000000000001";
    const projection = {
      jobId,
      state: "ready" as const,
      totalRows: 2,
      validRows: 1,
      invalidRows: 0,
      skippedRows: 1,
      appliedRows: 0,
      revision: 3,
      rows: [
        { rowNumber: 2, state: "valid", errors: [] },
        { rowNumber: 3, state: "skipped_existing", errors: [] },
      ],
    };
    const getJob = vi.fn().mockResolvedValue(projection);
    const response = await handleGetMemberImport(jobId, {
      getJob,
      verifySession: vi.fn().mockResolvedValue({
        userId: "10000000-0000-4000-8000-000000000001",
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      job: projection,
    });
    expect(getJob).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
      jobId,
    );
  });

  it("distinguishes expired sessions and revoked import access", async () => {
    const jobId = "30000000-0000-4000-8000-000000000001";
    const expired = await handleGetMemberImport(jobId, {
      getJob: vi.fn(),
      verifySession: vi
        .fn()
        .mockRejectedValue(new MutationError("authentication_required")),
    });
    expect(expired.status).toBe(401);
    await expect(expired.json()).resolves.toMatchObject({
      status: "authentication_required",
    });

    const forbidden = await handleGetMemberImport(jobId, {
      getJob: vi.fn().mockRejectedValue(new MutationError("forbidden")),
      verifySession: vi
        .fn()
        .mockResolvedValue({ userId: "10000000-0000-4000-8000-000000000001" }),
    });
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      status: "forbidden",
    });
  });
});
