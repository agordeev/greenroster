import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  mobileOfficialResultsApi,
  type MobileOfficialRoundResult,
} from "@/lib/rounds/mobile-official-results-api";
import type { MobileRoundSummary } from "@/lib/rounds/mobile-rounds-api";
import {
  buildOfficialResultAccessibilityLabel,
  formatParticipantName,
  formatRsvp,
  formatRsvpChangedAt,
  formatValue,
  OFFICIAL_RESULTS_REFRESH_INTERVAL_MS,
} from "@/lib/rounds/mobile-official-result-presentation";

export function MobileOfficialRoundResultSurface({
  round,
  onBack,
}: Readonly<{
  round: MobileRoundSummary;
  onBack: () => void;
}>) {
  const theme = useTheme();
  const requestSequence = useRef(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [results, setResults] = useState<readonly MobileOfficialRoundResult[]>(
    [],
  );
  const [message, setMessage] = useState<string | null>(null);

  const loadResults = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setStatus("loading");
    setMessage(null);
    const result = await mobileOfficialResultsApi.read(round.roundId);
    if (sequence !== requestSequence.current) return;
    if (!result.ok) {
      setResults([]);
      setStatus("error");
      setMessage(result.message);
      return;
    }
    setResults(result.data);
    setStatus("ready");
  }, [round.roundId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadResults();
    });
    return () => {
      active = false;
      requestSequence.current += 1;
    };
  }, [loadResults]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadResults();
    });
    return () => subscription.remove();
  }, [loadResults]);

  useEffect(() => {
    const interval = setInterval(
      () => void loadResults(),
      OFFICIAL_RESULTS_REFRESH_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, [loadResults]);

  const publishedAt = results[0]?.completedAt ?? null;
  const isLoading = status === "loading";
  const isError = status === "error";

  return (
    <MemberDestinationScreen
      eyebrow="Results"
      title={round.description || "Official round results"}
      introduction="These are the official results for this round. Reopened rounds stay hidden until they're officially completed again."
      emptyTitle={isError ? "Official results unavailable" : ""}
      emptyBody={message ?? ""}
      hideEmptyState={!isError}
      facts={[
        [
          "Status",
          status === "ready"
            ? "Official"
            : isError
              ? "Unavailable"
              : "Checking",
        ],
        ["Format", formatRoundFormat(round.format)],
        [
          "Published",
          publishedAt
            ? formatPublicationTime(publishedAt, round.groupTimeZone)
            : isLoading
              ? "Loading"
              : "Not available",
        ],
        ["Players", status === "ready" ? String(results.length) : "—"],
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to rounds"
        onPress={onBack}
        style={[styles.secondaryButton, { borderColor: theme.separator }]}
      >
        <ThemedText type="smallBold" themeColor="accent">
          Back to rounds
        </ThemedText>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh official results"
        disabled={isLoading}
        onPress={() => void loadResults()}
        style={[styles.secondaryButton, { borderColor: theme.separator }]}
      >
        <ThemedText type="smallBold" themeColor="accent">
          {isLoading ? "Refreshing…" : "Refresh results"}
        </ThemedText>
      </Pressable>

      {isLoading ? (
        <ActivityIndicator
          color={theme.accent}
          accessibilityLabel="Loading official results"
        />
      ) : null}

      {status === "ready" && results.length === 0 ? (
        <ThemedText themeColor="textSecondary" accessibilityLiveRegion="polite">
          No official results for this round yet.
        </ThemedText>
      ) : null}

      {status === "ready" && results.length > 0 ? (
        <OfficialResultList
          format={round.format}
          groupTimeZone={round.groupTimeZone}
          results={results}
          theme={theme}
        />
      ) : null}

      {isError ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void loadResults()}
          style={[styles.secondaryButton, { borderColor: theme.separator }]}
        >
          <ThemedText type="smallBold" themeColor="accent">
            Retry results
          </ThemedText>
        </Pressable>
      ) : null}
    </MemberDestinationScreen>
  );
}

function OfficialResultList({
  format,
  groupTimeZone,
  results,
  theme,
}: Readonly<{
  format: MobileRoundSummary["format"];
  groupTimeZone: string;
  results: readonly MobileOfficialRoundResult[];
  theme: ReturnType<typeof useTheme>;
}>) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={styles.sectionTitle}>
        Official results
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Published {formatPublicationTime(results[0].completedAt, groupTimeZone)}
        .
      </ThemedText>
      {results.map((result) => (
        <OfficialResultRow
          key={result.participantId}
          format={format}
          groupTimeZone={groupTimeZone}
          result={result}
          theme={theme}
        />
      ))}
    </View>
  );
}

function OfficialResultRow({
  format,
  groupTimeZone,
  result,
  theme,
}: Readonly<{
  format: MobileRoundSummary["format"];
  groupTimeZone: string;
  result: MobileOfficialRoundResult;
  theme: ReturnType<typeof useTheme>;
}>) {
  const displayName = formatParticipantName(result);
  const primaryLabel = format === "individual_net" ? "Plus/minus" : "Points";
  const primaryValue =
    format === "individual_net" ? result.plusMinus : result.golfPoints;
  const rank =
    result.competitionRank === null ? "Unranked" : `#${result.competitionRank}`;

  return (
    <View
      accessible
      focusable
      accessibilityRole="text"
      accessibilityLabel={buildOfficialResultAccessibilityLabel(
        format,
        groupTimeZone,
        result,
      )}
      style={[styles.resultRow, { borderColor: theme.separator }]}
    >
      <View style={styles.resultHeading}>
        <View style={styles.resultCopy}>
          <ThemedText type="smallBold">{displayName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {result.participantKind === "guest" ? "Guest · " : ""}
            {formatRsvp(result.rsvpStatus)} ·{" "}
            {formatRsvpChangedAt(result.rsvpChangedAt, groupTimeZone)}
          </ThemedText>
        </View>
        <View style={styles.resultMeta}>
          <ThemedText type="smallBold">{rank}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {primaryLabel} {formatValue(primaryValue)}
          </ThemedText>
        </View>
      </View>
      <View style={styles.resultFacts}>
        <ThemedText type="small" themeColor="textSecondary">
          Points {formatValue(result.golfPoints)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Gross {formatValue(result.grossScore)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Net {formatValue(result.netScore)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Quota {formatValue(result.quotaSnapshot)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Plus/minus {formatValue(result.plusMinus)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Participation {formatValue(result.participationMerit)} · Placement{" "}
          {formatValue(result.placementMerit)} · Manual{" "}
          {formatValue(result.manualMerit)}
          {" · "}Total {formatValue(result.totalMerit)}
        </ThemedText>
      </View>
    </View>
  );
}

function formatRoundFormat(format: MobileRoundSummary["format"]) {
  return format === "individual_net" ? "Individual Net" : "Individual Gross";
}

function formatPublicationTime(value: string, timeZone: string) {
  try {
    return `${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(value))} (${timeZone})`;
  } catch {
    return new Date(value).toLocaleString();
  }
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.three,
  },
  sectionTitle: {
    marginBottom: Spacing.one,
  },
  secondaryButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Spacing.three,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
  },
  resultRow: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
  },
  resultHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  resultCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  resultMeta: {
    alignItems: "flex-end",
    gap: Spacing.half,
  },
  resultFacts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
});
