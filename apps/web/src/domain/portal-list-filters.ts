import type { ManageableInvitation } from "../lib/invitations/invitation-lifecycle";
import type {
  ManageableMember,
  MemberStatus,
} from "../lib/memberships/member-management";

export type InvitationDeliveryFilter = "action-required";

const memberStatusValues = new Set<MemberStatus>([
  "pending",
  "active",
  "inactive",
]);

export function parseMemberStatusFilter(
  value: string | readonly string[] | undefined,
): MemberStatus | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && memberStatusValues.has(candidate as MemberStatus)
    ? (candidate as MemberStatus)
    : null;
}

export function filterManageableMembers<
  T extends Pick<ManageableMember, "status">,
>(members: readonly T[], status: MemberStatus | null): readonly T[] {
  return status
    ? members.filter((member) => member.status === status)
    : members;
}

export function parseInvitationDeliveryFilter(
  value: string | readonly string[] | undefined,
): InvitationDeliveryFilter | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "action-required" ? candidate : null;
}

export function filterManageableInvitations<
  T extends Pick<ManageableInvitation, "deliveryActionRequired">,
>(
  invitations: readonly T[],
  delivery: InvitationDeliveryFilter | null,
): readonly T[] {
  if (delivery !== "action-required") return invitations;
  return invitations.filter((invitation) => invitation.deliveryActionRequired);
}

const deliveryStateLabels = new Map<string, string>([
  ["queued", "Queued"],
  ["sending", "Sending"],
  ["sent", "Sent"],
  ["retryable", "Retrying"],
  ["failed_permanent", "Could not be delivered"],
  ["suppressed", "Not sent to this address"],
  ["cancelled", "Cancelled"],
]);

function deliveryStateLabel(state: string): string {
  return deliveryStateLabels.get(state) ?? state.replaceAll("_", " ");
}

export function describeInvitationDelivery(
  invitation: Pick<
    ManageableInvitation,
    "deliveryActionRequired" | "deliveryState"
  >,
): string {
  if (
    invitation.deliveryActionRequired &&
    invitation.deliveryState !== "failed_permanent" &&
    invitation.deliveryState !== "suppressed"
  ) {
    const latest = invitation.deliveryState
      ? ` Latest delivery: ${deliveryStateLabel(invitation.deliveryState)}.`
      : "";
    return `Ask the member for a new e-mail address. Messages to this one are blocked.${latest}`;
  }

  return invitation.deliveryState
    ? `Latest delivery: ${deliveryStateLabel(invitation.deliveryState)}`
    : "Delivery has not started";
}
