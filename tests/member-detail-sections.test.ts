import { describe, expect, it } from "vitest";

import {
  currentMemberHandicap,
  formatMemberDetailDeliveryState,
  formatMemberDetailTimestamp,
  hasPendingInvitation,
  shouldRenderAdministratorQuota,
} from "../apps/web/src/app/portal/members/member-detail-sections";
import type { MemberDetailProjection } from "../apps/web/src/lib/memberships/member-detail";

const baseProjection: MemberDetailProjection = {
  membershipId: "60000000-0000-4000-8000-000000000001",
  groupId: "50000000-0000-4000-8000-000000000001",
  actorRole: "coordinator",
  accountEmail: "golfer@example.test",
  invitations: [
    {
      invitationId: "70000000-0000-4000-8000-000000000001",
      invitedEmail: "golfer@example.test",
      role: "member",
      status: "pending",
      issuedAt: "2026-07-27T12:00:00.000Z",
      expiresAt: "2026-08-03T12:00:00.000Z",
      acceptedAt: null,
      revokedAt: null,
      expiredAt: null,
      version: 1,
    },
  ],
  deliveries: [],
  quota: {
    projectionReady: true,
    projectedQuota: "18.50",
    projectionSource: { kind: "seed_history", seed_positions: [1, 2] },
    projectionEffectiveAt: "2026-07-27T12:00:00.000Z",
    projectionVersion: 3,
    history: [],
    administratorDetails: {
      initialQuota: "20",
      usesInitialQuota: false,
      initialQuotaProvenance: "manual",
      seedTotals: [{ position: 1, pointTotal: "30" }],
      settingsVersion: 2,
      settingsMethod: "moving_average",
      settingsHistoryLength: 4,
      settingsPrecision: 2,
      settingsRoundingRule: "half_away_from_zero",
    },
  },
  handicaps: [
    {
      recordId: "80000000-0000-4000-8000-000000000001",
      handicapId: "GHIN-1",
      handicap: "12.4",
      source: "manual",
      asOf: "2026-07-26",
      createdAt: "2026-07-26T12:00:00.000Z",
    },
  ],
  activity: [],
};

describe("member detail section helpers", () => {
  it("formats timestamps in UTC by default and uses the supplied group zone", () => {
    expect(formatMemberDetailTimestamp("2026-07-27T12:00:00.000Z")).toContain(
      "UTC",
    );
    expect(
      formatMemberDetailTimestamp(
        "2026-07-27T12:00:00.000Z",
        "America/Los_Angeles",
      ),
    ).toContain("PDT");
    expect(formatMemberDetailTimestamp("not-a-date")).toBe("Unavailable");
  });

  it("keeps current handicap and pending invitation visibility projection-driven", () => {
    expect(currentMemberHandicap(baseProjection.handicaps)?.handicap).toBe(
      "12.4",
    );
    expect(hasPendingInvitation(baseProjection.invitations)).toBe(true);
    expect(
      hasPendingInvitation(
        baseProjection.invitations.map((invitation) => ({
          ...invitation,
          status: "accepted" as const,
        })),
      ),
    ).toBe(false);
    expect(shouldRenderAdministratorQuota(baseProjection)).toBe(false);
    expect(
      shouldRenderAdministratorQuota({
        ...baseProjection,
        actorRole: "administrator",
      }),
    ).toBe(true);
  });

  it("labels failed and suppressed delivery states explicitly", () => {
    expect(
      formatMemberDetailDeliveryState({
        deliveryId: "90000000-0000-4000-8000-000000000001",
        eventType: "membership_invitation",
        recipientAddress: "golfer@example.test",
        channel: "email",
        state: "failed_permanent",
        attempts: 3,
        failureReason: "hard bounce",
        suppressionReason: null,
        sentAt: null,
        createdAt: "2026-07-27T12:00:00.000Z",
        updatedAt: "2026-07-27T12:05:00.000Z",
      }),
    ).toBe("Failed — hard bounce");
    expect(
      formatMemberDetailDeliveryState({
        deliveryId: "90000000-0000-4000-8000-000000000002",
        eventType: "membership_invitation",
        recipientAddress: "golfer@example.test",
        channel: "email",
        state: "suppressed",
        attempts: 1,
        failureReason: null,
        suppressionReason: "bounce",
        sentAt: null,
        createdAt: "2026-07-27T12:00:00.000Z",
        updatedAt: "2026-07-27T12:05:00.000Z",
      }),
    ).toBe("Not sent — Hard bounce");
  });
});
