import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { runLegacyImportUpload } from "../../../lib/legacy-imports/legacy-import-upload";

export async function POST(request: Request) {
  const requestHeaders = await headers();
  const result = await runLegacyImportUpload(
    request,
    requestHeaders.get("x-correlation-id"),
  );
  return NextResponse.json(result, {
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
