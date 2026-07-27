import { describe, expect, it, vi } from "vitest";

import {
  buildMemberProfileCreatePayload,
  buildMemberHandicapRecordPayload,
  canCreatePendingMember,
  emptyMemberCreateInviteDraft,
  memberCreateInviteFingerprint,
  memberCreateRequiresHandicapBeforeInvite,
  parseMemberCreateInviteRecovery,
  retainMemberCreateInviteOperationId,
  serializeMemberCreateInviteRecovery,
  shouldResetMemberCreateConfirmation,
} from "../apps/web/src/app/portal/members/member-create-invite-state";

describe("member create and invite UI state", () => {
  it("requires a drafted handicap to be recorded before invitation", () => {
    const withHandicap = {
      ...emptyMemberCreateInviteDraft,
      handicap: "12.1",
    };
    expect(memberCreateRequiresHandicapBeforeInvite(withHandicap, false)).toBe(
      true,
    );
    expect(memberCreateRequiresHandicapBeforeInvite(withHandicap, true)).toBe(
      false,
    );
    expect(
      memberCreateRequiresHandicapBeforeInvite(
        emptyMemberCreateInviteDraft,
        false,
      ),
    ).toBe(false);
  });

  it.each([
    ["member", false],
    ["coordinator", true],
    ["administrator", true],
  ] as const)("only %s can see the create controls", (role, visible) => {
    expect(canCreatePendingMember(role)).toBe(visible);
  });

  it("retains one create operation id for an unchanged retry", () => {
    const createId = vi
      .fn()
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000002");
    const payload = { firstName: "Ada", lastName: "Lovelace" };

    const first = retainMemberCreateInviteOperationId(
      { fingerprint: null, operationId: null },
      "create",
      payload,
      createId,
    );
    const retry = retainMemberCreateInviteOperationId(
      first,
      "create",
      payload,
      createId,
    );

    expect(retry).toEqual(first);
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it("changes operation ids when the draft or operation changes", () => {
    const createId = vi
      .fn()
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000002")
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000003")
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000004");
    const payload = { membershipId: "60000000-0000-4000-8000-000000000001" };
    const first = retainMemberCreateInviteOperationId(
      { fingerprint: null, operationId: null },
      "create",
      payload,
      createId,
    );
    const changedDraft = retainMemberCreateInviteOperationId(
      first,
      "create",
      { ...payload, firstName: "Grace" },
      createId,
    );
    const invite = retainMemberCreateInviteOperationId(
      changedDraft,
      "invite",
      { ...payload, invitedEmail: "grace@example.com" },
      createId,
    );
    const handicap = retainMemberCreateInviteOperationId(
      invite,
      "handicap",
      { ...payload, handicap: "8.4", asOf: "2026-07-27" },
      createId,
    );
    const handicapRetry = retainMemberCreateInviteOperationId(
      handicap,
      "handicap",
      { ...payload, handicap: "8.4", asOf: "2026-07-27" },
      createId,
    );

    expect(
      new Set([
        first.operationId,
        changedDraft.operationId,
        invite.operationId,
        handicap.operationId,
      ]).size,
    ).toBe(4);
    expect(handicapRetry).toEqual(handicap);
    expect(memberCreateInviteFingerprint("create", payload)).not.toBe(
      memberCreateInviteFingerprint("invite", payload),
    );
  });

  it("invalidates create confirmation on edits until the member exists", () => {
    expect(shouldResetMemberCreateConfirmation(null)).toBe(true);
    expect(
      shouldResetMemberCreateConfirmation(
        "60000000-0000-4000-8000-000000000001",
      ),
    ).toBe(false);
  });

  it("retains create idempotency when only the invite address changes", () => {
    const createId = vi
      .fn()
      .mockReturnValue("30000000-0000-4000-8000-000000000001");
    const firstPayload = buildMemberProfileCreatePayload({
      ...emptyMemberCreateInviteDraft,
      firstName: "Ada",
      lastName: "Lovelace",
      invitedEmail: "first@example.test",
    });
    const correctedPayload = buildMemberProfileCreatePayload({
      ...emptyMemberCreateInviteDraft,
      firstName: "Ada",
      lastName: "Lovelace",
      invitedEmail: "corrected@example.test",
    });
    const first = retainMemberCreateInviteOperationId(
      { fingerprint: null, operationId: null },
      "create",
      firstPayload,
      createId,
    );
    const retry = retainMemberCreateInviteOperationId(
      first,
      "create",
      correctedPayload,
      createId,
    );

    expect(correctedPayload).toEqual(firstPayload);
    expect(retry).toEqual(first);
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it("includes trimmed phone and address fields with explicit visibility choices", () => {
    const payload = buildMemberProfileCreatePayload({
      ...emptyMemberCreateInviteDraft,
      firstName: " Ada ",
      lastName: " Lovelace ",
      homePhone: " +1 555 0100 ",
      workPhone: " +1 555 0101 ",
      mobilePhone: " +1 555 0102 ",
      addressLine1: " 1 Analytical Engine Way ",
      addressLine2: " Suite 2 ",
      city: " London ",
      stateRegion: " London ",
      postalCode: " N1 1AA ",
      country: " United Kingdom ",
      homePhoneVisible: true,
      workPhoneVisible: true,
      addressListed: true,
    });

    expect(payload).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      homePhone: "+1 555 0100",
      workPhone: "+1 555 0101",
      mobilePhone: "+1 555 0102",
      addressLine1: "1 Analytical Engine Way",
      addressLine2: "Suite 2",
      city: "London",
      stateRegion: "London",
      postalCode: "N1 1AA",
      country: "United Kingdom",
      homePhoneVisible: true,
      workPhoneVisible: true,
      addressListed: true,
    });
  });

  it("keeps handicap recording separate from profile creation at version one", () => {
    const draft = {
      ...emptyMemberCreateInviteDraft,
      handicapId: " GHIN-123 ",
      handicap: " 8.4 ",
      handicapAsOf: " 2026-07-27 ",
      handicapReason: " Pre-score correction ",
      handicapConfirmed: true,
    };

    expect(buildMemberProfileCreatePayload(draft)).not.toHaveProperty(
      "handicap",
    );
    expect(
      buildMemberHandicapRecordPayload(
        draft,
        "60000000-0000-4000-8000-000000000001",
      ),
    ).toEqual({
      membershipId: "60000000-0000-4000-8000-000000000001",
      handicapId: "GHIN-123",
      handicap: "8.4",
      asOf: "2026-07-27",
      expectedMembershipVersion: 1,
      confirmed: true,
      reason: "Pre-score correction",
    });
  });

  it("round-trips safe recovery state and rejects an invalid target", () => {
    const snapshot = {
      draft: {
        ...emptyMemberCreateInviteDraft,
        firstName: "Grace",
        lastName: "Hopper",
        invitedEmail: "grace@example.test",
      },
      createdMembershipId: "60000000-0000-4000-8000-000000000001",
      createOperation: {
        fingerprint: "create:payload",
        operationId: "30000000-0000-4000-8000-000000000001",
      },
      inviteOperation: { fingerprint: null, operationId: null },
      handicapOperation: { fingerprint: null, operationId: null },
    };

    expect(
      parseMemberCreateInviteRecovery(
        serializeMemberCreateInviteRecovery(snapshot),
      ),
    ).toEqual(snapshot);
    expect(
      parseMemberCreateInviteRecovery(
        serializeMemberCreateInviteRecovery({
          ...snapshot,
          createdMembershipId: "not-a-membership-id",
        }),
      ),
    ).toBeNull();
  });

  it("upgrades an older recovery snapshot with private contact defaults", () => {
    const legacy = {
      draft: {
        firstName: "Grace",
        lastName: "Hopper",
        invitedEmail: "grace@example.test",
        spouseFirstName: "",
        spouseLastName: "",
        teeLocation: "",
        duesPaid: false,
        secondaryEmail: "",
        mobilePhone: "",
        secondaryEmailVisible: false,
        mobilePhoneVisible: false,
        reason: "",
      },
      createdMembershipId: null,
      createOperation: { fingerprint: null, operationId: null },
      inviteOperation: { fingerprint: null, operationId: null },
    };

    expect(parseMemberCreateInviteRecovery(JSON.stringify(legacy))).toEqual({
      ...legacy,
      draft: {
        ...emptyMemberCreateInviteDraft,
        ...legacy.draft,
      },
      handicapOperation: { fingerprint: null, operationId: null },
    });
  });
});
