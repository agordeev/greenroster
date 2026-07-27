import { describe, expect, it, vi } from "vitest";

import {
  executeCorrectInvitationAddress,
  executeListManageableInvitations,
  executeRegenerateInvitation,
  executeRevokeInvitation,
} from "../apps/web/src/lib/invitations/invitation-lifecycle-data";
import { runCorrectInvitationMutation } from "../apps/web/src/lib/invitations/invitation-lifecycle";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const actor = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-07-26T00:00:00.000Z",
};
const invitationId = "70000000-0000-4000-8000-000000000001";
const operationId = "30000000-0000-4000-8000-000000000001";
const correlationId = "20000000-0000-4000-8000-000000000001";
const listRow = {
  invitation_id: invitationId,
  membership_id: "60000000-0000-4000-8000-000000000001",
  member_first_name: "Pending",
  member_last_name: "Golfer",
  invited_email: "Original@Example.test",
  status: "pending",
  expires_at: "2026-07-28T00:00:00.000Z",
  invitation_version: 1,
  delivery_state: "queued",
  delivery_failure_reason: null,
  delivery_action_required: false,
};

const config = {
  appUrl: "https://greenroster.example",
  tokenSecret: "correct horse battery staple invitation secret",
  ttlHours: 48,
  ttlMilliseconds: 48 * 60 * 60 * 1000,
};

function listResponse() {
  return { data: [listRow], error: null };
}

describe("invitation lifecycle mutation boundary", () => {
  it("authenticates before parsing and requires literal confirmation", async () => {
    const executeCorrect = vi.fn();
    const response = await runCorrectInvitationMutation(
      {
        invitationId,
        invitedEmail: "New@Example.test",
        confirmed: false,
        reason: "Correct typo",
        operationId,
      },
      correlationId,
      {
        verifySession: vi
          .fn()
          .mockRejectedValue(new MutationError("authentication_required")),
        executeCorrect,
      },
    );

    expect(response.ok ? null : response.error.code).toBe(
      "authentication_required",
    );
    expect(executeCorrect).not.toHaveBeenCalled();

    const validation = await runCorrectInvitationMutation(
      {
        invitationId,
        invitedEmail: "New@Example.test",
        confirmed: false,
        reason: "Correct typo",
        operationId,
      },
      correlationId,
      {
        verifySession: vi.fn().mockResolvedValue(actor),
        executeCorrect,
      },
    );
    expect(validation.ok ? null : validation.error.code).toBe("validation");
    expect(executeCorrect).not.toHaveBeenCalled();

    const normalizedExecute = vi.fn().mockResolvedValue({});
    await runCorrectInvitationMutation(
      {
        invitationId,
        invitedEmail: " New@Example.TEST ",
        confirmed: true,
        reason: "Correct typo",
        operationId,
      },
      correlationId,
      {
        verifySession: vi.fn().mockResolvedValue(actor),
        executeCorrect: normalizedExecute,
      },
    );
    expect(normalizedExecute).toHaveBeenCalledWith(
      actor.userId,
      expect.objectContaining({ invitedEmail: "new@example.test" }),
      correlationId,
    );
  });

  it("normalizes correction e-mail and derives the fresh URL from the returned id", async () => {
    const rpc = vi
      .fn()
      .mockImplementation((name: string, args: Record<string, unknown>) => {
        if (name === "list_manageable_membership_invitations") {
          return Promise.resolve(listResponse());
        }
        return Promise.resolve({
          data: [
            {
              previous_invitation_id: invitationId,
              fresh_invitation_id: args.p_new_invitation_id,
              membership_id: listRow.membership_id,
              group_id: "50000000-0000-4000-8000-000000000001",
              fresh_outbox_job_id: "80000000-0000-4000-8000-000000000001",
              fresh_delivery_id: "90000000-0000-4000-8000-000000000001",
              invited_email: "new@example.test",
              invited_email_normalized: "new@example.test",
              role: "member",
              status: "pending",
              invitation_expires_at: "2026-07-28T00:00:00.000Z",
              invitation_version: 1,
            },
          ],
          error: null,
        });
      });

    const response = await executeCorrectInvitationAddress(
      actor.userId,
      {
        invitationId,
        invitedEmail: " New@Example.TEST ".trim().toLowerCase(),
        confirmed: true,
        reason: "Correct typo",
        operationId,
      },
      correlationId,
      {
        createClient: () => ({ rpc }),
        getRuntimeConfig: () => config,
        now: () => new Date("2026-07-26T00:00:00.000Z"),
      },
    );

    expect(response.invitationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(response.invitationUrl).toContain(
      `invitationId=${response.invitationId}`,
    );
    const correctionCall = rpc.mock.calls.find(
      ([name]) => name === "correct_membership_invitation_address",
    );
    expect(correctionCall?.[1]).toMatchObject({
      p_actor_user_id: actor.userId,
      p_invitation_id: invitationId,
      p_invited_email: "new@example.test",
      p_token_key_version: 1,
      p_reason: "Correct typo",
      p_correlation_id: correlationId,
      p_operation_id: operationId,
    });
    expect(String(correctionCall?.[1].p_token_digest)).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(String(correctionCall?.[1].p_token_digest)).not.toContain(
      new URL(response.invitationUrl).searchParams.get("token") ?? "",
    );
  });

  it("regeneration uses the server-owned current invited address", async () => {
    const rpc = vi
      .fn()
      .mockImplementation((name: string, args: Record<string, unknown>) =>
        name === "list_manageable_membership_invitations"
          ? Promise.resolve(listResponse())
          : Promise.resolve({
              data: [
                {
                  previous_invitation_id: invitationId,
                  fresh_invitation_id: args.p_new_invitation_id,
                  membership_id: listRow.membership_id,
                  group_id: "50000000-0000-4000-8000-000000000001",
                  fresh_outbox_job_id: "80000000-0000-4000-8000-000000000002",
                  fresh_delivery_id: "90000000-0000-4000-8000-000000000002",
                  invited_email: listRow.invited_email,
                  invited_email_normalized: "original@example.test",
                  role: "member",
                  status: "pending",
                  invitation_expires_at: "2026-07-28T00:00:00.000Z",
                  invitation_version: 1,
                },
              ],
              error: null,
            }),
      );

    await executeRegenerateInvitation(
      actor.userId,
      {
        invitationId,
        confirmed: true,
        reason: "Resend requested",
        operationId,
      },
      correlationId,
      {
        createClient: () => ({ rpc }),
        getRuntimeConfig: () => config,
        now: () => new Date("2026-07-26T00:00:00.000Z"),
      },
    );

    const regenerationCall = rpc.mock.calls.find(
      ([name]) => name === "regenerate_membership_invitation",
    );
    expect(regenerationCall?.[1]).toMatchObject({
      p_actor_user_id: actor.userId,
      p_invitation_id: invitationId,
      p_token_key_version: 1,
      p_reason: "Resend requested",
      p_correlation_id: correlationId,
      p_operation_id: operationId,
    });
    expect(regenerationCall?.[1]).not.toHaveProperty("p_invited_email");
  });

  it("returns only the service-authorized invitation projection", async () => {
    const rpc = vi.fn().mockResolvedValue(listResponse());
    const rows = await executeListManageableInvitations(actor.userId, {
      createClient: () => ({ rpc }),
    });

    expect(rows).toEqual([
      {
        invitationId,
        membershipId: listRow.membership_id,
        memberFirstName: "Pending",
        memberLastName: "Golfer",
        invitedEmail: "Original@Example.test",
        status: "pending",
        expiresAt: listRow.expires_at,
        version: 1,
        deliveryState: "queued",
        deliveryFailureReason: null,
        deliveryActionRequired: false,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("list_manageable_membership_invitations", {
      p_actor_user_id: actor.userId,
    });
  });

  it("re-authorizes the target before revoking it", async () => {
    const rpc = vi.fn().mockImplementation((name: string) =>
      name === "list_manageable_membership_invitations"
        ? Promise.resolve(listResponse())
        : Promise.resolve({
            data: [
              {
                revoked_invitation_id: invitationId,
                membership_id: listRow.membership_id,
                group_id: "50000000-0000-4000-8000-000000000001",
                status: "revoked",
                invitation_version: 2,
                revoked_at: "2026-07-26T00:00:01.000Z",
              },
            ],
            error: null,
          }),
    );

    const response = await executeRevokeInvitation(
      actor.userId,
      {
        invitationId,
        confirmed: true,
        reason: "No longer participating",
        operationId,
      },
      correlationId,
      { createClient: () => ({ rpc }) },
    );

    expect(response.status).toBe("revoked");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "revoke_membership_invitation",
    ]);
    expect(rpc.mock.calls[0]?.[1]).toEqual({
      p_actor_user_id: actor.userId,
      p_invitation_id: invitationId,
      p_reason: "No longer participating",
      p_correlation_id: correlationId,
      p_operation_id: operationId,
    });
  });
});
