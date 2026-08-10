import { z } from "zod";

import type { VerifiedMutationSession } from "../../../../lib/auth/verify-mutation-session";
import type { LegacyImportProjection } from "../../../../lib/legacy-imports/legacy-import-data";
import { MutationError } from "../../../../lib/mutations/result";

type Dependencies = Readonly<{
  getJob: (
    actorUserId: string,
    jobId: string,
    options?: Readonly<{ afterRowNumber?: number; limit?: number }>,
  ) => Promise<LegacyImportProjection>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

const defaults: Dependencies = {
  getJob: async (...arguments_) => {
    const { executeGetLegacyImport } =
      await import("../../../../lib/legacy-imports/legacy-import-data");
    return executeGetLegacyImport(...arguments_);
  },
  verifySession: async () => {
    const { verifyMutationSession } =
      await import("../../../../lib/auth/verify-mutation-session");
    return verifyMutationSession();
  },
};

export async function handleGetLegacyImport(
  jobIdCandidate: string,
  overrides?: Partial<Dependencies>,
  request?: Request,
): Promise<Response> {
  const query = request ? new URL(request.url).searchParams : null;
  const queryKeys = query ? [...new Set(query.keys())] : [];
  const hasQuery = queryKeys.length > 0;
  const afterRowNumber = query ? query.get("cursor") : null;
  const limit = query ? query.get("limit") : null;
  const parsedCursor =
    afterRowNumber === null ? undefined : Number(afterRowNumber);
  const parsedLimit = limit === null ? undefined : Number(limit);
  if (
    hasQuery &&
    (queryKeys.some((key) => key !== "cursor" && key !== "limit") ||
      (query?.getAll("cursor").length ?? 0) > 1 ||
      (query?.getAll("limit").length ?? 0) > 1 ||
      (afterRowNumber !== null &&
        (!/^\d+$/u.test(afterRowNumber) ||
          parsedCursor === undefined ||
          !Number.isInteger(parsedCursor) ||
          parsedCursor < 1)) ||
      (limit !== null &&
        (!/^\d+$/u.test(limit) ||
          parsedLimit === undefined ||
          !Number.isInteger(parsedLimit) ||
          parsedLimit < 1 ||
          parsedLimit > 100)))
  ) {
    return Response.json(
      { ok: false, status: "validation" },
      { headers: { "Cache-Control": "no-store" }, status: 422 },
    );
  }
  const parsedJobId = z.uuid().safeParse(jobIdCandidate);
  if (!parsedJobId.success) {
    return Response.json({ ok: false, status: "not_found" }, { status: 404 });
  }
  const dependencies = { ...defaults, ...overrides };
  try {
    const session = await dependencies.verifySession();
    const job = hasQuery
      ? await dependencies.getJob(session.userId, parsedJobId.data, {
          afterRowNumber: parsedCursor,
          limit: parsedLimit,
        })
      : await dependencies.getJob(session.userId, parsedJobId.data);
    const responseJob = request
      ? { ...job, nextCursor: job.nextCursor ?? null }
      : job;
    return Response.json(
      { ok: true, job: responseJob },
      { headers: { "Cache-Control": "no-store" }, status: 200 },
    );
  } catch (error) {
    if (error instanceof MutationError) {
      if (error.code === "authentication_required") {
        return Response.json(
          { ok: false, status: "authentication_required" },
          { headers: { "Cache-Control": "no-store" }, status: 401 },
        );
      }
      if (error.code === "forbidden") {
        return Response.json(
          { ok: false, status: "forbidden" },
          { headers: { "Cache-Control": "no-store" }, status: 403 },
        );
      }
      if (error.code === "unavailable") {
        return Response.json(
          { ok: false, status: "unavailable" },
          { headers: { "Cache-Control": "no-store" }, status: 503 },
        );
      }
    }
    return Response.json(
      { ok: false, status: "unavailable" },
      { headers: { "Cache-Control": "no-store" }, status: 503 },
    );
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params;
  return handleGetLegacyImport(jobId, undefined, request);
}
