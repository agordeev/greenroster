import { describe, expect, it, vi } from "vitest";

import {
  memberProfileFingerprint,
  memberStatusFingerprint,
  memberTargetPermissions,
  memberEditorFingerprint,
  retainMemberOperationId,
  shouldAllowMemberFormSubmit,
  runMemberEditMutation,
  runMemberStatusMutation,
} from "../apps/web/src/lib/memberships/member-management";
import {
  executeGetMemberPrivateContactDetail,
  executeListManageableMembers,
} from "../apps/web/src/lib/memberships/member-management-data";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-07-27T00:00:00.000Z",
};
const membershipId = "60000000-0000-4000-8000-000000000001";
const operationId = "30000000-0000-4000-8000-000000000001";
const editInput = {
  membershipId,
  firstName: "Ada",
  lastName: "Lovelace",
  spouseFirstName: null,
  spouseLastName: null,
  teeLocation: "middle",
  duesPaid: true,
  secondaryEmail: null,
  homePhone: null,
  workPhone: null,
  mobilePhone: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  stateRegion: null,
  postalCode: null,
  country: null,
  secondaryEmailVisible: false,
  homePhoneVisible: false,
  workPhoneVisible: false,
  mobilePhoneVisible: false,
  addressListed: false,
  expectedProfileVersion: 1,
  expectedContactVersion: 0,
  expectedMembershipVersion: 1,
  reason: null,
  operationId,
} as const;

describe("member management mutation boundaries", () => {
  it("parses only the service member projection and keeps private values off the list path", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          membership_id: membershipId,
          group_id: "50000000-0000-4000-8000-000000000001",
          user_id: session.userId,
          first_name: "Ada",
          last_name: "Lovelace",
          spouse_first_name: null,
          spouse_last_name: null,
          tee_location: "middle",
          role: "member",
          status: "active",
          dues_paid: true,
          membership_version: 1,
          profile_version: 1,
          contact_version: 1,
          created_at: "2026-07-27T00:00:00.000Z",
          activated_at: "2026-07-27T00:00:00.000Z",
          inactivated_at: null,
        },
        {
          membership_id: "60000000-0000-4000-8000-000000000002",
          group_id: "50000000-0000-4000-8000-000000000001",
          user_id: "10000000-0000-4000-8000-000000000002",
          first_name: null,
          last_name: null,
          spouse_first_name: null,
          spouse_last_name: null,
          tee_location: null,
          role: "administrator",
          status: "active",
          dues_paid: false,
          membership_version: 1,
          profile_version: 0,
          contact_version: 0,
          created_at: "2026-07-27T00:00:00.000Z",
          activated_at: "2026-07-27T00:00:00.000Z",
          inactivated_at: null,
        },
      ],
      error: null,
    });
    const members = await executeListManageableMembers(session.userId, {
      createClient: () => ({ rpc }),
    });
    expect(members[0]).toEqual(
      expect.objectContaining({
        membershipId,
        firstName: "Ada",
        contactVersion: 1,
      }),
    );
    expect(members[0]).not.toHaveProperty("mobilePhone");
    expect(members[1]).toEqual(
      expect.objectContaining({
        firstName: "",
        lastName: "",
        profileVersion: 0,
      }),
    );
    expect(rpc).toHaveBeenCalledWith("list_manageable_members", {
      p_actor_user_id: session.userId,
    });
  });

  it("requires the correlation id on the independently audited contact read", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          membership_id: membershipId,
          group_id: "50000000-0000-4000-8000-000000000001",
          contact_exists: true,
          contact_version: 2,
          secondary_email: "secondary@example.test",
          home_phone_display: null,
          work_phone_display: null,
          mobile_phone_display: "+1 555 010 0001",
          address_line1: null,
          address_line2: null,
          city: null,
          state_region: null,
          postal_code: null,
          country: null,
          secondary_email_visible: true,
          home_phone_visible: false,
          work_phone_visible: false,
          mobile_phone_visible: true,
          address_listed: false,
        },
      ],
      error: null,
    });
    const contact = await executeGetMemberPrivateContactDetail(
      session.userId,
      membershipId,
      "20000000-0000-4000-8000-000000000001",
      { createClient: () => ({ rpc }) },
    );
    expect(contact.secondaryEmail).toBe("secondary@example.test");
    expect(rpc).toHaveBeenCalledWith("get_member_private_contact_detail", {
      p_actor_user_id: session.userId,
      p_membership_id: membershipId,
      p_correlation_id: "20000000-0000-4000-8000-000000000001",
    });
  });

  it("authenticates before parsing and rejects client authority fields", async () => {
    const execute = vi.fn();
    const unauthenticated = await runMemberEditMutation(null, null, {
      execute,
      verifySession: vi
        .fn()
        .mockRejectedValue(new MutationError("authentication_required")),
    });
    expect(unauthenticated.ok ? null : unauthenticated.error.code).toBe(
      "authentication_required",
    );
    expect(execute).not.toHaveBeenCalled();

    const forbiddenField = await runMemberEditMutation(
      { ...editInput, groupId: "50000000-0000-4000-8000-000000000001" },
      null,
      { execute, verifySession: vi.fn().mockResolvedValue(session) },
    );
    expect(forbiddenField.ok ? null : forbiddenField.error.code).toBe(
      "validation",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes all optimistic versions and normalized member fields to the executor", async () => {
    const execute = vi.fn().mockResolvedValue({
      membershipId,
      groupId: "50000000-0000-4000-8000-000000000001",
      membershipVersion: 2,
      profileVersion: 2,
      contactVersion: 1,
      status: "active",
    });
    const response = await runMemberEditMutation(
      {
        ...editInput,
        firstName: " Ada ",
        lastName: " Lovelace ",
        teeLocation: " MIDDLE ",
        secondaryEmail: "  ",
      },
      "20000000-0000-4000-8000-000000000001",
      { execute, verifySession: vi.fn().mockResolvedValue(session) },
    );
    expect(response.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      session.userId,
      expect.objectContaining({
        firstName: "Ada",
        lastName: "Lovelace",
        teeLocation: "middle",
        secondaryEmail: null,
        expectedProfileVersion: 1,
        expectedContactVersion: 0,
        expectedMembershipVersion: 1,
        operationId,
      }),
      "20000000-0000-4000-8000-000000000001",
    );
  });

  it("requires explicit confirmation and a reason for status transitions", async () => {
    const execute = vi.fn();
    const response = await runMemberStatusMutation(
      {
        membershipId,
        newStatus: "inactive",
        expectedMembershipVersion: 1,
        confirmed: false,
        reason: "",
        operationId,
      },
      null,
      { execute, verifySession: vi.fn().mockResolvedValue(session) },
    );
    expect(response.ok ? null : response.error.code).toBe("validation");
    expect(response.ok ? null : response.error.fieldErrors).toEqual(
      expect.objectContaining({
        confirmed: expect.any(Array),
        reason: expect.any(Array),
      }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps one operation id for an identical retry and rotates it after edits", () => {
    const createId = vi
      .fn()
      .mockReturnValueOnce(operationId)
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000002");
    const payload = {
      membershipId,
      expectedMembershipVersion: 1,
      reason: "Deactivate",
    };
    const first = retainMemberOperationId(
      { fingerprint: null, operationId: null },
      "status",
      payload,
      createId,
    );
    const retry = retainMemberOperationId(first, "status", payload, createId);
    const changed = retainMemberOperationId(
      retry,
      "status",
      { ...payload, reason: "No longer participating" },
      createId,
    );
    expect(first.operationId).toBe(operationId);
    expect(retry).toEqual(first);
    expect(changed.operationId).toBe("30000000-0000-4000-8000-000000000002");
    expect(createId).toHaveBeenCalledTimes(2);
  });

  it("marks every editor value and audit reason as part of the dirty fingerprint", () => {
    const values = { firstName: "Ada", duesPaid: false, teeLocation: null };
    const baseline = memberEditorFingerprint(values, "", "");
    expect(memberEditorFingerprint(values, "", "")).toBe(baseline);
    expect(
      memberEditorFingerprint({ ...values, duesPaid: true }, "", ""),
    ).not.toBe(baseline);
    expect(memberEditorFingerprint(values, "Corrected name", "")).not.toBe(
      baseline,
    );
    expect(
      memberEditorFingerprint(values, "", "Deactivate for leave"),
    ).not.toBe(baseline);
  });

  it("requires confirmation before one form can discard the other form's draft", () => {
    const confirmDiscard = vi.fn(() => false);
    expect(
      shouldAllowMemberFormSubmit(
        "profile",
        { profile: false, status: true },
        confirmDiscard,
      ),
    ).toBe(false);
    expect(
      shouldAllowMemberFormSubmit(
        "status",
        { profile: true, status: false },
        confirmDiscard,
      ),
    ).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledTimes(2);
    expect(
      shouldAllowMemberFormSubmit(
        "profile",
        { profile: false, status: true },
        () => true,
      ),
    ).toBe(true);
    expect(
      shouldAllowMemberFormSubmit(
        "status",
        { profile: true, status: false },
        () => true,
      ),
    ).toBe(true);
  });

  it("keeps profile and status clean baselines independent after a save", () => {
    const values = { firstName: "Ada", duesPaid: false };
    const profileBaseline = memberProfileFingerprint(values, "");
    const statusBaseline = memberStatusFingerprint("", false);
    expect(memberProfileFingerprint(values, "Corrected typo")).not.toBe(
      profileBaseline,
    );
    expect(memberStatusFingerprint("Deactivate for leave", false)).not.toBe(
      statusBaseline,
    );
    expect(memberProfileFingerprint(values, "")).toBe(profileBaseline);
    expect(memberStatusFingerprint("", false)).toBe(statusBaseline);
  });

  it("reflects coordinator/admin and self-target UI restrictions while leaving final authority in SQL", () => {
    const target = {
      membershipId,
      role: "administrator" as const,
      status: "active" as const,
    };
    expect(
      memberTargetPermissions(
        "70000000-0000-4000-8000-000000000001",
        "coordinator",
        target,
      ),
    ).toEqual({
      canEdit: false,
      canChangeStatus: false,
    });
    expect(
      memberTargetPermissions(membershipId, "administrator", {
        ...target,
        role: "member",
      }),
    ).toEqual({
      canEdit: true,
      canChangeStatus: false,
    });
    expect(
      memberTargetPermissions(
        "70000000-0000-4000-8000-000000000001",
        "administrator",
        { ...target, role: "member" },
      ),
    ).toEqual({
      canEdit: true,
      canChangeStatus: true,
    });
  });
});
