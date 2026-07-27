import { describe, expect, it, vi } from "vitest";

import {
  MAX_MEMBER_IMPORT_BYTES,
  runMemberImportUpload,
} from "../apps/web/src/lib/member-imports/member-import-upload";
import { MutationError } from "../apps/web/src/lib/mutations/result";

function uploadRequest(contents: string | Uint8Array) {
  const form = new FormData();
  form.set("file", new File([contents], "members.csv", { type: "text/csv" }));
  return new Request("http://localhost/api/member-imports", {
    body: form,
    method: "POST",
  });
}

const session = { userId: "10000000-0000-4000-8000-000000000001" };

describe("member import upload boundary", () => {
  it("authenticates before parsing attacker-controlled CSV input", async () => {
    const createJob = vi.fn();
    const result = await runMemberImportUpload(
      new Request("http://localhost/api/member-imports", {
        body: "not multipart",
        method: "POST",
      }),
      null,
      {
        createJob,
        verifySession: vi
          .fn()
          .mockRejectedValue(new MutationError("authentication_required")),
      },
    );
    expect(result).toMatchObject({
      ok: false,
      code: "authentication_required",
    });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("submits normalized rows with the exact-byte fingerprint", async () => {
    const createJob = vi.fn().mockResolvedValue({
      jobId: "30000000-0000-4000-8000-000000000001",
      state: "uploaded",
      totalRows: 1,
    });
    const result = await runMemberImportUpload(
      uploadRequest(
        "first_name,last_name,invited_email\r\nAlex,Player,A@Example.test\r\n",
      ),
      "20000000-0000-4000-8000-000000000001",
      { createJob, verifySession: vi.fn().mockResolvedValue(session) },
    );
    expect(result).toMatchObject({
      ok: true,
      job: { state: "uploaded", totalRows: 1 },
    });
    expect(createJob).toHaveBeenCalledWith(
      session.userId,
      expect.objectContaining({
        sourceFingerprint:
          "bae21e932f788c5aa6387b251ef16fdf8bd6fb17a2b740a2c70329744854c408",
        rows: [
          expect.objectContaining({
            rowNumber: 2,
            values: expect.objectContaining({
              invited_email: "a@example.test",
            }),
          }),
        ],
      }),
      "20000000-0000-4000-8000-000000000001",
    );
  });

  it("returns all parser errors without creating a job", async () => {
    const createJob = vi.fn();
    const result = await runMemberImportUpload(
      uploadRequest("first_name,last_name,invited_email\n,Player,not-email\n"),
      null,
      { createJob, verifySession: vi.fn().mockResolvedValue(session) },
    );
    expect(result).toMatchObject({ ok: false, code: "validation" });
    if (result.ok || result.code !== "validation") return;
    expect(result.errors?.map((error) => error.code)).toEqual(
      expect.arrayContaining(["required", "invalid_email"]),
    );
    expect(createJob).not.toHaveBeenCalled();
  });

  it("rejects the downloaded header-only template before job creation", async () => {
    const createJob = vi.fn();
    const result = await runMemberImportUpload(
      uploadRequest("first_name,last_name,invited_email\n"),
      null,
      { createJob, verifySession: vi.fn().mockResolvedValue(session) },
    );
    expect(result).toMatchObject({
      ok: false,
      code: "validation",
      errors: [{ code: "row_required" }],
    });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("preserves a role denial from job creation", async () => {
    const result = await runMemberImportUpload(
      uploadRequest(
        "first_name,last_name,invited_email\nAlex,Player,a@example.test\n",
      ),
      null,
      {
        createJob: vi.fn().mockRejectedValue(new MutationError("forbidden")),
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("rejects non-UTF-8 and oversized files before job creation", async () => {
    const createJob = vi.fn();
    const invalidUtf8 = await runMemberImportUpload(
      uploadRequest(new Uint8Array([0xff, 0xfe])),
      null,
      { createJob, verifySession: vi.fn().mockResolvedValue(session) },
    );
    expect(invalidUtf8).toMatchObject({
      ok: false,
      code: "validation",
      errors: [{ code: "invalid_encoding" }],
    });

    const oversized = await runMemberImportUpload(
      uploadRequest(new Uint8Array(MAX_MEMBER_IMPORT_BYTES + 1)),
      null,
      { createJob, verifySession: vi.fn().mockResolvedValue(session) },
    );
    expect(oversized).toMatchObject({
      ok: false,
      code: "validation",
      errors: [{ code: "file_too_large" }],
    });
    expect(createJob).not.toHaveBeenCalled();
  });
});
