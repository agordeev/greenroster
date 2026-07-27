import { describe, expect, it, vi } from "vitest";

import {
  buildMemberProfileCreatePayload,
  canCreatePendingMember,
  emptyMemberCreateInviteDraft,
  memberCreateInviteFingerprint,
  parseMemberCreateInviteRecovery,
  retainMemberCreateInviteOperationId,
  serializeMemberCreateInviteRecovery,
  shouldResetMemberCreateConfirmation,
} from "../apps/web/src/app/portal/members/member-create-invite-state";

describe("member create and invite UI state", () => {
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
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000003");
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

    expect(
      new Set([first.operationId, changedDraft.operationId, invite.operationId])
        .size,
    ).toBe(3);
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
});
