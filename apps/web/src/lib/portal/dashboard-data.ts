import "server-only";

import { executeListManageableInvitations } from "../invitations/invitation-lifecycle-data";
import type { ManageableInvitation } from "../invitations/invitation-lifecycle";
import { executeListManageableMembers } from "../memberships/member-management-data";
import type { ManageableMember } from "../memberships/member-management";
import {
  buildPortalDashboardSummary,
  type PortalDashboardSummary,
} from "../../domain/portal-dashboard";

export type PortalDashboardDataDependencies = Readonly<{
  listMembers: (
    actorUserId: string,
  ) => Promise<readonly Pick<ManageableMember, "status">[]>;
  listInvitations: (
    actorUserId: string,
  ) => Promise<
    readonly Pick<
      ManageableInvitation,
      "deliveryState" | "deliveryActionRequired"
    >[]
  >;
}>;

const defaultDependencies: PortalDashboardDataDependencies = {
  listMembers: (actorUserId) => executeListManageableMembers(actorUserId),
  listInvitations: (actorUserId) =>
    executeListManageableInvitations(actorUserId),
};

export async function executePortalDashboardData(
  actorUserId: string,
  overrides?: Partial<PortalDashboardDataDependencies>,
): Promise<PortalDashboardSummary> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const [members, invitations] = await Promise.all([
    dependencies.listMembers(actorUserId),
    dependencies.listInvitations(actorUserId),
  ]);

  return buildPortalDashboardSummary(members, invitations);
}
