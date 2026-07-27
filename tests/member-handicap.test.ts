import { describe, expect, it, vi } from "vitest";

import {
  memberHandicapFingerprint,
  runMemberHandicapMutation,
  shouldAllowMemberFormSubmit,
} from "../apps/web/src/lib/memberships/member-management";
import { executeSetMemberHandicap } from "../apps/web/src/lib/memberships/member-management-data";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const membershipId = "60000000-0000-4000-8000-000000000001";
const groupId = "50000000-0000-4000-8000-000000000001";
const operationId = "30000000-0000-4000-8000-000000000001";
const correlationId = "20000000-0000-4000-8000-000000000001";

const input = {
  membershipId,
  handicapId: "GHIN-123",
  handicap: "8.4",
  asOf: "2026-07-27",
  expectedMembershipVersion: 3,
  confirmed: true,
  reason: "Correct pre-score handicap",
  operationId,
} as const;

describe("manual member handicap boundary", () => {
  it("authenticates before parsing and rejects client authority fields", async () => {
    const execute = vi.fn();
    const result = await runMemberHandicapMutation(
      { ...input, groupId },
      correlationId,
      {
        execute,
        verifySession: vi.fn().mockResolvedValue({
          userId: actorUserId,
          emailConfirmedAt: "2026-07-27T00:00:00.000Z",
        }),
      },
    );

    expect(result.ok ? null : result.error.code).toBe("validation");
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires a valid dated value, explicit confirmation, and reason", async () => {
    const execute = vi.fn();
    const result = await runMemberHandicapMutation(
      {
        ...input,
        handicap: "8.45",
        asOf: "not-a-date",
        confirmed: false,
        reason: " ",
      },
      correlationId,
      {
        execute,
        verifySession: vi.fn().mockResolvedValue({
          userId: actorUserId,
          emailConfirmedAt: "2026-07-27T00:00:00.000Z",
        }),
      },
    );

    expect(result.ok ? null : result.error.code).toBe("validation");
    expect(execute).not.toHaveBeenCalled();
  });

  it("normalizes input and passes server-derived actor identity", async () => {
    const execute = vi.fn().mockResolvedValue({
      recordId: "70000000-0000-4000-8000-000000000001",
      membershipId,
      groupId,
      membershipVersion: 4,
      handicapId: "GHIN-123",
      handicap: "8.4",
      source: "manual",
      asOf: "2026-07-27",
      createdAt: "2026-07-27T10:00:00.000Z",
    });
    const result = await runMemberHandicapMutation(
      { ...input, handicapId: " GHIN-123 ", reason: " Correct value " },
      correlationId,
      {
        execute,
        verifySession: vi.fn().mockResolvedValue({
          userId: actorUserId,
          emailConfirmedAt: "2026-07-27T00:00:00.000Z",
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      actorUserId,
      expect.objectContaining({
        handicapId: "GHIN-123",
        handicap: "8.4",
        reason: "Correct value",
      }),
      correlationId,
    );
  });

  it("calls the append-only RPC with optimistic and idempotency fields", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          handicap_record_id: "70000000-0000-4000-8000-000000000001",
          changed_membership_id: membershipId,
          changed_group_id: groupId,
          membership_version: 4,
          handicap_id: "GHIN-123",
          handicap: "8.4",
          source: "manual",
          as_of: "2026-07-27",
          created_at: "2026-07-27T10:00:00.000Z",
        },
      ],
      error: null,
    });

    const result = await executeSetMemberHandicap(
      actorUserId,
      input,
      correlationId,
      { createClient: () => ({ rpc }) },
    );

    expect(result).toEqual(
      expect.objectContaining({
        membershipVersion: 4,
        handicap: "8.4",
        source: "manual",
      }),
    );
    expect(rpc).toHaveBeenCalledWith("set_member_handicap", {
      p_actor_user_id: actorUserId,
      p_membership_id: membershipId,
      p_handicap_id: "GHIN-123",
      p_handicap: "8.4",
      p_as_of: "2026-07-27",
      p_expected_membership_version: 3,
      p_confirmed: true,
      p_reason: "Correct pre-score handicap",
      p_correlation_id: correlationId,
      p_operation_id: operationId,
    });
  });

  it("includes all form values in the dirty-state fingerprint", () => {
    expect(memberHandicapFingerprint("", "8.4", "", "", false)).not.toBe(
      memberHandicapFingerprint("", "8.4", "", "", true),
    );
  });

  it("requires confirmation before a handicap save discards another dirty form", () => {
    const confirmDiscard = vi.fn().mockReturnValue(false);
    expect(
      shouldAllowMemberFormSubmit(
        "handicap",
        { profile: true, status: false, role: false, handicap: true },
        confirmDiscard,
      ),
    ).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledOnce();
  });
});
