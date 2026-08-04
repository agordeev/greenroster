import type {
  MobileMemberQuotaHistory,
  MobileMemberStanding,
} from "../rounds/mobile-member-results-api";
import type { MobileOfficialRoundResult } from "../rounds/mobile-official-results-api";
import type { MobileRoundSummary } from "../rounds/mobile-rounds-api";

export type MobileHomeRecentResult = Readonly<{
  round: MobileRoundSummary;
  results: readonly MobileOfficialRoundResult[];
  winnerRows: readonly MobileOfficialRoundResult[];
  rankingCriterion: "Plus/minus" | "Golf points";
}>;

export type MobileHomeProjection = Readonly<{
  groupName: string | null;
  groupTimeZone: string | null;
  liveRounds: readonly MobileRoundSummary[];
  nextRound: MobileRoundSummary | null;
  recentResult: MobileHomeRecentResult | null;
  standings: readonly MobileMemberStanding[];
  quotaHistory: readonly MobileMemberQuotaHistory[];
  ownStanding: MobileMemberStanding | null;
}>;

type CreateProjectionInput = Readonly<{
  rounds: readonly MobileRoundSummary[];
  standings: readonly MobileMemberStanding[];
  quotaHistory: readonly MobileMemberQuotaHistory[];
  recentResult: MobileHomeRecentResult | null;
}>;

function timestamp(value: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function scheduledTimestamp(round: MobileRoundSummary) {
  return timestamp(round.scheduledAt);
}

function compareRoundStart(
  left: MobileRoundSummary,
  right: MobileRoundSummary,
) {
  const leftTime = scheduledTimestamp(left);
  const rightTime = scheduledTimestamp(right);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.roundId.localeCompare(right.roundId);
}

/**
 * Build the member-safe Home projection from already-authorized API payloads.
 * The server remains authoritative for lifecycle, ranking, and quota values;
 * this function only chooses which confirmed rows to present first.
 */
export function createMobileHomeProjection({
  quotaHistory,
  recentResult,
  rounds,
  standings,
}: CreateProjectionInput): MobileHomeProjection {
  const liveRounds = rounds
    .filter((round) => round.state === "live")
    .sort((left, right) => {
      if (
        left.participantStatus === "playing" &&
        right.participantStatus !== "playing"
      ) {
        return -1;
      }
      if (
        left.participantStatus !== "playing" &&
        right.participantStatus === "playing"
      ) {
        return 1;
      }
      return compareRoundStart(left, right);
    });

  const nextRound =
    rounds
      .filter((round) => round.state === "published")
      .sort(compareRoundStart)[0] ?? null;

  const context = standings[0] ?? quotaHistory[0] ?? null;
  return {
    groupName: context?.groupName ?? null,
    groupTimeZone: context?.groupTimeZone ?? null,
    liveRounds,
    nextRound,
    ownStanding: standings.find((row) => row.isActor) ?? null,
    quotaHistory,
    recentResult,
    standings,
  };
}

export function findMostRecentCompletedRound(
  rounds: readonly MobileRoundSummary[],
) {
  return (
    rounds
      .filter((round) => round.state === "completed")
      .sort((left, right) => {
        const updated = timestamp(right.updatedAt) - timestamp(left.updatedAt);
        if (updated !== 0) return updated;
        return compareRoundStart(right, left);
      })[0] ?? null
  );
}

export function rankingCriterionForRound(
  format: MobileRoundSummary["format"],
): MobileHomeRecentResult["rankingCriterion"] {
  return format === "individual_net" ? "Plus/minus" : "Golf points";
}

export function createMobileHomeRecentResult(
  round: MobileRoundSummary,
  results: readonly MobileOfficialRoundResult[],
): MobileHomeRecentResult {
  return {
    rankingCriterion: rankingCriterionForRound(round.format),
    results,
    round,
    winnerRows: results.filter((result) => result.competitionRank === 1),
  };
}

export function formatMobileHomeParticipantName(
  result: Pick<MobileOfficialRoundResult, "firstName" | "lastName">,
) {
  const name = [result.firstName, result.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.trim())
    .join(" ");
  return name || "Unnamed player";
}
