import "server-only";

import { z } from "zod";

import {
  createInvitationId,
  createInvitationToken,
} from "../invitations/invitation-token";

type RpcResult = PromiseLike<Readonly<{ data: unknown; error: unknown }>>;
type RpcClient = Readonly<{
  rpc: (name: string, args: Readonly<Record<string, unknown>>) => RpcResult;
}>;

const claimRowsSchema = z
  .array(
    z.object({
      claimed_job_id: z.uuid(),
      claimed_state: z.enum(["validating", "applying"]),
      group_id: z.uuid(),
      revision: z.number().int().positive(),
      lease_expires_at: z.iso.datetime({ offset: true }),
    }),
  )
  .max(1);

const finalizationRowsSchema = z
  .array(
    z
      .object({
        finalized_job_id: z.uuid(),
        state: z.enum(["uploaded", "ready", "rejected"]),
      })
      .passthrough(),
  )
  .length(1);

const materialRowsSchema = z
  .array(
    z.object({
      import_job_id: z.uuid(),
      row_number: z.number().int().positive().nullable(),
      invited_email: z.string().email().nullable(),
      invited_email_normalized: z.string().email().nullable(),
      apply_confirmed_by: z.uuid(),
      apply_operation_id: z.uuid(),
      revision: z.number().int().positive(),
    }),
  )
  .min(1);

const applyRowsSchema = z
  .array(
    z
      .object({
        import_job_id: z.uuid(),
        state: z.enum(["uploaded", "completed"]),
        applied_rows: z.number().int().nonnegative(),
        skipped_rows: z.number().int().nonnegative(),
      })
      .passthrough(),
  )
  .length(1);

export type MemberImportWorkerResult =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "requeued"; jobId: string }>
  | Readonly<{ kind: "ready" | "rejected"; jobId: string }>
  | Readonly<{
      kind: "completed";
      jobId: string;
      appliedRows: number;
      skippedRows: number;
    }>
  | Readonly<{ kind: "unavailable"; jobId?: string }>;

type WorkerConfig = Readonly<{ tokenSecret: string; ttlMilliseconds: number }>;

type Dependencies = Readonly<{
  createClient: () => RpcClient | Promise<RpcClient>;
  createId: () => string;
  getConfig: () => WorkerConfig | Promise<WorkerConfig>;
  now: () => Date;
}>;

const defaults: Dependencies = {
  createClient: async () => {
    const { createSupabaseServiceClient } =
      await import("../supabase/service-client");
    return createSupabaseServiceClient();
  },
  createId: createInvitationId,
  getConfig: async () => {
    const { getInvitationRuntimeConfig } =
      await import("../invitations/invitation-runtime-config");
    return getInvitationRuntimeConfig();
  },
  now: () => new Date(),
};

function failed(result: Readonly<{ error: unknown }>): boolean {
  return result.error !== null && result.error !== undefined;
}

export async function runMemberImportWorker(
  overrides?: Partial<Dependencies>,
): Promise<MemberImportWorkerResult> {
  const dependencies = { ...defaults, ...overrides };
  const client = await dependencies.createClient();
  const workerId = dependencies.createId();
  const claim = await client.rpc("claim_next_member_csv_import", {
    p_worker_id: workerId,
    p_lease_seconds: 1800,
  });
  if (failed(claim)) return { kind: "unavailable" };
  const parsedClaim = claimRowsSchema.safeParse(claim.data);
  if (!parsedClaim.success) return { kind: "unavailable" };
  const claimed = parsedClaim.data[0];
  if (!claimed) return { kind: "empty" };
  const unavailable = (): MemberImportWorkerResult => ({
    kind: "unavailable",
    jobId: claimed.claimed_job_id,
  });

  if (claimed.claimed_state === "validating") {
    const validation = await client.rpc("validate_member_csv_import", {
      p_import_job_id: claimed.claimed_job_id,
      p_worker_id: workerId,
    });
    if (failed(validation)) {
      return unavailable();
    }
    const finalized = await client.rpc(
      "finalize_member_csv_import_validation",
      {
        p_import_job_id: claimed.claimed_job_id,
        p_worker_id: workerId,
        p_correlation_id: dependencies.createId(),
      },
    );
    if (failed(finalized)) {
      return unavailable();
    }
    const parsedFinalized = finalizationRowsSchema.safeParse(finalized.data);
    const row = parsedFinalized.success ? parsedFinalized.data[0] : undefined;
    return row
      ? {
          kind: row.state === "uploaded" ? "requeued" : row.state,
          jobId: row.finalized_job_id,
        }
      : unavailable();
  }

  const material = await client.rpc("get_member_csv_import_apply_material", {
    p_import_job_id: claimed.claimed_job_id,
    p_worker_id: workerId,
  });
  if (failed(material)) {
    return unavailable();
  }
  const parsedMaterial = materialRowsSchema.safeParse(material.data);
  if (!parsedMaterial.success) {
    return unavailable();
  }
  const context = parsedMaterial.data[0];
  const config = await dependencies.getConfig();
  const expiresAt = new Date(
    dependencies.now().getTime() + config.ttlMilliseconds,
  ).toISOString();
  const invitationPayloads = parsedMaterial.data.flatMap((row) => {
    if (
      row.row_number === null ||
      row.invited_email === null ||
      row.invited_email_normalized === null
    ) {
      return [];
    }
    const invitationId = dependencies.createId();
    const token = createInvitationToken({
      invitationId,
      secret: config.tokenSecret,
    });
    return [
      {
        row_number: row.row_number,
        invitation_id: invitationId,
        invited_email: row.invited_email,
        token_digest: token.tokenDigest,
        token_key_version: token.keyVersion,
        expires_at: expiresAt,
      },
    ];
  });
  const applied = await client.rpc("apply_member_csv_import", {
    p_actor_user_id: context.apply_confirmed_by,
    p_import_job_id: claimed.claimed_job_id,
    p_worker_id: workerId,
    p_invitation_payloads: invitationPayloads,
    p_correlation_id: dependencies.createId(),
    p_operation_id: context.apply_operation_id,
  });
  if (failed(applied)) {
    return unavailable();
  }
  const parsedApplied = applyRowsSchema.safeParse(applied.data);
  const row = parsedApplied.success ? parsedApplied.data[0] : undefined;
  return row
    ? row.state === "uploaded"
      ? { kind: "requeued", jobId: row.import_job_id }
      : {
          kind: "completed",
          jobId: row.import_job_id,
          appliedRows: row.applied_rows,
          skippedRows: row.skipped_rows,
        }
    : unavailable();
}
