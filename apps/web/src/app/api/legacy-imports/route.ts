import {
  runLegacyImportUpload,
  type LegacyImportUploadDependencies,
} from "../../../lib/legacy-imports/legacy-import-upload";

export async function handleLegacyImportUpload(
  request: Request,
  overrides?: Partial<LegacyImportUploadDependencies>,
): Promise<Response> {
  const result = await runLegacyImportUpload(
    request,
    request.headers.get("x-correlation-id"),
    overrides,
  );
  return Response.json(result, {
    status: result.ok
      ? 202
      : result.code === "authentication_required"
        ? 401
        : result.code === "forbidden"
          ? 403
          : result.code === "validation"
            ? 422
            : 503,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  return handleLegacyImportUpload(request);
}
