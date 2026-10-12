import "server-only";

import { z } from "zod";

export type InvitationAcceptanceRpcError = Readonly<{
  code?: string;
  message?: string;
}>;

export type InvitationAcceptanceRpcClient = Readonly<{
  rpc: (
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ) => PromiseLike<
    Readonly<{ data: unknown; error: InvitationAcceptanceRpcError | null }>
  >;
}>;

export type InvitationPreview = Readonly<{
  invitationId: string;
  membershipId: string;
  groupId: string;
  groupName: string;
  inviterDisplayName: string;
  memberFirstName: string;
  invitedEmail: string;
  accountEmail: string | null;
  emailMatches: boolean | null;
  role: "member" | "coordinator" | "administrator";
  expiresAt: string;
  status: "pending" | "accepted" | "revoked" | "expired";
}>;

export type InvitationAcceptance = Readonly<{
  invitationId: string;
  membershipId: string;
  groupId: string;
  role: "member" | "coordinator" | "administrator";
  status: "active";
  acceptedAt: string;
  emailMatches: boolean;
}>;

export type InvitationAcceptanceDataErrorCode =
  | "not_found"
  | "already_used"
  | "expired"
  | "revoked"
  | "address_mismatch"
  | "identity_already_attached"
  | "unavailable"
  | "invalid";

export class InvitationAcceptanceDataError extends Error {
  readonly code: InvitationAcceptanceDataErrorCode;

  constructor(code: InvitationAcceptanceDataErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = "InvitationAcceptanceDataError";
    this.code = code;
  }
}

export type InvitationAcceptanceDataDependencies = Readonly<{
  createClient: () =>
    InvitationAcceptanceRpcClient | Promise<InvitationAcceptanceRpcClient>;
}>;

const defaultDependencies: InvitationAcceptanceDataDependencies = {
  createClient: async () => {
    const { createSupabaseServiceClient } =
      await import("../supabase/service-client");
    return createSupabaseServiceClient();
  },
};

const previewRowSchema = z
  .object({
    invitation_id: z.uuid(),
    membership_id: z.uuid(),
    group_id: z.uuid(),
    group_name: z.string().trim().min(1),
    inviter_display_name: z.string().trim().min(1),
    member_first_name: z.string().trim().min(1),
    invited_email: z.email(),
    account_email: z.email().nullable(),
    email_matches: z.boolean().nullable(),
    role: z.enum(["member", "coordinator", "administrator"]),
    invitation_expires_at: z.string().datetime({ offset: true }),
    status: z.enum(["pending", "accepted", "revoked", "expired"]),
  })
  .strict();

const acceptanceRowSchema = z
  .object({
    accepted_invitation_id: z.uuid(),
    membership_id: z.uuid(),
    group_id: z.uuid(),
    group_name: z.string().trim().min(1),
    invited_email: z.email(),
    account_email: z.email(),
    email_matches: z.boolean(),
    role: z.enum(["member", "coordinator", "administrator"]),
    status: z.literal("accepted"),
    accepted_at: z.string().datetime({ offset: true }),
    membership_status: z.literal("active"),
  })
  .strict();

function oneRow(data: unknown): unknown {
  if (Array.isArray(data)) return data.length === 1 ? data[0] : null;
  return data;
}

async function callAcceptanceRpc(
  client: InvitationAcceptanceRpcClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>,
): Promise<
  Readonly<{ data: unknown; error: InvitationAcceptanceRpcError | null }>
> {
  try {
    return await client.rpc(functionName, args);
  } catch (error) {
    throw new InvitationAcceptanceDataError("unavailable", error);
  }
}

function mapRpcError(
  error: InvitationAcceptanceRpcError,
): InvitationAcceptanceDataError {
  if (error.message === "identity_already_attached") {
    return new InvitationAcceptanceDataError(
      "identity_already_attached",
      error,
    );
  }

  switch (error.code) {
    case "P0002":
    case "invitation_not_found":
    case "invitation_token_invalid":
      return new InvitationAcceptanceDataError("not_found", error);
    case "invitation_expired":
      return new InvitationAcceptanceDataError("expired", error);
    case "invitation_revoked":
      return new InvitationAcceptanceDataError("revoked", error);
    case "invitation_already_accepted":
      return new InvitationAcceptanceDataError("already_used", error);
    case "invitation_address_mismatch":
      return new InvitationAcceptanceDataError("address_mismatch", error);
    case "22023":
    case "23514":
      return new InvitationAcceptanceDataError("invalid", error);
    default:
      return new InvitationAcceptanceDataError("unavailable", error);
  }
}

export async function previewMembershipInvitation(
  authUserId: string,
  invitationId: string,
  tokenDigest: string,
  overrides?: Partial<InvitationAcceptanceDataDependencies>,
): Promise<InvitationPreview> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const client = await dependencies.createClient();
  const result = await callAcceptanceRpc(
    client,
    "preview_membership_invitation",
    {
      p_auth_user_id: authUserId,
      p_invitation_id: invitationId,
      p_token_digest: tokenDigest,
    },
  );
  if (result.error) throw mapRpcError(result.error);
  const parsed = previewRowSchema.safeParse(oneRow(result.data));
  if (!parsed.success) {
    if (
      result.data === null ||
      (Array.isArray(result.data) && result.data.length === 0)
    ) {
      throw new InvitationAcceptanceDataError("not_found");
    }
    throw new InvitationAcceptanceDataError("invalid", parsed.error);
  }
  return {
    invitationId: parsed.data.invitation_id,
    membershipId: parsed.data.membership_id,
    groupId: parsed.data.group_id,
    groupName: parsed.data.group_name,
    inviterDisplayName: parsed.data.inviter_display_name,
    memberFirstName: parsed.data.member_first_name,
    invitedEmail: parsed.data.invited_email,
    accountEmail: parsed.data.account_email,
    emailMatches: parsed.data.email_matches,
    role: parsed.data.role,
    expiresAt: parsed.data.invitation_expires_at,
    status: parsed.data.status,
  };
}

export async function acceptMembershipInvitation(
  input: Readonly<{
    invitationId: string;
    tokenDigest: string;
    userId: string;
    correlationId: string;
    operationId: string;
  }>,
  overrides?: Partial<InvitationAcceptanceDataDependencies>,
): Promise<InvitationAcceptance> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const client = await dependencies.createClient();
  const result = await callAcceptanceRpc(
    client,
    "accept_membership_invitation",
    {
      p_invitation_id: input.invitationId,
      p_token_digest: input.tokenDigest,
      p_auth_user_id: input.userId,
      p_correlation_id: input.correlationId,
      p_operation_id: input.operationId,
    },
  );
  if (result.error) throw mapRpcError(result.error);
  const parsed = acceptanceRowSchema.safeParse(oneRow(result.data));
  if (!parsed.success) {
    throw new InvitationAcceptanceDataError("invalid", parsed.error);
  }
  return {
    invitationId: parsed.data.accepted_invitation_id,
    membershipId: parsed.data.membership_id,
    groupId: parsed.data.group_id,
    role: parsed.data.role,
    status: parsed.data.membership_status,
    acceptedAt: parsed.data.accepted_at,
    emailMatches: parsed.data.email_matches,
  };
}
