import "server-only";

import { z } from "zod";

import { MutationError } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";
import type { MemberCsvRow } from "./member-csv";
import type { SubmittedMemberImport } from "./member-import-upload";
import type {
  MemberImportApplyInput,
  MemberImportApplyReceipt,
} from "./member-import-apply";

const importStateSchema = z.enum([
  "uploaded",
  "validating",
  "ready",
  "rejected",
  "applying",
  "completed",
]);

const rowsSchema = z
  .array(
    z
      .object({
        import_job_id: z.uuid(),
        group_id: z.uuid(),
        state: importStateSchema,
        total_rows: z.number().int().positive(),
        revision: z.number().int().positive(),
      })
      .strict(),
  )
  .length(1);

type RpcError = Readonly<{ code?: string }>;

function importError(error: RpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (error.code === "P0001")
    return new MutationError("locked", { cause: error });
  if (error.code === "40001")
    return new MutationError("stale_version", { cause: error });
  if (
    error.code === "22023" ||
    error.code === "23505" ||
    error.code === "23514"
  ) {
    return new MutationError("validation", { cause: error });
  }
  return new MutationError(error.code ? "unexpected" : "transient", {
    cause: error,
  });
}

export async function executeCreateMemberImport(
  actorUserId: string,
  input: Readonly<{
    sourceFingerprint: string;
    rows: readonly MemberCsvRow[];
  }>,
  correlationId: string,
): Promise<SubmittedMemberImport> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("create_member_csv_import", {
    p_actor_user_id: actorUserId,
    p_import_job_id: crypto.randomUUID(),
    p_source_fingerprint: input.sourceFingerprint,
    p_rows: input.rows.map((row) => row.values),
    p_correlation_id: correlationId,
    p_operation_id: crypto.randomUUID(),
  });
  if (error) throw importError(error);

  const parsed = rowsSchema.safeParse(data);
  const row = parsed.success ? parsed.data[0] : undefined;
  if (!row) throw new MutationError("unexpected", { cause: parsed.error });
  return {
    jobId: row.import_job_id,
    state: row.state,
    totalRows: row.total_rows,
  };
}

const jobProjectionRowsSchema = z.array(
  z
    .object({
      import_job_id: z.uuid(),
      group_id: z.uuid(),
      state: importStateSchema,
      total_rows: z.number().int().nonnegative(),
      valid_rows: z.number().int().nonnegative(),
      invalid_rows: z.number().int().nonnegative(),
      skipped_rows: z.number().int().nonnegative(),
      applied_rows: z.number().int().nonnegative(),
      revision: z.number().int().positive(),
      row_number: z.number().int().positive(),
      row_state: z.enum([
        "pending",
        "valid",
        "invalid",
        "skipped_existing",
        "applied",
        "apply_failed",
      ]),
      error_codes: z.array(
        z
          .object({ code: z.string(), column: z.string().optional() })
          .passthrough(),
      ),
      membership_id: z.uuid().nullable(),
      invitation_id: z.uuid().nullable(),
    })
    .strict(),
);

export type MemberImportJobProjection = Readonly<{
  jobId: string;
  state: SubmittedMemberImport["state"];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  skippedRows: number;
  appliedRows: number;
  revision: number;
  rows: readonly Readonly<{
    rowNumber: number;
    state: string;
    errors: readonly Readonly<{ code: string; column?: string }>[];
  }>[];
}>;

export async function executeGetMemberImport(
  actorUserId: string,
  jobId: string,
): Promise<MemberImportJobProjection> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("get_member_csv_import", {
    p_actor_user_id: actorUserId,
    p_import_job_id: jobId,
  });
  if (error) throw importError(error);
  const parsed = jobProjectionRowsSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  const first = parsed.data[0];
  if (!first) throw new MutationError("unexpected");
  return {
    jobId: first.import_job_id,
    state: first.state,
    totalRows: first.total_rows,
    validRows: first.valid_rows,
    invalidRows: first.invalid_rows,
    skippedRows: first.skipped_rows,
    appliedRows: first.applied_rows,
    revision: first.revision,
    rows: parsed.data.map((row) => ({
      rowNumber: row.row_number,
      state: row.row_state,
      errors: row.error_codes,
    })),
  };
}

const applyReceiptRowsSchema = z
  .array(
    z
      .object({
        requested_job_id: z.uuid(),
        group_id: z.uuid(),
        state: z.enum(["uploaded", "applying", "completed"]),
        revision: z.number().int().positive(),
        apply_operation_id: z.uuid().nullable(),
      })
      .strict(),
  )
  .length(1);

export async function executeRequestMemberImportApply(
  actorUserId: string,
  input: MemberImportApplyInput,
  correlationId: string,
): Promise<MemberImportApplyReceipt> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc(
    "request_member_csv_import_apply",
    {
      p_actor_user_id: actorUserId,
      p_import_job_id: input.jobId,
      p_expected_revision: input.expectedRevision,
      p_confirmed: input.confirmed,
      p_reason: input.reason,
      p_correlation_id: correlationId,
      p_operation_id: input.operationId,
    },
  );
  if (error) throw importError(error);
  const parsed = applyReceiptRowsSchema.safeParse(data);
  const row = parsed.success ? parsed.data[0] : undefined;
  if (!row) throw new MutationError("unexpected", { cause: parsed.error });
  return {
    jobId: row.requested_job_id,
    state: row.state,
    revision: row.revision,
  };
}
