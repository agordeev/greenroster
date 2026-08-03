import { describe, expect, it, vi } from "vitest";

import {
  roundPublicationPreviewInputSchema,
  roundPublicationReviewFromRows,
  roundPublicationReviewKey,
  summarizeRoundPublication,
} from "../apps/web/src/domain/round-publication";
import {
  runRoundPublicationMutation,
  runRoundPublicationPreview,
} from "../apps/web/src/lib/rounds/round-publication";
import { MutationError } from "../apps/web/src/lib/mutations/result";

const session = {
  userId: "10000000-0000-4000-8000-000000000001",
  emailConfirmedAt: "2026-08-03T00:00:00.000Z",
};

const baseMember = {
  round_id: "60000000-0000-4000-8000-000000000001",
  format: "individual_net" as const,
  review_version: 1,
  review_fingerprint:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  membership_id: "40000000-0000-4000-8000-000000000001",
  group_id: "50000000-0000-4000-8000-000000000001",
  first_name: "Ada",
  last_name: "Lovelace",
  eligibility_state: "eligible" as const,
  ineligibility_reason: null,
  included: true,
  projection_ready: true,
  projected_quota: "12.5",
  quota_snapshot_source: { method: "moving_average" },
  handicap_snapshot: "9.2",
  handicap_snapshot_source: "manual" as const,
  handicap_snapshot_as_of: "2026-08-01",
  tee_snapshot: "middle" as const,
  email_ready: true,
};

describe("round publication domain boundary", () => {
  it("changes the review identity when the server fingerprint changes", () => {
    expect(
      roundPublicationReviewKey({
        roundVersion: 1,
        reviewFingerprint: "a".repeat(64),
      }),
    ).not.toBe(
      roundPublicationReviewKey({
        roundVersion: 1,
        reviewFingerprint: "b".repeat(64),
      }),
    );
  });

  it("rejects authority fields and malformed exclusion ids", () => {
    expect(
      roundPublicationPreviewInputSchema.safeParse({
        roundId: "60000000-0000-4000-8000-000000000001",
        excludedMembershipIds: [],
        groupId: "90000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
    expect(
      roundPublicationPreviewInputSchema.safeParse({
        roundId: "60000000-0000-4000-8000-000000000001",
        excludedMembershipIds: ["not-a-uuid"],
      }).success,
    ).toBe(false);
  });

  it("counts readiness from server rows and only requires quota for net", () => {
    const rows = [
      baseMember,
      {
        ...baseMember,
        membership_id: "40000000-0000-4000-8000-000000000002",
        first_name: "Grace",
        projection_ready: false,
        projected_quota: null,
        quota_snapshot_source: null,
        email_ready: true,
      },
      {
        ...baseMember,
        membership_id: "40000000-0000-4000-8000-000000000003",
        first_name: "Katherine",
        eligibility_state: "ineligible" as const,
        ineligibility_reason: "inactive_membership",
        included: false,
      },
    ];
    expect(
      summarizeRoundPublication(
        rows.map((row) => ({
          membershipId: row.membership_id,
          groupId: row.group_id,
          firstName: row.first_name,
          lastName: row.last_name,
          eligibilityState: row.eligibility_state,
          eligibilityReason: row.ineligibility_reason,
          included: row.included,
          projectionReady: row.projection_ready,
          projectedQuota: row.projected_quota,
          quotaSnapshotSource: row.quota_snapshot_source,
          handicapSnapshot: row.handicap_snapshot,
          handicapSnapshotSource: row.handicap_snapshot_source,
          handicapSnapshotAsOf: row.handicap_snapshot_as_of,
          teeSnapshot: row.tee_snapshot,
          roundVersion: row.review_version,
          reviewFingerprint: row.review_fingerprint,
          emailReady: row.email_ready,
        })),
        "individual_net",
      ),
    ).toEqual({
      activeMemberCount: 3,
      includedMemberCount: 2,
      noResponseCount: 2,
      ineligibleCount: 1,
      excludedCount: 0,
      missingQuotaCount: 1,
      notificationRecipientCount: 2,
    });
    expect(
      roundPublicationReviewFromRows(
        [rows[0], rows[1]].map((row) => ({
          ...row,
          format: "individual_gross" as const,
        })),
      ).summary.missingQuotaCount,
    ).toBe(0);
    const quotaMissing = {
      ...baseMember,
      membership_id: "40000000-0000-4000-8000-000000000004",
      eligibility_state: "ineligible" as const,
      ineligibility_reason: "quota_not_ready",
      included: false,
      projection_ready: false,
      projected_quota: null,
      quota_snapshot_source: null,
    };
    expect(
      roundPublicationReviewFromRows([quotaMissing]).summary.missingQuotaCount,
    ).toBe(1);
    expect(
      roundPublicationReviewFromRows([
        {
          ...quotaMissing,
          eligibility_state: "excluded" as const,
          ineligibility_reason: "explicitly_excluded",
        },
      ]).summary.missingQuotaCount,
    ).toBe(0);
  });

  it("authenticates before parsing the protected preview", async () => {
    const execute = vi.fn();
    const result = await runRoundPublicationPreview(
      { roundId: "not-a-uuid", excludedMembershipIds: [] },
      null,
      {
        execute,
        verifySession: vi
          .fn()
          .mockRejectedValue(new MutationError("authentication_required")),
      },
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe(
      "authentication_required",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves stale-version failures from publish", async () => {
    const result = await runRoundPublicationMutation(
      {
        roundId: "60000000-0000-4000-8000-000000000001",
        excludedMembershipIds: [],
        operationId: "70000000-0000-4000-8000-000000000001",
        expectedRoundVersion: 1,
        reviewFingerprint:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      null,
      {
        execute: vi.fn().mockRejectedValue(new MutationError("stale_version")),
        verifySession: vi.fn().mockResolvedValue(session),
      },
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("stale_version");
  });
});
