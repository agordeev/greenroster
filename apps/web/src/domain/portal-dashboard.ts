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

export function buildPortalDashboardSummary(
  members: readonly Pick<ManageableMember, "status">[],
  invitations: readonly Pick<
    ManageableInvitation,
    "deliveryState" | "deliveryActionRequired"
  >[],
  phase06?: PortalDashboardPhase06Input,
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

  if (!phase06) return summary;

  return {
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
