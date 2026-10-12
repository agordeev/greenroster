import "server-only";

import { executeListManageableInvitations } from "../invitations/invitation-lifecycle-data";
import type { ManageableInvitation } from "../invitations/invitation-lifecycle";
import { executeListManageableMembers } from "../memberships/member-management-data";
import type { ManageableMember } from "../memberships/member-management";
import {
  executeReadMemberOfficialResults,
  executeReadMemberStandings,
  isQuotaRulesMissing,
} from "../rounds/member-results-data";
import { executeListRoundDrafts } from "../rounds/round-drafts-data";
import type { RoundDraft } from "../../domain/round-drafts";
import {
  executeReadNotificationDeliveryHealth,
  type NotificationDeliveryHealth,
} from "../notifications/notification-health-data";
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
  listRounds: (actorUserId: string) => Promise<readonly RoundDraft[]>;
  readOfficialResults: (
    actorUserId: string,
    roundId: string,
  ) => ReturnType<typeof executeReadMemberOfficialResults>;
  readStandings: (
    actorUserId: string,
  ) => ReturnType<typeof executeReadMemberStandings>;
  readNotificationHealth: (
    actorUserId: string,
  ) => Promise<NotificationDeliveryHealth>;
}>;

const defaultDependencies: PortalDashboardDataDependencies = {
  listMembers: (actorUserId) => executeListManageableMembers(actorUserId),
  listInvitations: (actorUserId) =>
    executeListManageableInvitations(actorUserId),
  listRounds: (actorUserId) => executeListRoundDrafts(actorUserId),
  readOfficialResults: (actorUserId, roundId) =>
    executeReadMemberOfficialResults(actorUserId, roundId),
  readStandings: (actorUserId) => executeReadMemberStandings(actorUserId),
  readNotificationHealth: (actorUserId) =>
    executeReadNotificationDeliveryHealth(actorUserId),
};

export async function executePortalDashboardData(
  actorUserId: string,
  overrides?: Partial<PortalDashboardDataDependencies> & {
    loadPhase06?: boolean;
    loadPhase07?: boolean;
  },
): Promise<PortalDashboardSummary> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const [members, invitations] = await Promise.all([
    dependencies.listMembers(actorUserId),
    dependencies.listInvitations(actorUserId),
  ]);

  // Keep the original projection-only dependency contract usable by focused
  // callers while the production page opts into the Phase 06 reads by default.
  const loadPhase06 =
    overrides?.loadPhase06 ??
    (overrides === undefined ||
      "listRounds" in overrides ||
      "readOfficialResults" in overrides ||
      "readStandings" in overrides);
  if (!loadPhase06) return buildPortalDashboardSummary(members, invitations);

  const [rounds, standings] = await Promise.all([
    dependencies.listRounds(actorUserId),
    // A new group has no quota rules yet; its counts still load.
    dependencies.readStandings(actorUserId).catch((error: unknown) => {
      if (isQuotaRulesMissing(error)) return [];
      throw error;
    }),
  ]);
  const completedRound = selectMostRecentCompletedRound(rounds);
  const officialResults = completedRound
    ? await dependencies.readOfficialResults(
        actorUserId,
        completedRound.roundId,
      )
    : null;

  const loadPhase07 =
    overrides?.loadPhase07 ??
    (overrides === undefined || "readNotificationHealth" in overrides);
  const notificationHealth = loadPhase07
    ? await dependencies.readNotificationHealth(actorUserId)
    : null;

  const phase06Input = {
    completedRound: completedRound
      ? {
          roundId: completedRound.roundId,
          description: completedRound.description,
          scheduledAt: completedRound.scheduledAt,
          groupTimeZone: completedRound.groupTimeZone,
        }
      : null,
    officialResults:
      officialResults?.results.map((result) => ({
        firstName: result.first_name,
        lastName: result.last_name,
        competitionRank: result.competition_rank,
        completedAt: result.completed_at,
      })) ?? [],
    standings: standings.map((standing) => ({
      membershipId: standing.membership_id,
      firstName: standing.first_name,
      lastName: standing.last_name,
      meritTotal: standing.merit_total,
      standingRank: standing.standing_rank,
    })),
    standingsResetDate: standings[0]?.standings_reset_date ?? null,
  };

  return buildPortalDashboardSummary(
    members,
    invitations,
    phase06Input,
    notificationHealth
      ? {
          health: {
            outboxQueued: notificationHealth.outboxQueued,
            outboxProcessing: notificationHealth.outboxProcessing,
            outboxRetryable: notificationHealth.outboxRetryable,
            outboxOldestAt: notificationHealth.outboxOldestAt,
            emailFailedPermanent: notificationHealth.emailFailedPermanent,
            emailSuppressed: notificationHealth.emailSuppressed,
            emailBounceRate: notificationHealth.emailBounceRate,
            emailComplaintRate: notificationHealth.emailComplaintRate,
            pushFailedPermanent: notificationHealth.pushFailedPermanent,
            pushInvalidTokenRate: notificationHealth.pushInvalidTokenRate,
            pushReceiptFailed: notificationHealth.pushReceiptFailed,
            sampledAt: notificationHealth.sampledAt,
          },
        }
      : undefined,
  );
}

function selectMostRecentCompletedRound(
  rounds: readonly RoundDraft[],
): RoundDraft | null {
  return (
    rounds
      .filter((round) => round.state === "completed")
      .toSorted((left, right) => {
        const leftTime = parseRoundDate(left.scheduledAt);
        const rightTime = parseRoundDate(right.scheduledAt);
        if (leftTime !== rightTime) return rightTime - leftTime;

        const leftUpdated = parseRoundDate(left.updatedAt ?? left.createdAt);
        const rightUpdated = parseRoundDate(right.updatedAt ?? right.createdAt);
        if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
        return right.roundId.localeCompare(left.roundId);
      })[0] ?? null
  );
}

function parseRoundDate(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}
