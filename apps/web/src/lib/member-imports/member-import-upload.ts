import { resolveCorrelationId } from "../mutations/correlation";
import { MutationError } from "../mutations/result";
import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import {
  fingerprintMemberCsv,
  parseMemberCsv,
  type MemberCsvError,
  type MemberCsvRow,
} from "./member-csv";

export const MAX_MEMBER_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_MEMBER_IMPORT_ROWS = 500;

export type SubmittedMemberImport = Readonly<{
  jobId: string;
  state:
    "uploaded" | "validating" | "ready" | "rejected" | "applying" | "completed";
  totalRows: number;
}>;

export type MemberImportUploadResult =
  | Readonly<{
      ok: true;
      correlationId: string;
      job: SubmittedMemberImport;
    }>
  | Readonly<{
      ok: false;
      code:
        "authentication_required" | "forbidden" | "validation" | "unavailable";
      correlationId: string;
      errors?: readonly MemberCsvError[];
    }>;

export type MemberImportUploadDependencies = Readonly<{
  createJob: (
    actorUserId: string,
    input: Readonly<{
      sourceFingerprint: string;
      rows: readonly MemberCsvRow[];
    }>,
    correlationId: string,
  ) => Promise<SubmittedMemberImport>;
  verifySession: () => Promise<VerifiedMutationSession>;
}>;

function validationFailure(
  correlationId: string,
  error: MemberCsvError,
): MemberImportUploadResult {
  return { ok: false, code: "validation", correlationId, errors: [error] };
}

export async function runMemberImportUpload(
  request: Request,
  correlationCandidate: string | null | undefined,
  dependencies: MemberImportUploadDependencies,
): Promise<MemberImportUploadResult> {
  const correlationId = resolveCorrelationId(correlationCandidate);
  let session: VerifiedMutationSession;
  try {
    session = await dependencies.verifySession();
  } catch (error) {
    return {
      ok: false,
      code:
        error instanceof MutationError &&
        error.code === "authentication_required"
          ? "authentication_required"
          : "unavailable",
      correlationId,
    };
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return validationFailure(correlationId, {
      code: "invalid_form",
      message: "Upload one CSV file.",
    });
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return validationFailure(correlationId, {
      code: "file_required",
      message: "Choose a non-empty CSV file.",
    });
  }
  if (file.size > MAX_MEMBER_IMPORT_BYTES) {
    return validationFailure(correlationId, {
      code: "file_too_large",
      message: "The CSV must be 2 MiB or smaller.",
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return validationFailure(correlationId, {
      code: "invalid_encoding",
      message: "The CSV must use UTF-8 encoding.",
    });
  }

  const parsed = parseMemberCsv(source);
  if (!parsed.ok) {
    return {
      ok: false,
      code: "validation",
      correlationId,
      errors: parsed.errors,
    };
  }
  if (parsed.rows.length === 0) {
    return validationFailure(correlationId, {
      code: "row_required",
      message: "Add at least one member row below the CSV header.",
    });
  }
  if (parsed.rows.length > MAX_MEMBER_IMPORT_ROWS) {
    return validationFailure(correlationId, {
      code: "row_limit",
      message: `The CSV may contain at most ${MAX_MEMBER_IMPORT_ROWS} member rows.`,
    });
  }

  try {
    const job = await dependencies.createJob(
      session.userId,
      {
        sourceFingerprint: fingerprintMemberCsv(bytes),
        rows: parsed.rows,
      },
      correlationId,
    );
    return { ok: true, correlationId, job };
  } catch (error) {
    const code =
      error instanceof MutationError &&
      (error.code === "authentication_required" || error.code === "forbidden")
        ? error.code
        : "unavailable";
    return { ok: false, code, correlationId };
  }
}
