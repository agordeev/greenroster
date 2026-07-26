import { describe, expect, it, vi } from "vitest";

import {
  acceptMembershipInvitation,
  InvitationAcceptanceDataError,
  previewMembershipInvitation,
} from "../apps/web/src/lib/invitations/invitation-acceptance-data";

const userId = "10000000-0000-4000-8000-000000000001";
const invitationId = "70000000-0000-4000-8000-000000000001";
const membershipId = "60000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";
const digest = "a".repeat(64);

function rpcClient(
  data: unknown,
  error: { code?: string; message?: string } | null = null,
) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc }, rpc };
}

describe("invitation acceptance service adapter", () => {
  it("passes the verified actor to the safe preview RPC and maps its projection", async () => {
    const { client, rpc } = rpcClient([
      {
        invitation_id: invitationId,
        membership_id: membershipId,
        group_id: groupId,
        group_name: "The Green",
        inviter_display_name: "A. Coordinator",
        member_first_name: "Alex",
        invited_email: "alex@example.com",
        account_email: "different@example.com",
        email_matches: false,
        role: "member",
        status: "pending",
        invitation_expires_at: "2026-07-28T00:00:00+00:00",
      },
    ]);
    await expect(
      previewMembershipInvitation(userId, invitationId, digest, {
        createClient: () => client,
      }),
    ).resolves.toMatchObject({
      invitationId,
      groupName: "The Green",
      invitedEmail: "alex@example.com",
      emailMatches: false,
    });
    expect(rpc).toHaveBeenCalledWith("preview_membership_invitation", {
      p_auth_user_id: userId,
      p_invitation_id: invitationId,
      p_token_digest: digest,
    });
  });

  it("passes a stable operation id to the terminal acceptance RPC", async () => {
    const { client, rpc } = rpcClient([
      {
        accepted_invitation_id: invitationId,
        membership_id: membershipId,
        group_id: groupId,
        group_name: "The Green",
        invited_email: "alex@example.com",
        account_email: "different@example.com",
        email_matches: false,
        role: "member",
        status: "accepted",
        accepted_at: "2026-07-26T00:00:00+00:00",
        membership_status: "active",
      },
    ]);
    await expect(
      acceptMembershipInvitation(
        {
          invitationId,
          tokenDigest: digest,
          userId,
          correlationId: "20000000-0000-4000-8000-000000000001",
          operationId: "30000000-0000-4000-8000-000000000001",
        },
        { createClient: () => client },
      ),
    ).resolves.toMatchObject({ invitationId, membershipId, status: "active" });
    expect(rpc).toHaveBeenCalledWith("accept_membership_invitation", {
      p_auth_user_id: userId,
      p_invitation_id: invitationId,
      p_token_digest: digest,
      p_correlation_id: "20000000-0000-4000-8000-000000000001",
      p_operation_id: "30000000-0000-4000-8000-000000000001",
    });
  });

  it.each([
    ["P0002", "not_found"],
    ["invitation_expired", "expired"],
  ] as const)("maps %s to a safe %s state", async (code, expected) => {
    const { client } = rpcClient(null, { code });
    await expect(
      previewMembershipInvitation(userId, invitationId, digest, {
        createClient: () => client,
      }),
    ).rejects.toMatchObject<InvitationAcceptanceDataError>({ code: expected });
  });

  it("maps the lifetime membership constraint to its safe refusal state", async () => {
    const { client } = rpcClient(null, {
      code: "23505",
      message: "identity_already_attached",
    });
    await expect(
      previewMembershipInvitation(userId, invitationId, digest, {
        createClient: () => client,
      }),
    ).rejects.toMatchObject<InvitationAcceptanceDataError>({
      code: "identity_already_attached",
    });
  });
});
