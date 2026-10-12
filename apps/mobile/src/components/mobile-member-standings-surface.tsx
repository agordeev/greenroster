import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { ThemedText } from "@/components/themed-text";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  mobileMemberQuotaHistoryApi,
  mobileMemberStandingsApi,
  type MobileMemberQuotaHistory,
  type MobileMemberStanding,
} from "@/lib/rounds/mobile-member-results-api";

type ReadStatus = "loading" | "ready" | "error";

export function MobileMemberStandingsSurface() {
  const theme = useTheme();
  const { session } = useMobileAuth();
  const sessionUserId = session?.user.id ?? null;
  const requestSequence = useRef(0);
  const [status, setStatus] = useState<ReadStatus>("loading");
  const [standings, setStandings] = useState<readonly MobileMemberStanding[]>(
    [],
  );
  const [history, setHistory] = useState<readonly MobileMemberQuotaHistory[]>(
    [],
  );
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (!sessionUserId) {
      setStandings([]);
      setHistory([]);
      setMessage(null);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    setMessage(null);
    const [standingsResult, historyResult] = await Promise.all([
      mobileMemberStandingsApi.read(),
      mobileMemberQuotaHistoryApi.read(),
    ]);
    if (sequence !== requestSequence.current) return;
    if (!standingsResult.ok || !historyResult.ok) {
      setStandings([]);
      setHistory([]);
      setStatus("error");
      setMessage(
        !standingsResult.ok
          ? standingsResult.message
          : !historyResult.ok
            ? historyResult.message
            : "We couldn't load your standings and history.",
      );
      return;
    }
    setStandings(standingsResult.data);
    setHistory(historyResult.data);
    setStatus("ready");
  }, [sessionUserId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load().catch(() => {
        setStatus("error");
        setMessage(
          "We couldn't load your standings and history. Check your connection and try again.",
        );
      });
    });
  }, [load, sessionUserId]);

  const own = standings.find((row) => row.isActor) ?? null;
  const context = standings[0] ?? history[0] ?? null;
  const hasRows = standings.length > 0 || history.length > 0;
  const isLoading = status === "loading";
  const isError = status === "error";

  return (
    <MemberDestinationScreen
      eyebrow="Standings"
      title={context?.groupName ?? "Your standings and history"}
      introduction="Where you stand and your official quota history. The reset date changes current standings only. Your history stays."
      emptyTitle={
        isError ? "Standings and history unavailable" : "No standings yet"
      }
      emptyBody={
        message ??
        "Standings appear once your group finishes an official round."
      }
      hideEmptyState={isLoading || (status === "ready" && hasRows)}
      facts={[
        ["Members", status === "ready" ? String(standings.length) : "—"],
        ["Official rounds", status === "ready" ? String(history.length) : "—"],
        ["Reset date", formatResetDate(context?.standingsResetDate ?? null)],
      ]}
    >
      {isLoading ? (
        <ActivityIndicator
          color={theme.accent}
          accessibilityLabel="Loading standings and quota history"
        />
      ) : null}

      {isError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry standings and quota history"
          onPress={() => void load()}
          style={[styles.secondaryButton, { borderColor: theme.separator }]}
        >
          <ThemedText type="smallBold" themeColor="accent">
            Retry standings
          </ThemedText>
        </Pressable>
      ) : null}

      {status === "ready" && own ? (
        <View
          accessible
          accessibilityRole="summary"
          accessibilityLabel={formatOwnSummaryLabel(own)}
          style={[styles.summaryCard, { borderColor: theme.separator }]}
        >
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Your summary
          </ThemedText>
          <View style={styles.summaryGrid}>
            <SummaryValue label="Current quota" value={own.projectedQuota} />
            <SummaryValue label="Merit total" value={own.meritTotal} />
            <SummaryValue
              label="Order of Merit rank"
              value={
                own.standingRank === null
                  ? "Not ranked"
                  : `#${own.standingRank}`
              }
            />
            <SummaryValue
              label="Rounds played"
              value={String(own.roundsPlayed)}
            />
          </View>
          {!own.quotaProjectionReady ? (
            <ThemedText type="small" themeColor="textSecondary">
              Your current quota needs more counted rounds.
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      {status === "ready" && standings.length === 0 && history.length > 0 ? (
        <ThemedText themeColor="textSecondary" accessibilityLiveRegion="polite">
          No members are ranked for Order of Merit yet.
        </ThemedText>
      ) : null}

      {status === "ready" && standings.length > 0 ? (
        <StandingsList standings={standings} theme={theme} />
      ) : null}

      {status === "ready" && history.length > 0 ? (
        <QuotaHistoryList history={history} theme={theme} />
      ) : null}
    </MemberDestinationScreen>
  );
}

function SummaryValue({
  label,
  value,
}: Readonly<{ label: string; value: string | null }>) {
  return (
    <View style={styles.summaryValue}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value ?? "Not available"}</ThemedText>
    </View>
  );
}

function StandingsList({
  standings,
  theme,
}: Readonly<{
  standings: readonly MobileMemberStanding[];
  theme: ReturnType<typeof useTheme>;
}>) {
  return (
    <View style={styles.section} accessibilityLabel="Current Order of Merit">
      <ThemedText type="subtitle" style={styles.sectionTitle}>
        Order of Merit
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Quota is a projection and can change.
      </ThemedText>
      {standings.map((row) => (
        <View
          key={row.membershipId}
          accessible
          accessibilityRole="text"
          accessibilityLabel={formatStandingLabel(row)}
          style={[styles.listRow, { borderColor: theme.separator }]}
        >
          <View style={styles.rowCopy}>
            <ThemedText type="smallBold">
              {row.isActor ? "You" : formatMemberName(row)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {row.standingRank === null
                ? "Not ranked"
                : `Rank #${row.standingRank}`}{" "}
              · {row.roundsPlayed} rounds
            </ThemedText>
          </View>
          <View style={styles.rowMeta}>
            <ThemedText type="smallBold">{row.meritTotal} merit</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Quota {row.projectedQuota ?? "Not available"}
            </ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}

function QuotaHistoryList({
  history,
  theme,
}: Readonly<{
  history: readonly MobileMemberQuotaHistory[];
  theme: ReturnType<typeof useTheme>;
}>) {
  return (
    <View style={styles.section} accessibilityLabel="Your quota history">
      <ThemedText type="subtitle" style={styles.sectionTitle}>
        Quota history
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Only official rounds count. Reopened rounds do not count.
      </ThemedText>
      {history.map((row) => (
        <View
          key={row.historyId}
          accessible
          accessibilityRole="text"
          accessibilityLabel={formatHistoryLabel(row)}
          style={[styles.listRow, { borderColor: theme.separator }]}
        >
          <View style={styles.rowCopy}>
            <ThemedText type="smallBold">
              {row.roundDescription || "Completed round"}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatCompletedAt(row.completedAt, row.groupTimeZone)} ·{" "}
              {formatMethod(row.method)}
            </ThemedText>
          </View>
          <View style={styles.rowMeta}>
            <ThemedText type="smallBold">{row.pointTotal} points</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Quota {row.quotaAfter}
              {row.countsInStandings
                ? " · In current standings"
                : " · Not in current standings"}
            </ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}

function formatMemberName(row: MobileMemberStanding) {
  return (
    [row.firstName, row.lastName]
      .filter((part): part is string => Boolean(part))
      .join(" ")
      .trim() || "Unnamed player"
  );
}

function formatStandingLabel(row: MobileMemberStanding) {
  return `${row.isActor ? "You" : formatMemberName(row)}, ${
    row.standingRank === null ? "not ranked" : `rank ${row.standingRank}`
  }, ${row.meritTotal} merit points, ${row.roundsPlayed} rounds`;
}

function formatOwnSummaryLabel(row: MobileMemberStanding) {
  return `Your summary, ${row.meritTotal} merit points, ${
    row.standingRank === null ? "not ranked" : `rank ${row.standingRank}`
  }, ${row.roundsPlayed} rounds played, quota ${row.projectedQuota ?? "not available"}`;
}

function formatHistoryLabel(row: MobileMemberQuotaHistory) {
  return `${row.roundDescription || "Completed round"}, ${row.pointTotal} points, quota after ${row.quotaAfter}, ${row.countsInStandings ? "in current standings" : "not in current standings"}`;
}

function formatMethod(method: MobileMemberQuotaHistory["method"]) {
  switch (method) {
    case "best_10_of_20":
      return "Best 10 of 20";
    case "previous_plus_minus":
      return "Previous plus/minus";
    default:
      return "Moving average";
  }
}

function formatResetDate(value: string | null) {
  if (!value) return "None";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
      new Date(`${value}T00:00:00Z`),
    );
  } catch {
    return value;
  }
}

function formatCompletedAt(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeZone,
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleDateString();
  }
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.three,
  },
  sectionTitle: {
    marginBottom: Spacing.one,
  },
  summaryCard: {
    gap: Spacing.three,
    padding: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.three,
  },
  summaryValue: {
    minWidth: 130,
    flexGrow: 1,
    gap: Spacing.half,
  },
  listRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
  },
  rowCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  rowMeta: {
    alignItems: "flex-end",
    gap: Spacing.half,
  },
  secondaryButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Spacing.three,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
  },
});
