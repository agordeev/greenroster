import { z } from "zod";

import type { VerifiedMutationSession } from "../../../../../lib/auth/verify-mutation-session";
import { resolveCorrelationId } from "../../../../../lib/mutations/correlation";
import { MutationError } from "../../../../../lib/mutations/result";

const mappingInputSchema = z
  .object({
    rowId: z.uuid(),
    mappingState: z.enum(["matched", "ambiguous", "rejected"]),
    targetType: z
      .string()
      .regex(/^[a-z][a-z0-9_.-]{1,63}$/u)
      .nullable(),
    targetId: z.uuid().nullable(),
    mappingMethod: z
      .string()
      .regex(/^[a-z][a-z0-9_.-]{1,63}$/u)
      .nullable(),
    reason: z.string().trim().min(1).max(500),
    expectedRevision: z.number().int().positive(),
    operationId: z.uuid(),
  })
  .strict();

export type LegacyImportMappingDependencies = Readonly<{
  setMapping: (
    actorUserId: string,
    input: z.infer<typeof mappingInputSchema> & { importJobId: string },
    correlationId: string,
  ) => Promise<
    Readonly<{ jobId: string; rowId: string; state: string; revision: number }>
  >;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

const defaults: LegacyImportMappingDependencies = {
  setMapping: async (actorUserId, input, correlationId) => {
    const { executeSetLegacyImportMapping } =
      await import("../../../../../lib/legacy-imports/legacy-import-data");
    return executeSetLegacyImportMapping(
      actorUserId,
      {
        importJobId: input.importJobId,
        rowId: input.rowId,
        mappingState: input.mappingState,
        targetType: input.targetType,
        targetId: input.targetId,
        mappingMethod: input.mappingMethod,
        reason: input.reason,
        expectedRevision: input.expectedRevision,
        operationId: input.operationId,
      },
      correlationId,
    );
  },
  verifySession: async () => {
    const { verifyMutationSession } =
      await import("../../../../../lib/auth/verify-mutation-session");
    return verifyMutationSession();
  },
};

function responseForError(error: unknown): Response {
  if (error instanceof MutationError) {
    const status =
      error.code === "authentication_required"
        ? 401
        : error.code === "forbidden"
          ? 403
          : error.code === "validation"
            ? 422
            : error.code === "locked" || error.code === "stale_version"
              ? 409
              : 503;
    return Response.json(
      {
        ok: false,
        status:
          error.code === "authentication_required"
            ? "authentication_required"
            : error.code === "forbidden"
              ? "forbidden"
              : error.code === "validation"
                ? "validation"
                : error.code === "locked"
                  ? "locked"
                  : error.code === "stale_version"
                    ? "stale_version"
                    : "unavailable",
      },
      { headers: { "Cache-Control": "no-store" }, status },
    );
  }
  return Response.json(
    { ok: false, status: "unavailable" },
    { headers: { "Cache-Control": "no-store" }, status: 503 },
  );
}

export async function handleSetLegacyImportMapping(
  request: Request,
  jobIdCandidate: string,
  overrides?: Partial<LegacyImportMappingDependencies>,
): Promise<Response> {
  const jobId = z.uuid().safeParse(jobIdCandidate);
  const correlationId = resolveCorrelationId(
    request.headers.get("x-correlation-id"),
  );
  if (!jobId.success) {
    return Response.json(
      { ok: false, status: "not_found" },
      { headers: { "Cache-Control": "no-store" }, status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, status: "validation", correlationId },
      { headers: { "Cache-Control": "no-store" }, status: 422 },
    );
  }
  const parsed = mappingInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, status: "validation", correlationId },
      { headers: { "Cache-Control": "no-store" }, status: 422 },
    );
  }

  const dependencies = { ...defaults, ...overrides };
  try {
    const session = await dependencies.verifySession();
    const mapping = await dependencies.setMapping(
      session.userId,
      { ...parsed.data, importJobId: jobId.data },
      correlationId,
    );
    return Response.json(
      { ok: true, correlationId, mapping },
      { headers: { "Cache-Control": "no-store" }, status: 200 },
    );
  } catch (error) {
    return responseForError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params;
  return handleSetLegacyImportMapping(request, jobId);
}
