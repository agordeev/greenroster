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
  completedResult?: PortalDashboardCompletedResultSummary | null;
  standingsSummary?: PortalDashboardStandingsSummary;
  notificationHealth?: PortalDashboardNotificationHealth;
}>;

export type PortalDashboardNotificationHealth = Readonly<{
  queueDepth: number;
  oldestQueuedAt: string | null;
  emailFailures: number;
  emailBounceRate: number;
  emailComplaintRate: number;
  pushFailures: number;
  pushInvalidTokenRate: number;
  receiptFailures: number;
  sampledAt: string;
}>;

export type PortalDashboardCompletedRoundInput = Readonly<{
  roundId: string;
  description: string | null;
  scheduledAt: string | null;
  groupTimeZone: string;
}>;

export type PortalDashboardOfficialResultInput = Readonly<{
  firstName: string | null;
  lastName: string | null;
  competitionRank: number | null;
  completedAt: string;
}>;

export type PortalDashboardStandingInput = Readonly<{
  membershipId: string;
  firstName: string | null;
  lastName: string | null;
  meritTotal: string | null;
  standingRank: number | null;
}>;

export type PortalDashboardCompletedResultSummary = Readonly<{
  roundId: string;
  description: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  groupTimeZone: string;
  winnerNames: readonly string[];
  winnerRank: number | null;
  resultCount: number;
}>;

export type PortalDashboardStandingsSummary = Readonly<{
  memberCount: number;
  rankedMemberCount: number;
  standingsResetDate: string | null;
  leader: Readonly<{
    membershipId: string;
    name: string;
    meritTotal: string | null;
    standingRank: number;
  }> | null;
}>;

export type PortalDashboardPhase06Input = Readonly<{
  completedRound: PortalDashboardCompletedRoundInput | null;
  officialResults: readonly PortalDashboardOfficialResultInput[];
  standings: readonly PortalDashboardStandingInput[];
  standingsResetDate: string | null;
}>;

export type PortalDashboardPhase07Input = Readonly<{
  health: Readonly<{
    outboxQueued: number;
    outboxProcessing: number;
    outboxRetryable: number;
    outboxOldestAt: string | null;
    emailFailedPermanent: number;
    emailSuppressed: number;
    emailBounceRate: number;
    emailComplaintRate: number;
    pushFailedPermanent: number;
    pushInvalidTokenRate: number;
    pushReceiptFailed: number;
    sampledAt: string;
  }>;
}>;

export function buildPortalDashboardSummary(
  members: readonly Pick<ManageableMember, "status">[],
  invitations: readonly Pick<
    ManageableInvitation,
    "deliveryState" | "deliveryActionRequired"
  >[],
  phase06?: PortalDashboardPhase06Input,
  phase07?: PortalDashboardPhase07Input,
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

  const summary: PortalDashboardSummary = {
    membershipCounts,
    actionRequiredInvitations: {
      failedPermanent,
      suppressed,
      addressSuppression: Math.max(0, total - failedPermanent - suppressed),
      total,
    },
  };

  if (!phase06 && !phase07) return summary;

  if (!phase06) {
    if (!phase07) return summary;
    return {
      ...summary,
      notificationHealth: buildNotificationHealthSummary(phase07),
    };
  }

  const phase06Summary: PortalDashboardSummary = {
    ...summary,
    completedResult: buildCompletedResultSummary(
      phase06.completedRound,
      phase06.officialResults,
    ),
    standingsSummary: buildStandingsSummary(
      phase06.standings,
      phase06.standingsResetDate,
    ),
  };

  return phase07
    ? {
        ...phase06Summary,
        notificationHealth: buildNotificationHealthSummary(phase07),
      }
    : phase06Summary;
}

function buildNotificationHealthSummary(
  phase07: PortalDashboardPhase07Input,
): PortalDashboardNotificationHealth {
  const { health } = phase07;
  return {
    queueDepth:
      health.outboxQueued + health.outboxProcessing + health.outboxRetryable,
    oldestQueuedAt: health.outboxOldestAt,
    emailFailures: health.emailFailedPermanent + health.emailSuppressed,
    emailBounceRate: health.emailBounceRate,
    emailComplaintRate: health.emailComplaintRate,
    pushFailures: health.pushFailedPermanent,
    pushInvalidTokenRate: health.pushInvalidTokenRate,
    receiptFailures: health.pushReceiptFailed,
    sampledAt: health.sampledAt,
  };
}

function buildCompletedResultSummary(
  round: PortalDashboardCompletedRoundInput | null,
  results: readonly PortalDashboardOfficialResultInput[],
): PortalDashboardCompletedResultSummary | null {
  if (!round) return null;

  const ranked = results.filter(
    (
      result,
    ): result is PortalDashboardOfficialResultInput & {
      competitionRank: number;
    } => result.competitionRank !== null,
  );
  const winnerRank = ranked.reduce<number | null>(
    (lowest, result) =>
      lowest === null || result.competitionRank < lowest
        ? result.competitionRank
        : lowest,
    null,
  );
  const winnerNames = winnerRank
    ? ranked
        .filter((result) => result.competitionRank === winnerRank)
        .map(displayName)
    : [];

  return {
    roundId: round.roundId,
    description: round.description,
    scheduledAt: round.scheduledAt,
    completedAt: results[0]?.completedAt ?? null,
    groupTimeZone: round.groupTimeZone,
    winnerNames,
    winnerRank,
    resultCount: results.length,
  };
}

function buildStandingsSummary(
  standings: readonly PortalDashboardStandingInput[],
  standingsResetDate: string | null,
): PortalDashboardStandingsSummary {
  const ranked = standings
    .filter(
      (
        standing,
      ): standing is PortalDashboardStandingInput & {
        standingRank: number;
      } => standing.standingRank !== null,
    )
    .toSorted((left, right) => left.standingRank - right.standingRank);
  const leader = ranked[0] ?? null;

  return {
    memberCount: standings.length,
    rankedMemberCount: ranked.length,
    standingsResetDate,
    leader: leader
      ? {
          membershipId: leader.membershipId,
          name: displayName(leader),
          meritTotal: leader.meritTotal,
          standingRank: leader.standingRank,
        }
      : null,
  };
}

function displayName(
  person: Readonly<{ firstName: string | null; lastName: string | null }>,
) {
  return (
    [person.firstName, person.lastName]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" ")
      .trim() || "Unnamed participant"
  );
}
