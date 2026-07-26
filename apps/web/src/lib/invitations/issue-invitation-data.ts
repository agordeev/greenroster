import "server-only";

import { z } from "zod";

import {
  buildInvitationAcceptanceUrl,
  createInvitationId,
  createInvitationToken,
} from "./invitation-token";
import { getInvitationRuntimeConfig } from "./invitation-runtime-config";
import type {
  IssueInvitationInput,
  IssueInvitationResult,
} from "./issue-invitation";
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

export type IssueInvitationDataDependencies = Readonly<{
  createClient: () => RpcClient | Promise<RpcClient>;
  getRuntimeConfig: typeof getInvitationRuntimeConfig;
  now: () => Date;
  createInvitationId: typeof createInvitationId;
}>;

const defaultDependencies: IssueInvitationDataDependencies = {
  // Keep Supabase and its environment validation out of module evaluation so
  // imports remain build-safe; configuration is resolved when issuing.
  createClient: async () => {
    const { createSupabaseServiceClient } =
      await import("../supabase/service-client");
    return createSupabaseServiceClient();
  },
  getRuntimeConfig: getInvitationRuntimeConfig,
  now: () => new Date(),
  createInvitationId,
};

const invitationRowsSchema = z
  .array(
    z
      .object({
        issued_invitation_id: z.uuid(),
        membership_id: z.uuid(),
        issued_group_id: z.uuid(),
        queued_outbox_id: z.uuid(),
        queued_delivery_id: z.uuid(),
        invited_email: z.email(),
        invited_email_normalized: z.email(),
        role: z.enum(["member", "coordinator", "administrator"]),
        status: z.enum(["pending", "accepted", "revoked", "expired"]),
        invitation_expires_at: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .length(1);

function mapIssueInvitationError(error: SupabaseRpcError): MutationError {
  if (error.code === "P0003") {
    return new MutationError("forbidden", { cause: error });
  }
  if (error.code === "P0002") {
    return new MutationError("unavailable", { cause: error });
  }
  if (error.code === "40001") {
    return new MutationError("stale_version", { cause: error });
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

export async function executeIssueInvitation(
  actorUserId: string,
  input: IssueInvitationInput,
  correlationId: string,
  overrides?: Partial<IssueInvitationDataDependencies>,
): Promise<IssueInvitationResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const config = dependencies.getRuntimeConfig();
  const invitationId = dependencies.createInvitationId();
  const token = createInvitationToken({
    invitationId,
    secret: config.tokenSecret,
  });
  const now = dependencies.now();

  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new MutationError("unexpected", {
      cause: new Error("Invitation clock returned an invalid time"),
    });
  }

  const expiresAt = new Date(now.getTime() + config.ttlMilliseconds);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new MutationError("unexpected", {
      cause: new Error("Invitation expiry exceeded the supported date range"),
    });
  }

  const client = await dependencies.createClient();
  const { data, error } = await client.rpc("issue_membership_invitation", {
    p_actor_user_id: actorUserId,
    p_membership_id: input.membershipId,
    p_invitation_id: invitationId,
    p_invited_email: input.invitedEmail,
    p_token_digest: token.tokenDigest,
    p_token_key_version: token.keyVersion,
    p_expires_at: expiresAt.toISOString(),
    p_correlation_id: correlationId,
    p_operation_id: input.operationId,
  });

  if (error) {
    throw mapIssueInvitationError(error);
  }

  const rows = invitationRowsSchema.safeParse(data);
  if (!rows.success) {
    throw new MutationError("unexpected", { cause: rows.error });
  }

  const row = rows.data[0];
  if (!row) {
    throw new MutationError("unexpected", {
      cause: new Error("Invitation issue returned no result"),
    });
  }

  if (
    row.membership_id !== input.membershipId ||
    row.invited_email_normalized !== input.invitedEmail ||
    row.role !== "member" ||
    row.status !== "pending"
  ) {
    throw new MutationError("unexpected", {
      cause: new Error("Invitation issue returned an inconsistent result"),
    });
  }

  return {
    invitationId: row.issued_invitation_id,
    groupId: row.issued_group_id,
    outboxId: row.queued_outbox_id,
    deliveryId: row.queued_delivery_id,
    expiresAt: row.invitation_expires_at,
    invitationUrl: buildInvitationAcceptanceUrl({
      appUrl: config.appUrl,
      invitationId: row.issued_invitation_id,
      // A retry can return the original id for an idempotent operation. The
      // URL must be derived from that authoritative id, never this attempt's
      // candidate id.
      rawToken: createInvitationToken({
        invitationId: row.issued_invitation_id,
        secret: config.tokenSecret,
        keyVersion: token.keyVersion,
      }).rawToken,
    }),
  };
}
