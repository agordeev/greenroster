import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import {
  buildInvitationAcceptanceUrl,
  createInvitationToken,
  invitationExpiresAt,
  uuidFromSha256Hex,
} from "./invitation-token";
import {
  getInvitationRuntimeConfig,
  type InvitationRuntimeConfig,
} from "./invitation-runtime-config";
import type {
  CorrectInvitationInput,
  InvitationLifecycleResult,
  ManageableInvitation,
  RegenerateInvitationInput,
  RevokeInvitationInput,
  RevokeInvitationResult,
} from "./invitation-lifecycle";
import { MutationError } from "../mutations/result";

type SupabaseRpcError = Readonly<{
  code?: string;
  message?: string;
}>;

type RpcClient = Readonly<{
  rpc: (
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ) => PromiseLike<Readonly<{ data: unknown; error: SupabaseRpcError | null }>>;
}>;

export type InvitationLifecycleDataDependencies = Readonly<{
  createClient: () => RpcClient | Promise<RpcClient>;
  getRuntimeConfig: typeof getInvitationRuntimeConfig;
  now: () => Date;
}>;

const defaultDependencies: InvitationLifecycleDataDependencies = {
  createClient: async () => {
    const { createSupabaseServiceClient } =
      await import("../supabase/service-client");
    return createSupabaseServiceClient();
  },
  getRuntimeConfig: getInvitationRuntimeConfig,
  now: () => new Date(),
};

const manageableInvitationRowsSchema = z.array(
  z
    .object({
      invitation_id: z.uuid(),
      membership_id: z.uuid(),
      member_first_name: z.string(),
      member_last_name: z.string(),
      invited_email: z.email(),
      status: z.enum(["pending", "accepted", "revoked", "expired"]),
      expires_at: z.string().datetime({ offset: true }),
      invitation_version: z.number().int().positive(),
      delivery_state: z
        .enum([
          "queued",
          "sending",
          "sent",
          "retryable",
          "failed_permanent",
          "suppressed",
          "cancelled",
        ])
        .nullable(),
      delivery_failure_reason: z.string().nullable(),
      delivery_action_required: z.boolean(),
    })
    .strict(),
);

const correctionRowsSchema = z
  .array(
    z
      .object({
        previous_invitation_id: z.uuid(),
        fresh_invitation_id: z.uuid(),
        membership_id: z.uuid(),
        group_id: z.uuid(),
        fresh_outbox_job_id: z.uuid(),
        fresh_delivery_id: z.uuid(),
        invited_email: z.email(),
        invited_email_normalized: z.email(),
        role: z.literal("member"),
        status: z.literal("pending"),
        invitation_expires_at: z.string().datetime({ offset: true }),
        invitation_version: z.number().int().positive(),
      })
      .strict(),
  )
  .length(1);

const revokeRowsSchema = z
  .array(
    z
      .object({
        revoked_invitation_id: z.uuid(),
        membership_id: z.uuid(),
        group_id: z.uuid(),
        status: z.literal("revoked"),
        invitation_version: z.number().int().positive(),
        revoked_at: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .length(1);

function mapInvitationLifecycleError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003") {
    return new MutationError("forbidden", { cause: error });
  }
  if (error.code === "P0002") {
    return new MutationError("unavailable", { cause: error });
  }
  if (error.code === "P0001") {
    return new MutationError("locked", { cause: error });
  }
  if (
    error.code === "22003" ||
    error.code === "22004" ||
    error.code === "22023" ||
    error.code === "22P02" ||
    error.code === "23502" ||
    error.code === "23503" ||
    error.code === "23505" ||
    error.code === "23514"
  ) {
    return new MutationError("validation", { cause: error });
  }
  if (!error.code) {
    return new MutationError("transient", { cause: error });
  }
  return new MutationError("unexpected", { cause: error });
}

function deterministicInvitationId(operationId: string, previousId: string) {
  const digest = createHash("sha256")
    .update(`greenroster:invitation-lifecycle:${operationId}`, "utf8")
    .digest("hex");
  const candidate = uuidFromSha256Hex(digest);
  if (candidate !== previousId) return candidate;

  return deterministicInvitationId(`${operationId}:retry`, previousId);
}

function prepareFreshInvitation(
  input: Readonly<{ invitationId: string; operationId: string }>,
  config: InvitationRuntimeConfig,
  now: () => Date,
) {
  const freshInvitationId = deterministicInvitationId(
    input.operationId,
    input.invitationId,
  );
  const token = createInvitationToken({
    invitationId: freshInvitationId,
    secret: config.tokenSecret,
  });
  const expiresAt = invitationExpiresAt(now(), config.ttlMilliseconds);
  return { freshInvitationId, token, expiresAt };
}

function invitationLifecycleResultFromRows(
  data: unknown,
  input: Readonly<{ invitationId: string }>,
  freshInvitationId: string,
  config: InvitationRuntimeConfig,
  expectedNormalizedEmail?: string,
): InvitationLifecycleResult {
  const rows = correctionRowsSchema.safeParse(data);
  if (!rows.success) {
    throw new MutationError("unexpected", { cause: rows.error });
  }
  const row = rows.data[0];
  if (
    !row ||
    row.previous_invitation_id !== input.invitationId ||
    row.fresh_invitation_id !== freshInvitationId
  ) {
    throw new MutationError("unexpected", {
      cause: new Error("Invitation lifecycle returned an inconsistent result"),
    });
  }
  if (
    expectedNormalizedEmail !== undefined &&
    row.invited_email_normalized !== expectedNormalizedEmail
  ) {
    throw new MutationError("unexpected", {
      cause: new Error("Invitation correction returned a different address"),
    });
  }
  if (row.invited_email.trim().toLowerCase() !== row.invited_email_normalized) {
    throw new MutationError("unexpected", {
      cause: new Error("Invitation lifecycle returned inconsistent addresses"),
    });
  }

  const rawToken = createInvitationToken({
    invitationId: row.fresh_invitation_id,
    secret: config.tokenSecret,
  }).rawToken;
  return {
    previousInvitationId: row.previous_invitation_id,
    invitationId: row.fresh_invitation_id,
    membershipId: row.membership_id,
    groupId: row.group_id,
    outboxId: row.fresh_outbox_job_id,
    deliveryId: row.fresh_delivery_id,
    invitedEmail: row.invited_email,
    expiresAt: row.invitation_expires_at,
    invitationUrl: buildInvitationAcceptanceUrl({
      appUrl: config.appUrl,
      invitationId: row.fresh_invitation_id,
      rawToken,
    }),
  };
}

export async function executeListManageableInvitations(
  actorUserId: string,
  overrides?: Partial<InvitationLifecycleDataDependencies>,
): Promise<readonly ManageableInvitation[]> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const client = await dependencies.createClient();
  const { data, error } = await client.rpc(
    "list_manageable_membership_invitations",
    { p_actor_user_id: actorUserId },
  );
  if (error) throw mapInvitationLifecycleError(error);

  const parsed = manageableInvitationRowsSchema.safeParse(data);
  if (!parsed.success) {
    throw new MutationError("unexpected", { cause: parsed.error });
  }

  return parsed.data.map((row) => ({
    invitationId: row.invitation_id,
    membershipId: row.membership_id,
    memberFirstName: row.member_first_name,
    memberLastName: row.member_last_name,
    invitedEmail: row.invited_email,
    status: row.status,
    expiresAt: row.expires_at,
    version: row.invitation_version,
    deliveryState: row.delivery_state,
    deliveryFailureReason: row.delivery_failure_reason,
    deliveryActionRequired: row.delivery_action_required,
  }));
}

export async function executeCorrectInvitationAddress(
  actorUserId: string,
  input: CorrectInvitationInput,
  correlationId: string,
  overrides?: Partial<InvitationLifecycleDataDependencies>,
): Promise<InvitationLifecycleResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const config = dependencies.getRuntimeConfig();
  const client = await dependencies.createClient();

  const { freshInvitationId, token, expiresAt } = prepareFreshInvitation(
    input,
    config,
    () => dependencies.now(),
  );

  const { data, error } = await client.rpc(
    "correct_membership_invitation_address",
    {
      p_actor_user_id: actorUserId,
      p_invitation_id: input.invitationId,
      p_new_invitation_id: freshInvitationId,
      p_invited_email: input.invitedEmail,
      p_token_digest: token.tokenDigest,
      p_token_key_version: token.keyVersion,
      p_expires_at: expiresAt.toISOString(),
      p_reason: input.reason,
      p_correlation_id: correlationId,
      p_operation_id: input.operationId,
    },
  );
  if (error) throw mapInvitationLifecycleError(error);

  return invitationLifecycleResultFromRows(
    data,
    input,
    freshInvitationId,
    config,
    input.invitedEmail,
  );
}

export async function executeRegenerateInvitation(
  actorUserId: string,
  input: RegenerateInvitationInput,
  correlationId: string,
  overrides?: Partial<InvitationLifecycleDataDependencies>,
): Promise<InvitationLifecycleResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const config = dependencies.getRuntimeConfig();
  const client = await dependencies.createClient();
  const { freshInvitationId, token, expiresAt } = prepareFreshInvitation(
    input,
    config,
    () => dependencies.now(),
  );
  const { data, error } = await client.rpc("regenerate_membership_invitation", {
    p_actor_user_id: actorUserId,
    p_invitation_id: input.invitationId,
    p_new_invitation_id: freshInvitationId,
    p_token_digest: token.tokenDigest,
    p_token_key_version: token.keyVersion,
    p_expires_at: expiresAt.toISOString(),
    p_reason: input.reason,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapInvitationLifecycleError(error);

  return invitationLifecycleResultFromRows(
    data,
    input,
    freshInvitationId,
    config,
  );
}

export async function executeRevokeInvitation(
  actorUserId: string,
  input: RevokeInvitationInput,
  correlationId: string,
  overrides?: Partial<InvitationLifecycleDataDependencies>,
): Promise<RevokeInvitationResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const client = await dependencies.createClient();

  const { data, error } = await client.rpc("revoke_membership_invitation", {
    p_actor_user_id: actorUserId,
    p_invitation_id: input.invitationId,
    p_reason: input.reason,
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });
  if (error) throw mapInvitationLifecycleError(error);

  const rows = revokeRowsSchema.safeParse(data);
  if (!rows.success)
    throw new MutationError("unexpected", { cause: rows.error });
  const row = rows.data[0];
  if (!row || row.revoked_invitation_id !== input.invitationId) {
    throw new MutationError("unexpected", {
      cause: new Error("Invitation revoke returned an inconsistent result"),
    });
  }
  return {
    invitationId: row.revoked_invitation_id,
    membershipId: row.membership_id,
    groupId: row.group_id,
    status: row.status,
    version: row.invitation_version,
    revokedAt: row.revoked_at,
  };
}
