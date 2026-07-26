import { describe, expect, it, vi } from "vitest";

import { createHash, createHmac } from "node:crypto";

import { executeIssueInvitation } from "../apps/web/src/lib/invitations/issue-invitation-data";
import {
  runIssueInvitationMutation,
  type IssueInvitationResult,
} from "../apps/web/src/lib/invitations/issue-invitation";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-07-26T00:00:00.000Z",
};

const input = {
  membershipId: "60000000-0000-4000-8000-000000000001",
  invitedEmail: "  Invitee@Example.COM ",
  operationId: "30000000-0000-4000-8000-000000000001",
};

const result: IssueInvitationResult = {
  invitationId: "70000000-0000-4000-8000-000000000001",
  groupId: "50000000-0000-4000-8000-000000000001",
  outboxId: "80000000-0000-4000-8000-000000000001",
  deliveryId: "90000000-0000-4000-8000-000000000001",
  expiresAt: "2026-07-28T00:00:00.000Z",
  invitationUrl:
    "https://greenroster.example/invitations/accept?invitationId=70000000-0000-4000-8000-000000000001&token=raw",
};

describe("issue invitation mutation boundary", () => {
  it("authenticates first, normalizes the e-mail, and preserves correlation", async () => {
    const executeIssue = vi.fn().mockResolvedValue(result);
    const response = await runIssueInvitationMutation(
      input,
      "20000000-0000-4000-8000-000000000001",
      {
        verifySession: vi.fn().mockResolvedValue(session),
        executeIssue,
      },
    );

    expect(response).toEqual({
      ok: true,
      data: result,
      correlationId: "20000000-0000-4000-8000-000000000001",
    });
    expect(executeIssue).toHaveBeenCalledWith(
      session.userId,
      {
        membershipId: input.membershipId,
        invitedEmail: "invitee@example.com",
        operationId: input.operationId,
      },
      "20000000-0000-4000-8000-000000000001",
    );
  });

  it("authenticates before parsing attacker-controlled input", async () => {
    const executeIssue = vi.fn();
    const response = await runIssueInvitationMutation(null, null, {
      verifySession: vi
        .fn()
        .mockRejectedValue(new MutationError("authentication_required")),
      executeIssue,
    });

    expect(response.ok ? null : response.error.code).toBe(
      "authentication_required",
    );
    expect(executeIssue).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, groupId: "50000000-0000-4000-8000-000000000001" },
    { ...input, role: "member" },
    { ...input, status: "pending" },
    { ...input, expiresAt: "2026-07-28T00:00:00.000Z" },
    { ...input, token: "attacker-token" },
  ])("rejects client-supplied authority or token fields", async (invalid) => {
    const executeIssue = vi.fn();
    const response = await runIssueInvitationMutation(invalid, null, {
      verifySession: vi.fn().mockResolvedValue(session),
      executeIssue,
    });

    expect(response.ok ? null : response.error.code).toBe("validation");
    expect(executeIssue).not.toHaveBeenCalled();
  });

  it("issues using only the digest in RPC arguments", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          issued_invitation_id: result.invitationId,
          membership_id: input.membershipId,
          issued_group_id: result.groupId,
          queued_outbox_id: result.outboxId,
          queued_delivery_id: result.deliveryId,
          invited_email: "invitee@example.com",
          invited_email_normalized: "invitee@example.com",
          role: "member",
          status: "pending",
          invitation_expires_at: result.expiresAt,
        },
      ],
      error: null,
    });
    const response = await executeIssueInvitation(
      session.userId,
      {
        membershipId: input.membershipId,
        invitedEmail: "invitee@example.com",
        operationId: input.operationId,
      },
      "20000000-0000-4000-8000-000000000001",
      {
        createClient: () => ({ rpc }),
        getRuntimeConfig: () => ({
          appUrl: "https://greenroster.example",
          tokenSecret: "correct horse battery staple invitation secret",
          ttlHours: 48,
          ttlMilliseconds: 48 * 60 * 60 * 1000,
        }),
        now: () => new Date("2026-07-26T00:00:00.000Z"),
        createInvitationId: () => result.invitationId,
      },
    );

    expect(response).toEqual({
      ...result,
      invitationUrl: expect.stringContaining("token="),
    });
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args).toMatchObject({
      p_actor_user_id: session.userId,
      p_membership_id: input.membershipId,
      p_invitation_id: result.invitationId,
      p_invited_email: "invitee@example.com",
      p_token_key_version: 1,
      p_expires_at: "2026-07-28T00:00:00.000Z",
      p_correlation_id: "20000000-0000-4000-8000-000000000001",
      p_operation_id: input.operationId,
    });
    expect(args.p_token_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain(
      new URL(response.invitationUrl).searchParams.get("token") ?? "",
    );
  });

  it("re-derives a retry URL from the authoritative returned invitation id", async () => {
    const returnedId = "70000000-0000-4000-8000-000000000099";
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          issued_invitation_id: returnedId,
          membership_id: input.membershipId,
          issued_group_id: result.groupId,
          queued_outbox_id: result.outboxId,
          queued_delivery_id: result.deliveryId,
          invited_email: "invitee@example.com",
          invited_email_normalized: "invitee@example.com",
          role: "member",
          status: "pending",
          invitation_expires_at: result.expiresAt,
        },
      ],
      error: null,
    });
    const secret = "correct horse battery staple invitation secret";
    const response = await executeIssueInvitation(
      session.userId,
      {
        membershipId: input.membershipId,
        invitedEmail: "invitee@example.com",
        operationId: input.operationId,
      },
      "20000000-0000-4000-8000-000000000001",
      {
        createClient: () => ({ rpc }),
        getRuntimeConfig: () => ({
          appUrl: "https://greenroster.example",
          tokenSecret: secret,
          ttlHours: 48,
          ttlMilliseconds: 48 * 60 * 60 * 1000,
        }),
        now: () => new Date("2026-07-26T00:00:00.000Z"),
        createInvitationId: () => result.invitationId,
      },
    );
    const rawToken = new URL(response.invitationUrl).searchParams.get("token");
    const expectedRawToken = createHmac("sha256", secret)
      .update(`${returnedId}:1`, "utf8")
      .digest("base64url");

    expect(rawToken).toBe(expectedRawToken);
    expect(
      createHash("sha256")
        .update(rawToken ?? "", "utf8")
        .digest("hex"),
    ).toBe(createHash("sha256").update(expectedRawToken, "utf8").digest("hex"));
  });

  it.each([
    ["P0003", "forbidden"],
    ["P0002", "unavailable"],
    ["40001", "stale_version"],
    ["P0001", "locked"],
    ["23505", "validation"],
    [undefined, "transient"],
  ] as const)("maps RPC error %s to %s", async (code, expected) => {
    await expect(
      executeIssueInvitation(
        session.userId,
        {
          membershipId: input.membershipId,
          invitedEmail: "invitee@example.com",
          operationId: input.operationId,
        },
        "20000000-0000-4000-8000-000000000001",
        {
          createClient: () => ({
            rpc: vi.fn().mockResolvedValue({
              data: null,
              error: code === undefined ? {} : { code },
            }),
          }),
          getRuntimeConfig: () => ({
            appUrl: "https://greenroster.example",
            tokenSecret: "correct horse battery staple invitation secret",
            ttlHours: 48,
            ttlMilliseconds: 48 * 60 * 60 * 1000,
          }),
          now: () => new Date("2026-07-26T00:00:00.000Z"),
          createInvitationId: () => result.invitationId,
        },
      ),
    ).rejects.toMatchObject({ code: expected });
  });
});
