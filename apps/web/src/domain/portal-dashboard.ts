import type { ManageableInvitation } from "../lib/invitations/invitation-lifecycle";
import type { ManageableMember } from "../lib/memberships/member-management";

export type PortalDashboardSummary = Readonly<{
  membershipCounts: Readonly<{
    pending: number;
    active: number;
    inactive: number;
  }>;
  actionRequiredInvitations: Readonly<{
    failedPermanent: number;
    suppressed: number;
    addressSuppression: number;
    total: number;
  }>;
}>;

export function buildPortalDashboardSummary(
  members: readonly Pick<ManageableMember, "status">[],
  invitations: readonly Pick<
    ManageableInvitation,
    "deliveryState" | "deliveryActionRequired"
  >[],
): PortalDashboardSummary {
  const membershipCounts = {
    pending: 0,
    active: 0,
    inactive: 0,
  };

  for (const member of members) {
    membershipCounts[member.status] += 1;
  }

  const failedPermanent = invitations.filter(
    ({ deliveryState }) => deliveryState === "failed_permanent",
  ).length;
  const suppressed = invitations.filter(
    ({ deliveryState }) => deliveryState === "suppressed",
  ).length;
  const total = invitations.filter(
    ({ deliveryActionRequired }) => deliveryActionRequired,
  ).length;

  return {
    membershipCounts,
    actionRequiredInvitations: {
      failedPermanent,
      suppressed,
      addressSuppression: Math.max(0, total - failedPermanent - suppressed),
      total,
    },
  };
}
