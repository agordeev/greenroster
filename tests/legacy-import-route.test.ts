import { describe, expect, it, vi } from "vitest";

import { handleGetLegacyImport } from "../apps/web/src/app/api/legacy-imports/[jobId]/route";
import { handleSetLegacyImportMapping } from "../apps/web/src/app/api/legacy-imports/[jobId]/mapping/route";
import { handleLegacyImportUpload } from "../apps/web/src/app/api/legacy-imports/route";
import {
  parseProfiledLegacyCsv,
  validateLegacyImportProfile,
  type LegacyImportProfile,
} from "../apps/web/src/lib/legacy-imports/legacy-csv";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const jobId = "30000000-0000-4000-8000-000000000001";
const correlationId = "20000000-0000-4000-8000-000000000001";

const profileInput = {
  profileKey: "golfdogfight-export",
  schemaVersion: "2026-08",
  legacyTypeHeader: "legacy_type",
  legacyKeyHeader: "legacy_key",
  mappings: [{ sourceHeader: "first_name", targetField: "first_name" }],
};

function uploadRequest(
  csv = "legacy_type,legacy_key,first_name,unused\nmember,m-1,Alex,ignored\n",
) {
  const form = new FormData();
  form.set("file", new File([csv], "golfdogfight.csv", { type: "text/csv" }));
  form.set("profile", JSON.stringify(profileInput));
  return new Request("http://localhost/api/legacy-imports", {
    body: form,
    headers: { "x-correlation-id": correlationId },
    method: "POST",
  });
}

describe("legacy import HTTP routes", () => {
  it("stages a profiled export as an asynchronous job receipt", async () => {
    const createJob = vi.fn().mockResolvedValue({
      jobId,
      profileKey: "golfdogfight-export",
      state: "mapping_required",
      totalRows: 1,
      exceptionRows: 1,
      revision: 2,
    });
    const response = await handleLegacyImportUpload(uploadRequest(), {
      createJob,
      verifySession: vi.fn().mockResolvedValue({ userId: actorUserId }),
      createId: vi
        .fn()
        .mockReturnValueOnce(jobId)
        .mockReturnValueOnce("40000000-0000-4000-8000-000000000001"),
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      correlationId,
      job: { jobId, state: "mapping_required", exceptionRows: 1 },
    });
    expect(createJob).toHaveBeenCalledWith(
      actorUserId,
      expect.objectContaining({
        importJobId: jobId,
        profile: expect.objectContaining({ profileKey: "golfdogfight-export" }),
        rows: [
          {
            rowNumber: 2,
            legacyType: "member",
            legacyKey: "m-1",
            payload: { first_name: "Alex" },
          },
        ],
        warnings: [
          expect.objectContaining({
            code: "unmapped_header",
            column: "unused",
          }),
        ],
      }),
      correlationId,
      "40000000-0000-4000-8000-000000000001",
    );
  });

  it("keeps authentication and profile/file failures explicit", async () => {
    const verifySession = vi
      .fn()
      .mockRejectedValue(new MutationError("authentication_required"));
    const unauthorized = await handleLegacyImportUpload(uploadRequest(), {
      verifySession,
      createJob: vi.fn(),
    });
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toMatchObject({
      ok: false,
      code: "authentication_required",
    });

    const missingProfile = new FormData();
    missingProfile.set(
      "file",
      new File(
        ["legacy_type,legacy_key,first_name\nmember,m-1,Alex\n"],
        "x.csv",
      ),
    );
    const invalid = await handleLegacyImportUpload(
      new Request("http://localhost/api/legacy-imports", {
        body: missingProfile,
        method: "POST",
      }),
      {
        verifySession: vi.fn().mockResolvedValue({ userId: actorUserId }),
        createJob: vi.fn(),
      },
    );
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      ok: false,
      code: "validation",
    });
  });

  it("returns only the authenticated safe job projection", async () => {
    const projection = {
      jobId,
      profileKey: "golfdogfight-export",
      schemaVersion: "2026-08",
      state: "mapping_required" as const,
      totalRows: 1,
      mappedRows: 0,
      exceptionRows: 1,
      revision: 2,
      rows: [
        {
          rowId: "50000000-0000-4000-8000-000000000001",
          rowNumber: 2,
          legacyType: "member",
          legacyKey: "m-1",
          state: "pending" as const,
          mappingState: "pending" as const,
          targetType: null,
          targetId: null,
          exceptionCount: 1,
        },
      ],
    };
    const getJob = vi.fn().mockResolvedValue(projection);
    const response = await handleGetLegacyImport(jobId, {
      getJob,
      verifySession: vi.fn().mockResolvedValue({ userId: actorUserId }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      job: projection,
    });
    expect(getJob).toHaveBeenCalledWith(actorUserId, jobId);
  });

  it("does not reveal whether an invalid or forbidden job exists", async () => {
    const invalid = await handleGetLegacyImport("not-a-uuid", {
      getJob: vi.fn(),
      verifySession: vi.fn(),
    });
    expect(invalid.status).toBe(404);

    const forbidden = await handleGetLegacyImport(jobId, {
      getJob: vi.fn().mockRejectedValue(new MutationError("forbidden")),
      verifySession: vi.fn().mockResolvedValue({ userId: actorUserId }),
    });
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({
      ok: false,
      status: "forbidden",
    });
  });

  it("validates and submits an explicit mapping decision", async () => {
    const rowId = "50000000-0000-4000-8000-000000000001";
    const setMapping = vi.fn().mockResolvedValue({
      jobId,
      rowId,
      state: "matched",
      revision: 3,
    });
    const payload = {
      rowId,
      mappingState: "matched",
      targetType: "member",
      targetId: "97000000-0000-4000-8000-000000000001",
      mappingMethod: "deterministic",
      reason: "The approved identity decision matches this member.",
      expectedRevision: 2,
      operationId: "40000000-0000-4000-8000-000000000001",
    };
    const response = await handleSetLegacyImportMapping(
      new Request("http://localhost/api/legacy-imports/job/mapping", {
        body: JSON.stringify(payload),
        headers: {
          "content-type": "application/json",
          "x-correlation-id": correlationId,
        },
        method: "POST",
      }),
      jobId,
      {
        setMapping,
        verifySession: vi.fn().mockResolvedValue({ userId: actorUserId }),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      correlationId,
      mapping: { state: "matched", revision: 3 },
    });
    expect(setMapping).toHaveBeenCalledWith(
      actorUserId,
      { ...payload, importJobId: jobId },
      correlationId,
    );

    const invalid = await handleSetLegacyImportMapping(
      new Request("http://localhost/api/legacy-imports/job/mapping", {
        body: JSON.stringify({ ...payload, expectedRevision: 0 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      jobId,
      {
        setMapping: vi.fn(),
        verifySession: vi.fn(),
      },
    );
    expect(invalid.status).toBe(422);
  });

  it("maps stale and forbidden decisions to safe HTTP states", async () => {
    const body = JSON.stringify({
      rowId: "50000000-0000-4000-8000-000000000001",
      mappingState: "rejected",
      targetType: null,
      targetId: null,
      mappingMethod: null,
      reason: "The source row remains unresolved.",
      expectedRevision: 2,
      operationId: "40000000-0000-4000-8000-000000000001",
    });
    const stale = await handleSetLegacyImportMapping(
      new Request("http://localhost/api/legacy-imports/job/mapping", {
        body,
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      jobId,
      {
        setMapping: vi
          .fn()
          .mockRejectedValue(new MutationError("stale_version")),
        verifySession: vi.fn().mockResolvedValue({ userId: actorUserId }),
      },
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      ok: false,
      status: "stale_version",
    });

    const forbidden = await handleSetLegacyImportMapping(
      new Request("http://localhost/api/legacy-imports/job/mapping", {
        body,
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      jobId,
      {
        setMapping: vi.fn(),
        verifySession: vi
          .fn()
          .mockRejectedValue(new MutationError("forbidden")),
      },
    );
    expect(forbidden.status).toBe(403);
  });
});

describe("profiled legacy CSV validation", () => {
  it("rejects secret source columns before they can be mapped to safe names", () => {
    const validated = validateLegacyImportProfile({
      ...profileInput,
      mappings: [{ sourceHeader: "password", targetField: "first_name" }],
    });
    expect(validated).toMatchObject({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "source_header_sensitive",
          field: "mappings.0.sourceHeader",
        }),
      ],
    });
  });

  it("redacts secret source values even when a caller bypasses profile validation", () => {
    const unsafeProfile = {
      ...profileInput,
      mappings: [{ sourceHeader: "password", targetField: "first_name" }],
    } as LegacyImportProfile;
    const parsed = parseProfiledLegacyCsv(
      "legacy_type,legacy_key,password\nmember,m-1,do-not-stage\n",
      unsafeProfile,
    );
    expect(parsed).toMatchObject({
      ok: true,
      rows: [expect.objectContaining({ payload: {} })],
    });
  });

  it("retains unmapped-column warnings and rejects duplicate source keys", () => {
    const validated = validateLegacyImportProfile(profileInput);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const parsed = parseProfiledLegacyCsv(
      "legacy_type,legacy_key,first_name,old_field\nmember,m-1,Alex,ignored\nmember,m-1,Alex,ignored\n",
      validated.profile,
    );
    expect(parsed).toMatchObject({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "duplicate_legacy_key",
          rowNumber: 3,
        }),
      ],
    });
  });

  it("accepts quoted values without exposing unmapped fields as payload", () => {
    const validated = validateLegacyImportProfile(profileInput);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const parsed = parseProfiledLegacyCsv(
      'legacy_type,legacy_key,first_name,old_field\nmember,"m,1","Alex, Jr",ignored\n',
      validated.profile,
    );
    expect(parsed).toEqual({
      ok: true,
      rows: [
        {
          rowNumber: 2,
          legacyType: "member",
          legacyKey: "m,1",
          payload: { first_name: "Alex, Jr" },
        },
      ],
      warnings: [expect.objectContaining({ code: "unmapped_header" })],
    });
  });
});
