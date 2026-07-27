import { z } from "zod";

import type { VerifiedMutationSession } from "../../../../lib/auth/verify-mutation-session";
import type { MemberImportJobProjection } from "../../../../lib/member-imports/member-import-data";
import { MutationError } from "../../../../lib/mutations/result";

type Dependencies = Readonly<{
  getJob: (
    actorUserId: string,
    jobId: string,
  ) => Promise<MemberImportJobProjection>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

const defaults: Dependencies = {
  getJob: async (...arguments_) => {
    const { executeGetMemberImport } =
      await import("../../../../lib/member-imports/member-import-data");
    return executeGetMemberImport(...arguments_);
  },
  verifySession: async () => {
    const { verifyMutationSession } =
      await import("../../../../lib/auth/verify-mutation-session");
    return verifyMutationSession();
  },
};

export async function handleGetMemberImport(
  jobIdCandidate: string,
  overrides?: Partial<Dependencies>,
): Promise<Response> {
  const parsedJobId = z.uuid().safeParse(jobIdCandidate);
  if (!parsedJobId.success) {
    return Response.json({ ok: false, status: "not_found" }, { status: 404 });
  }
  const dependencies = { ...defaults, ...overrides };
  try {
    const session = await dependencies.verifySession();
    const job = await dependencies.getJob(session.userId, parsedJobId.data);
    return Response.json(
      { ok: true, job },
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
    }
    return Response.json(
      { ok: false, status: "unavailable" },
      { headers: { "Cache-Control": "no-store" }, status: 503 },
    );
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params;
  return handleGetMemberImport(jobId);
}
