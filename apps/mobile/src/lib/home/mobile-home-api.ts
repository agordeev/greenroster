import {
  mobileMemberQuotaHistoryApi,
  mobileMemberStandingsApi,
  type MobileMemberQuotaHistoryResult,
  type MobileMemberStandingsResult,
} from "../rounds/mobile-member-results-api";
import {
  mobileOfficialResultsApi,
  type MobileOfficialResultsResult,
} from "../rounds/mobile-official-results-api";
import {
  mobileRoundsApi,
  type MobileRoundsResult,
} from "../rounds/mobile-rounds-api";

import {
  createMobileHomeProjection,
  createMobileHomeRecentResult,
  findMostRecentCompletedRound,
  type MobileHomeProjection,
} from "./mobile-home-presentation";

type HomeDependencies = Readonly<{
  quotaHistory: Pick<typeof mobileMemberQuotaHistoryApi, "read">;
  officialResults: Pick<typeof mobileOfficialResultsApi, "read">;
  rounds: Pick<typeof mobileRoundsApi, "list">;
  standings: Pick<typeof mobileMemberStandingsApi, "read">;
}>;

export type MobileHomeErrorCode =
  "permission_denied" | "validation" | "unavailable";

export type MobileHomeResult =
  | Readonly<{ ok: true; data: MobileHomeProjection }>
  | Readonly<{
      ok: false;
      code: MobileHomeErrorCode;
      message: string;
    }>;

type HomeReadResult =
  | MobileRoundsResult
  | MobileMemberStandingsResult
  | MobileMemberQuotaHistoryResult
  | MobileOfficialResultsResult;

function failureFrom(result: HomeReadResult): MobileHomeResult | null {
  if (result.ok) return null;
  return {
    code: result.code,
    message: result.message,
    ok: false,
  };
}

function safeFailure(): MobileHomeResult {
  return {
    code: "unavailable",
    message:
      "GreenRoster could not load Home. Check your connection and try again.",
    ok: false,
  };
}

export function createMobileHomeApi(
  dependencies: HomeDependencies = {
    quotaHistory: mobileMemberQuotaHistoryApi,
    officialResults: mobileOfficialResultsApi,
    rounds: mobileRoundsApi,
    standings: mobileMemberStandingsApi,
  },
) {
  return {
    async read(): Promise<MobileHomeResult> {
      try {
        const [roundsResult, standingsResult, quotaHistoryResult] =
          await Promise.all([
            dependencies.rounds.list({ completedLimit: 5 }),
            dependencies.standings.read(),
            dependencies.quotaHistory.read(),
          ]);

        for (const result of [
          roundsResult,
          standingsResult,
          quotaHistoryResult,
        ] as const) {
          const failure = failureFrom(result);
          if (failure) return failure;
        }

        if (!roundsResult.ok || !standingsResult.ok || !quotaHistoryResult.ok) {
          return safeFailure();
        }

        const recentRound = findMostRecentCompletedRound(roundsResult.data);
        let recentResult = null;
        if (recentRound) {
          const officialResult = await dependencies.officialResults.read(
            recentRound.roundId,
          );
          const failure = failureFrom(officialResult);
          if (failure) return failure;
          if (!officialResult.ok) return safeFailure();
          recentResult = createMobileHomeRecentResult(
            recentRound,
            officialResult.data,
          );
        }

        return {
          data: createMobileHomeProjection({
            quotaHistory: quotaHistoryResult.data,
            recentResult,
            rounds: roundsResult.data,
            standings: standingsResult.data,
          }),
          ok: true,
        };
      } catch {
        return safeFailure();
      }
    },
  };
}

export const mobileHomeApi = createMobileHomeApi();
