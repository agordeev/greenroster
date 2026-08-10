import { resolveCorrelationId } from "../mutations/correlation";
import { MutationError } from "../mutations/result";
import type { VerifiedMutationSession } from "../auth/verify-mutation-session";
import {
  fingerprintLegacyCsv,
  LEGACY_IMPORT_MAX_BYTES,
  LEGACY_IMPORT_MAX_ROWS,
  parseProfiledLegacyCsv,
  validateLegacyImportProfile,
  type LegacyImportCsvError,
  type LegacyImportProfile,
} from "./legacy-csv";
import type {
  executeCreateLegacyImport,
  LegacyImportSubmission,
} from "./legacy-import-data";

export type LegacyImportUploadResult =
  | Readonly<{
      ok: true;
      correlationId: string;
      job: LegacyImportSubmission;
    }>
  | Readonly<{
      ok: false;
      code:
        "authentication_required" | "forbidden" | "validation" | "unavailable";
      correlationId: string;
      errors?: readonly LegacyImportCsvError[];
    }>;

export type LegacyImportUploadDependencies = Readonly<{
  verifySession: () => Promise<VerifiedMutationSession>;
  createJob: (
    actorUserId: string,
    input: Readonly<{
      importJobId: string;
      profile: LegacyImportProfile;
      sourceFingerprint: string;
      rows: Parameters<typeof executeCreateLegacyImport>[1]["rows"];
      warnings: Parameters<typeof executeCreateLegacyImport>[1]["warnings"];
    }>,
    correlationId: string,
    operationId: string,
  ) => Promise<LegacyImportSubmission>;
  createId: () => string;
}>;

const defaults: LegacyImportUploadDependencies = {
  verifySession: async () => {
    const { verifyMutationSession } =
      await import("../auth/verify-mutation-session");
    return verifyMutationSession();
  },
  createJob: async (actorUserId, input, correlationId, operationId) => {
    const { executeCreateLegacyImport } = await import("./legacy-import-data");
    return executeCreateLegacyImport(
      actorUserId,
      {
        importJobId: input.importJobId,
        profileKey: input.profile.profileKey,
        schemaVersion: input.profile.schemaVersion,
        sourceFingerprint: input.sourceFingerprint,
        rows: input.rows,
        warnings: input.warnings,
      },
      correlationId,
      operationId,
    );
  },
  createId: () => crypto.randomUUID(),
};

function failure(
  correlationId: string,
  error: LegacyImportCsvError,
): LegacyImportUploadResult {
  return { ok: false, code: "validation", correlationId, errors: [error] };
}

export async function runLegacyImportUpload(
  request: Request,
  correlationCandidate: string | null | undefined,
  overrides?: Partial<LegacyImportUploadDependencies>,
): Promise<LegacyImportUploadResult> {
  const dependencies = { ...defaults, ...overrides };
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
    return failure(correlationId, {
      code: "invalid_form",
      message: "You upload one profiled CSV file and its source profile.",
    });
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return failure(correlationId, {
      code: "file_required",
      message: "You choose a non-empty CSV file.",
    });
  }
  if (file.size > LEGACY_IMPORT_MAX_BYTES) {
    return failure(correlationId, {
      code: "file_too_large",
      message: `You upload a CSV of ${LEGACY_IMPORT_MAX_BYTES / (1024 * 1024)} MiB or less.`,
    });
  }

  let profileInput: unknown;
  try {
    profileInput = JSON.parse(String(formData.get("profile") ?? ""));
  } catch {
    return failure(correlationId, {
      code: "profile_invalid",
      message: "You provide a valid source profile before you upload the file.",
    });
  }
  const profile = validateLegacyImportProfile(profileInput);
  if (!profile.ok) {
    return {
      ok: false,
      code: "validation",
      correlationId,
      errors: profile.errors.map((error) => ({
        code: error.code,
        column: error.field,
        message: error.message,
      })),
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return failure(correlationId, {
      code: "invalid_encoding",
      message: "You upload a UTF-8 CSV file.",
    });
  }
  const parsed = parseProfiledLegacyCsv(source, profile.profile);
  if (!parsed.ok)
    return {
      ok: false,
      code: "validation",
      correlationId,
      errors: parsed.errors,
    };
  if (parsed.rows.length === 0) {
    return failure(correlationId, {
      code: "row_required",
      message: "You add at least one row below the CSV header.",
    });
  }
  if (parsed.rows.length > LEGACY_IMPORT_MAX_ROWS) {
    return failure(correlationId, {
      code: "row_limit",
      message: `You upload at most ${LEGACY_IMPORT_MAX_ROWS} rows at a time.`,
    });
  }

  try {
    const importJobId = dependencies.createId();
    const operationId = dependencies.createId();
    const job = await dependencies.createJob(
      session.userId,
      {
        importJobId,
        profile: profile.profile,
        sourceFingerprint: fingerprintLegacyCsv(bytes),
        rows: parsed.rows,
        warnings: parsed.warnings,
      },
      correlationId,
      operationId,
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
