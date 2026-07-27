import {
  runMemberImportUpload,
  type MemberImportUploadDependencies,
} from "../../../lib/member-imports/member-import-upload";

const defaultDependencies: MemberImportUploadDependencies = {
  createJob: async (...arguments_) => {
    const { executeCreateMemberImport } =
      await import("../../../lib/member-imports/member-import-data");
    return executeCreateMemberImport(...arguments_);
  },
  verifySession: async () => {
    const { verifyMutationSession } =
      await import("../../../lib/auth/verify-mutation-session");
    return verifyMutationSession();
  },
};

export async function handleMemberImportUpload(
  request: Request,
  overrides?: Partial<MemberImportUploadDependencies>,
): Promise<Response> {
  const result = await runMemberImportUpload(
    request,
    request.headers.get("x-correlation-id"),
    { ...defaultDependencies, ...overrides },
  );
  const status = result.ok
    ? 202
    : result.code === "authentication_required"
      ? 401
      : result.code === "forbidden"
        ? 403
        : result.code === "validation"
          ? 400
          : 503;
  return Response.json(result, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleMemberImportUpload(request);
}
