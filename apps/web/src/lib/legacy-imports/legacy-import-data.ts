import "server-only";

import { z } from "zod";

import type { LegacyImportRow } from "./legacy-csv";
import { MutationError } from "../mutations/result";
import { createSupabaseServiceClient } from "../supabase/service-client";

type RpcError = Readonly<{ code?: string; message?: string }>;

const stateSchema = z.enum([
  "staged",
  "mapping_required",
  "ready",
  "blocked",
  "applying",
  "completed",
]);
const rowStateSchema = z.enum([
  "pending",
  "mapped",
  "ambiguous",
  "invalid",
  "skipped",
  "applied",
]);
const mappingStateSchema = z.enum([
  "pending",
  "matched",
  "ambiguous",
  "rejected",
]);

const createRowsSchema = z
  .array(
    z
      .object({
        import_job_id: z.uuid(),
        group_id: z.uuid(),
        profile_key: z.string().min(2),
        state: stateSchema,
        total_rows: z.number().int().nonnegative(),
        exception_rows: z.number().int().nonnegative(),
        revision: z.number().int().positive(),
      })
      .strict(),
  )
  .length(1);

const projectionRowsSchema = z.array(
  z
    .object({
      import_job_id: z.uuid(),
      group_id: z.uuid(),
      profile_key: z.string().min(2),
      schema_version: z.string().min(1),
      state: stateSchema,
      total_rows: z.number().int().nonnegative(),
      mapped_rows: z.number().int().nonnegative(),
      exception_rows: z.number().int().nonnegative(),
      revision: z.number().int().positive(),
      row_id: z.uuid(),
      row_number: z.number().int().positive(),
      legacy_type: z.string().min(1),
      legacy_key: z.string().min(1),
      row_state: rowStateSchema,
      mapping_state: mappingStateSchema,
      target_type: z.string().nullable(),
      target_id: z.uuid().nullable(),
      exception_count: z.number().int().nonnegative(),
    })
    .strict(),
);

const mappingRowsSchema = z
  .array(
    z
      .object({
        import_job_id: z.uuid(),
        row_id: z.uuid(),
        row_state: rowStateSchema,
        mapping_state: mappingStateSchema,
        revision: z.number().int().positive(),
      })
      .strict(),
  )
  .length(1);

function mapError(error: RpcError): MutationError {
  if (error.code === "P0003")
    return new MutationError("forbidden", { cause: error });
  if (error.code === "P0002")
    return new MutationError("unavailable", { cause: error });
  if (error.code === "P0001")
    return new MutationError("locked", { cause: error });
  if (error.code === "40001")
    return new MutationError("stale_version", { cause: error });
  if (
    error.code === "23505" ||
    error.code === "22023" ||
    error.code === "23514"
  ) {
    return new MutationError("validation", { cause: error });
  }
  return new MutationError(error.code ? "unexpected" : "transient", {
    cause: error,
  });
}

export type LegacyImportSubmission = Readonly<{
  jobId: string;
  profileKey: string;
  state: z.infer<typeof stateSchema>;
  totalRows: number;
  exceptionRows: number;
  revision: number;
}>;

export async function executeCreateLegacyImport(
  actorUserId: string,
  input: Readonly<{
    importJobId: string;
    profileKey: string;
    schemaVersion: string;
    sourceFingerprint: string;
    rows: readonly LegacyImportRow[];
    warnings: readonly Readonly<{
      code: string;
      column?: string;
      message: string;
      rowNumber?: number;
    }>[];
  }>,
  correlationId: string,
  operationId: string,
): Promise<LegacyImportSubmission> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("create_legacy_import_job", {
    p_actor_user_id: actorUserId,
    p_import_job_id: input.importJobId,
    p_profile_key: input.profileKey,
    p_schema_version: input.schemaVersion,
    p_source_fingerprint: input.sourceFingerprint,
    p_rows: input.rows.map((row) => ({
      row_number: row.rowNumber,
      legacy_type: row.legacyType,
      legacy_key: row.legacyKey,
      payload: row.payload,
    })),
    p_warnings: input.warnings,
    p_correlation_id: correlationId,
    p_operation_id: operationId,
  });
  if (error) throw mapError(error);
  const parsed = createRowsSchema.safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  const row = parsed.data[0];
  return {
    jobId: row.import_job_id,
    profileKey: row.profile_key,
    state: row.state,
    totalRows: row.total_rows,
    exceptionRows: row.exception_rows,
    revision: row.revision,
  };
}

export type LegacyImportProjection = Readonly<{
  jobId: string;
  profileKey: string;
  schemaVersion: string;
  state: z.infer<typeof stateSchema>;
  totalRows: number;
  mappedRows: number;
  exceptionRows: number;
  revision: number;
  rows: readonly Readonly<{
    rowId: string;
    rowNumber: number;
    legacyType: string;
    legacyKey: string;
    state: z.infer<typeof rowStateSchema>;
    mappingState: z.infer<typeof mappingStateSchema>;
    targetType: string | null;
    targetId: string | null;
    exceptionCount: number;
  }>[];
}>;

export async function executeGetLegacyImport(
  actorUserId: string,
  importJobId: string,
): Promise<LegacyImportProjection> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("get_legacy_import_job", {
    p_actor_user_id: actorUserId,
    p_import_job_id: importJobId,
  });
  if (error) throw mapError(error);
  const parsed = projectionRowsSchema.safeParse(data);
  if (!parsed.success || parsed.data.length === 0) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }
  const first = parsed.data[0];
  return {
    jobId: first.import_job_id,
    profileKey: first.profile_key,
    schemaVersion: first.schema_version,
    state: first.state,
    totalRows: first.total_rows,
    mappedRows: first.mapped_rows,
    exceptionRows: first.exception_rows,
    revision: first.revision,
    rows: parsed.data.map((row) => ({
      rowId: row.row_id,
      rowNumber: row.row_number,
      legacyType: row.legacy_type,
      legacyKey: row.legacy_key,
      state: row.row_state,
      mappingState: row.mapping_state,
      targetType: row.target_type,
      targetId: row.target_id,
      exceptionCount: row.exception_count,
    })),
  };
}

export async function executeSetLegacyImportMapping(
  actorUserId: string,
  input: Readonly<{
    importJobId: string;
    rowId: string;
    mappingState: "matched" | "ambiguous" | "rejected";
    targetType: string | null;
    targetId: string | null;
    mappingMethod: string | null;
    reason: string;
    expectedRevision: number;
    operationId: string;
  }>,
  correlationId: string,
): Promise<
  Readonly<{ jobId: string; rowId: string; state: string; revision: number }>
> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("set_legacy_import_mapping", {
    p_actor_user_id: actorUserId,
    p_import_job_id: input.importJobId,
    p_row_id: input.rowId,
    p_mapping_state: input.mappingState,
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_mapping_method: input.mappingMethod,
    p_reason: input.reason,
    p_expected_revision: input.expectedRevision,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapError(error);
  const parsed = mappingRowsSchema.safeParse(data);
  if (!parsed.success)
    throw new MutationError("unexpected", { cause: parsed.error });
  const row = parsed.data[0];
  return {
    jobId: row.import_job_id,
    rowId: row.row_id,
    state: row.mapping_state,
    revision: row.revision,
  };
}
