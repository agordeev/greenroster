import { describe, expect, it, vi } from "vitest";

import {
  memberQuotaBootstrapFingerprint,
  memberQuotaEditorDraftFingerprint,
  memberQuotaEditorInput,
  memberQuotaEditorRecoveryStorageKeyForMembership,
  parseMemberQuotaEditorRecovery,
  retainMemberQuotaBootstrapOperationId,
  resolveMemberQuotaUseInitialQuota,
  serializeMemberQuotaEditorRecovery,
  validateMemberQuotaEditorDraft,
  type MemberQuotaEditorDraft,
} from "../apps/web/src/app/portal/members/member-quota-editor-state";

const baseInput = {
  expectedProjectionVersion: 3,
  expectedSettingsVersion: 8,
  initialQuota: " 18.5 ",
  membershipId: "60000000-0000-4000-8000-000000000001",
  reason: "  Corrected seed history  ",
  seedTotals: [" 20 ", "30"],
  useInitialQuota: true,
} as const;

const baseDraft: MemberQuotaEditorDraft = {
  initialQuota: "18.5",
  reason: "Corrected seed history",
  seedTotals: ["20", "30"],
  useInitialQuota: true,
};

describe("member quota editor state", () => {
  it("retains one operation id for an unchanged normalized payload", () => {
    const createId = vi
      .fn()
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000002");

    const first = retainMemberQuotaBootstrapOperationId(
      { fingerprint: null, operationId: null },
      baseInput,
      createId,
    );
    const retry = retainMemberQuotaBootstrapOperationId(
      first,
      {
        ...baseInput,
        initialQuota: "18.5",
        reason: "Corrected seed history",
        seedTotals: ["20", "30"],
      },
      createId,
    );

    expect(retry).toEqual(first);
    expect(createId).toHaveBeenCalledTimes(1);
    expect(
      memberQuotaBootstrapFingerprint({
        ...baseInput,
        seedTotals: ["20", "30", "  "],
      }),
    ).toBe(memberQuotaBootstrapFingerprint(baseInput));
  });

  it("rotates the operation id when a protected payload changes", () => {
    const createId = vi
      .fn()
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000002");
    const first = retainMemberQuotaBootstrapOperationId(
      { fingerprint: null, operationId: null },
      baseInput,
      createId,
    );
    const changed = retainMemberQuotaBootstrapOperationId(
      first,
      { ...baseInput, seedTotals: ["20", "31"] },
      createId,
    );

    expect(changed.operationId).not.toBe(first.operationId);
    expect(memberQuotaBootstrapFingerprint(baseInput)).not.toBe(
      memberQuotaBootstrapFingerprint({
        ...baseInput,
        seedTotals: ["20", "31"],
      }),
    );
  });

  it("requires an audit reason and explicit confirmation", () => {
    expect(
      validateMemberQuotaEditorDraft({ ...baseDraft, reason: "" }, true),
    ).toBe("Provide a reason for this quota bootstrap change.");
    expect(validateMemberQuotaEditorDraft(baseDraft, false)).toBe(
      "Confirm the quota bootstrap change before saving.",
    );
    expect(validateMemberQuotaEditorDraft(baseDraft, true)).toBeNull();
  });

  it("defaults a newly supplied initial quota on while retaining an explicit off choice", () => {
    expect(resolveMemberQuotaUseInitialQuota("18.5", null)).toBe(true);
    expect(resolveMemberQuotaUseInitialQuota("", null)).toBe(false);
    expect(resolveMemberQuotaUseInitialQuota("18.5", false)).toBe(false);
  });

  it("marks quota edits dirty when draft or confirmation changes", () => {
    const baseline = memberQuotaEditorDraftFingerprint(baseDraft, false);
    expect(memberQuotaEditorDraftFingerprint(baseDraft, false)).toBe(baseline);
    expect(memberQuotaEditorDraftFingerprint(baseDraft, true)).not.toBe(
      baseline,
    );
    expect(
      memberQuotaEditorDraftFingerprint(
        { ...baseDraft, reason: "Another reason" },
        false,
      ),
    ).not.toBe(baseline);
  });

  it("rejects gaps in ordered seeds and cannot freeze a missing initial quota", () => {
    expect(
      validateMemberQuotaEditorDraft(
        { ...baseDraft, seedTotals: ["20", "", "30"] },
        true,
      ),
    ).toBe("Complete each seed total or remove the empty row.");
    expect(
      validateMemberQuotaEditorDraft(
        { ...baseDraft, initialQuota: "", useInitialQuota: true },
        true,
      ),
    ).toBe("Enter an initial quota before selecting Use initial quota.");
  });

  it("builds a server input with confirmation and normalized seed ordering", () => {
    expect(
      memberQuotaEditorInput(
        baseInput.membershipId,
        baseInput.expectedProjectionVersion,
        baseInput.expectedSettingsVersion,
        { ...baseDraft, initialQuota: "", seedTotals: ["20", ""] },
        "30000000-0000-4000-8000-000000000001",
      ),
    ).toEqual({
      confirmed: true,
      expectedProjectionVersion: 3,
      expectedSettingsVersion: 8,
      initialQuota: null,
      membershipId: baseInput.membershipId,
      operationId: "30000000-0000-4000-8000-000000000001",
      reason: baseDraft.reason,
      seedTotals: ["20"],
      useInitialQuota: false,
    });
  });

  it("round-trips validated recovery without allowing a guessed membership", () => {
    const recovery = {
      membershipId: baseInput.membershipId,
      draft: baseDraft,
      operation: {
        fingerprint: "payload",
        operationId: "30000000-0000-4000-8000-000000000001",
      },
      message: null,
      restoreDraft: true,
    } as const;
    expect(
      parseMemberQuotaEditorRecovery(
        serializeMemberQuotaEditorRecovery(recovery),
      ),
    ).toEqual(recovery);
    expect(
      parseMemberQuotaEditorRecovery(
        serializeMemberQuotaEditorRecovery({
          ...recovery,
          membershipId: "not-a-membership-id",
        }),
      ),
    ).toBeNull();
    expect(
      parseMemberQuotaEditorRecovery(
        JSON.stringify({ ...recovery, restoreDraft: "yes" }),
      ),
    ).toBeNull();
  });

  it("scopes recovery storage keys to the target membership", () => {
    expect(
      memberQuotaEditorRecoveryStorageKeyForMembership(baseInput.membershipId),
    ).toContain(baseInput.membershipId);
    expect(
      memberQuotaEditorRecoveryStorageKeyForMembership(baseInput.membershipId),
    ).not.toBe(
      memberQuotaEditorRecoveryStorageKeyForMembership(
        "60000000-0000-4000-8000-000000000002",
      ),
    );
  });
});
