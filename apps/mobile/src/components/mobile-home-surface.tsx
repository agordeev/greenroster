import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { GroupDirectoryLink } from "@/components/group-directory-link";
import { ThemedText } from "@/components/themed-text";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { mobileHomeApi } from "@/lib/home/mobile-home-api";
import {
  formatMobileHomeParticipantName,
  type MobileHomeProjection,
} from "@/lib/home/mobile-home-presentation";
import type { MobileOfficialRoundResult } from "@/lib/rounds/mobile-official-results-api";
import type { MobileRoundSummary } from "@/lib/rounds/mobile-rounds-api";

type HomeStatus = "loading" | "ready" | "error" | "permission";

export function MobileHomeSurface() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useMobileAuth();
  const sessionUserId = session?.user.id ?? null;
  const requestSequence = useRef(0);
  const [status, setStatus] = useState<HomeStatus>("loading");
  const [projection, setProjection] = useState<MobileHomeProjection | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (!sessionUserId) {
      setProjection(null);
      setMessage(
        "Sign in with your person-specific account to load member-safe Home data.",
      );
      setStatus("permission");
      return;
    }

    setStatus("loading");
    setMessage(null);
    const result = await mobileHomeApi.read();
    if (sequence !== requestSequence.current) return;
    if (!result.ok) {
      setProjection(null);
      setMessage(result.message);
      setStatus(result.code === "permission_denied" ? "permission" : "error");
      return;
    }
    setProjection(result.data);
    setStatus("ready");
  }, [sessionUserId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load().catch(() => {
        setProjection(null);
        setStatus("error");
        setMessage(
          "GreenRoster could not load Home. Check your connection and try again.",
        );
      });
    });
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  const isLoading = status === "loading";
  const isError = status === "error" || status === "permission";
  const hasContent = Boolean(
    projection &&
    (projection.liveRounds.length > 0 ||
      projection.nextRound ||
      projection.recentResult ||
      projection.standings.length > 0 ||
      projection.quotaHistory.length > 0),
  );

  return (
    <MemberDestinationScreen
      eyebrow="Home"
      title={projection?.groupName ?? "Your GreenRoster home"}
      introduction="Confirmed member-safe rounds, official results, and your current quota and standings summary in priority order."
      emptyTitle={
        isError
          ? status === "permission"
            ? "Home access unavailable"
            : "Home unavailable"
          : "No Home activity yet"
      }
      emptyBody={
        message ??
        "Your next published round, live play, and official result history will appear here when available."
      }
      hideEmptyState={isLoading || (status === "ready" && hasContent)}
      facts={[
        [
          "Live rounds",
          status === "ready" ? String(projection?.liveRounds.length ?? 0) : "—",
        ],
        [
          "Current quota",
          status === "ready"
            ? (projection?.ownStanding?.projectedQuota ?? "Not available")
            : "—",
        ],
        [
          "Standing",
          status === "ready"
            ? formatStanding(projection?.ownStanding?.standingRank ?? null)
            : "—",
        ],
      ]}
    >
      {isLoading ? (
        <ActivityIndicator
          color={theme.accent}
          accessibilityLabel="Loading Home"
        />
      ) : null}

      {isError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry Home"
          onPress={() => void load()}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: theme.separator },
            pressed && styles.pressed,
          ]}
        >
          <ThemedText type="smallBold" themeColor="accent">
            Retry Home
          </ThemedText>
        </Pressable>
      ) : null}

      {status === "ready" && projection ? (
        <HomeContent projection={projection} router={router} theme={theme} />
      ) : null}
    </MemberDestinationScreen>
  );
}

function HomeContent({
  projection,
  router,
  theme,
}: Readonly<{
  projection: MobileHomeProjection;
  router: ReturnType<typeof useRouter>;
  theme: ReturnType<typeof useTheme>;
}>) {
  const recentResult = projection.recentResult;
  return (
    <>
      {projection.liveRounds.length > 0 ? (
        <View style={styles.section} accessibilityLabel="Live rounds">
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Live now
          </ThemedText>
          {projection.liveRounds.map((round) => (
            <LiveRoundCard
              key={round.roundId}
              round={round}
              onOpenScorecard={() =>
                router.push(
                  `/rounds?roundId=${encodeURIComponent(round.roundId)}`,
                )
              }
              onOpenLeaderboard={() =>
                router.push(
                  `/leaderboard?roundId=${encodeURIComponent(round.roundId)}`,
                )
              }
              onOpenMessages={() =>
                router.push(
                  `/round-messages?roundId=${encodeURIComponent(round.roundId)}` as never,
                )
              }
              theme={theme}
            />
          ))}
        </View>
      ) : null}

      {projection.nextRound ? (
        <NextRoundCard
          round={projection.nextRound}
          onOpen={() =>
            router.push(
              `/rounds?roundId=${encodeURIComponent(projection.nextRound?.roundId ?? "")}`,
            )
          }
          theme={theme}
        />
      ) : null}

      {recentResult ? (
        <RecentResultCard
          recentResult={recentResult}
          onOpen={() =>
            router.push(
              `/rounds?roundId=${encodeURIComponent(recentResult.round.roundId)}`,
            )
          }
          theme={theme}
        />
      ) : null}

      <QuotaStandingCard
        projection={projection}
        // Expo's generated typed-route manifest omits this intentionally
        // hidden tab route, although the export emits `/standings`.
        onOpen={() => router.push("/standings" as never)}
        theme={theme}
      />

      <GroupDirectoryLink />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open your clubhouse"
        onPress={() => router.push("/clubhouse" as never)}
        style={({ pressed }) => [
          styles.secondaryButton,
          { borderColor: theme.separator },
          pressed && styles.pressed,
        ]}
      >
        <ThemedText type="smallBold" themeColor="accent">
          Open your clubhouse
        </ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open your round updates"
        onPress={() => router.push("/inbox" as never)}
        style={({ pressed }) => [
          styles.secondaryButton,
          { borderColor: theme.separator },
          pressed && styles.pressed,
        ]}
      >
        <ThemedText type="smallBold" themeColor="accent">
          Open your round updates
        </ThemedText>
      </Pressable>
    </>
  );
}

function LiveRoundCard({
  onOpenLeaderboard,
  onOpenMessages,
  onOpenScorecard,
  round,
  theme,
}: Readonly<{
  onOpenLeaderboard: () => void;
  onOpenMessages: () => void;
  onOpenScorecard: () => void;
  round: MobileRoundSummary;
  theme: ReturnType<typeof useTheme>;
}>) {
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${round.description || "Live round"}, Live, ${formatParticipantStatus(round.participantStatus)}, ${round.playingCount} playing participants`}
      style={[styles.card, { borderColor: theme.separator }]}
    >
      <View style={styles.cardHeading}>
        <View style={styles.cardCopy}>
          <ThemedText type="subtitle" style={styles.cardTitle}>
            {round.description || "Live round"}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Live · {formatParticipantStatus(round.participantStatus)} ·{" "}
            {round.playingCount} playing
          </ThemedText>
        </View>
        <ThemedText type="smallBold" themeColor="accent">
          Live
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {formatRoundMeta(round)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Leaderboard updated{" "}
        {formatInstant(round.updatedAt, round.groupTimeZone)}
      </ThemedText>
      <View style={styles.buttonRow}>
        <HomeButton
          label="Open scorecard"
          onPress={onOpenScorecard}
          theme={theme}
        />
        <HomeButton
          label="Open messages"
          onPress={onOpenMessages}
          theme={theme}
        />
        <HomeButton
          label="Open leaderboard"
          onPress={onOpenLeaderboard}
          theme={theme}
        />
      </View>
    </View>
  );
}

function NextRoundCard({
  onOpen,
  round,
  theme,
}: Readonly<{
  onOpen: () => void;
  round: MobileRoundSummary;
  theme: ReturnType<typeof useTheme>;
}>) {
  return (
    <View style={[styles.card, { borderColor: theme.separator }]}>
      <ThemedText type="smallBold" themeColor="accent">
        NEXT ROUND
      </ThemedText>
      <ThemedText type="subtitle" style={styles.cardTitle}>
        {round.description || "Published round"}
      </ThemedText>
      <View style={styles.detailList}>
        <Detail label="When" value={formatRoundDateTime(round)} />
        <Detail label="Venue" value={round.venue || "Venue to be announced"} />
        <Detail label="Format" value={formatRoundFormat(round.format)} />
        <Detail
          label="RSVP"
          value={`${formatParticipantStatus(round.participantStatus)} · ${round.participantCount} participants`}
        />
      </View>
      <HomeButton label="Open round details" onPress={onOpen} theme={theme} />
    </View>
  );
}

function RecentResultCard({
  onOpen,
  recentResult,
  theme,
}: Readonly<{
  onOpen: () => void;
  recentResult: NonNullable<MobileHomeProjection["recentResult"]>;
  theme: ReturnType<typeof useTheme>;
}>) {
  const winnerText = recentResult.winnerRows.length
    ? recentResult.winnerRows
        .map((result) => formatMobileHomeParticipantName(result))
        .join(" · ")
    : "Winner summary not available";
  const winnerValue = recentResult.winnerRows[0]
    ? formatResultCriterionValue(
        recentResult.winnerRows[0],
        recentResult.rankingCriterion,
      )
    : null;

  return (
    <View style={[styles.card, { borderColor: theme.separator }]}>
      <ThemedText type="smallBold" themeColor="accent">
        RECENT RESULT
      </ThemedText>
      <ThemedText type="subtitle" style={styles.cardTitle}>
        {recentResult.round.description || "Completed round"}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Official result · Ranked by {recentResult.rankingCriterion}
      </ThemedText>
      <View style={styles.resultSummary} accessible accessibilityRole="summary">
        <ThemedText type="smallBold">{winnerText}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {winnerValue
            ? `Winner${recentResult.winnerRows.length > 1 ? "s" : ""} · ${recentResult.rankingCriterion} ${winnerValue}`
            : "Open the official result for the full published ranking."}
        </ThemedText>
      </View>
      <HomeButton
        label="Open official results"
        onPress={onOpen}
        theme={theme}
      />
    </View>
  );
}

function QuotaStandingCard({
  onOpen,
  projection,
  theme,
}: Readonly<{
  onOpen: () => void;
  projection: MobileHomeProjection;
  theme: ReturnType<typeof useTheme>;
}>) {
  const own = projection.ownStanding;
  const hasHistory = projection.quotaHistory.length > 0;
  return (
    <View style={[styles.card, { borderColor: theme.separator }]}>
      <ThemedText type="smallBold" themeColor="accent">
        YOUR QUOTA & STANDING
      </ThemedText>
      {own ? (
        <View style={styles.summaryGrid}>
          <SummaryValue
            label="Current quota"
            value={own.projectedQuota ?? "Not available"}
          />
          <SummaryValue label="Merit total" value={own.meritTotal} />
          <SummaryValue
            label="Order of Merit"
            value={formatStanding(own.standingRank)}
          />
          <SummaryValue
            label="Rounds counted"
            value={String(own.roundsPlayed)}
          />
        </View>
      ) : (
        <ThemedText themeColor="textSecondary">
          {hasHistory
            ? "Your current standing is not available yet; official quota history is retained."
            : "No official quota or standing history is available yet."}
        </ThemedText>
      )}
      {own && !own.quotaProjectionReady ? (
        <ThemedText type="small" themeColor="textSecondary">
          Current quota needs more eligible official history.
        </ThemedText>
      ) : null}
      <HomeButton
        label="Open standings and history"
        onPress={onOpen}
        theme={theme}
      />
    </View>
  );
}

function SummaryValue({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <View style={styles.summaryValue}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

function HomeButton({
  label,
  onPress,
  theme,
}: Readonly<{
  label: string;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        { borderColor: theme.separator },
        pressed && styles.pressed,
      ]}
    >
      <ThemedText type="smallBold" themeColor="accent">
        {label}
      </ThemedText>
    </Pressable>
  );
}

function Detail({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={styles.detailRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={styles.detailValue}>
        {value}
      </ThemedText>
    </View>
  );
}

function formatStanding(rank: number | null) {
  return rank === null ? "Not ranked" : `#${rank}`;
}

function formatParticipantStatus(
  status: MobileRoundSummary["participantStatus"],
) {
  switch (status) {
    case "playing":
      return "Playing";
    case "not_playing":
      return "Not Playing";
    default:
      return "No response";
  }
}

function formatRoundFormat(format: MobileRoundSummary["format"]) {
  return format === "individual_net" ? "Individual Net" : "Individual Gross";
}

function formatRoundMeta(round: MobileRoundSummary) {
  return `${formatRoundDateTime(round)} · ${formatRoundFormat(round.format)}`;
}

function formatRoundDateTime(round: MobileRoundSummary) {
  if (!round.scheduledAt)
    return `Time to be announced (${round.groupTimeZone})`;
  try {
    return `${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: round.groupTimeZone,
    }).format(new Date(round.scheduledAt))} (${round.groupTimeZone})`;
  } catch {
    return `${new Date(round.scheduledAt).toLocaleString()} (${round.groupTimeZone})`;
  }
}

function formatInstant(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

function formatResultCriterionValue(
  result: MobileOfficialRoundResult,
  criterion: "Plus/minus" | "Golf points",
) {
  const value =
    criterion === "Plus/minus" ? result.plusMinus : result.golfPoints;
  return value ?? "Not available";
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  sectionTitle: { marginBottom: Spacing.one },
  card: {
    gap: Spacing.three,
    padding: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  cardHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  cardCopy: { flex: 1, gap: Spacing.half },
  cardTitle: { fontSize: 24, lineHeight: 32 },
  detailList: { gap: Spacing.two },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  detailValue: { flex: 1, textAlign: "right" },
  resultSummary: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.three,
  },
  summaryValue: { minWidth: 120, flexGrow: 1, gap: Spacing.half },
  buttonRow: { gap: Spacing.two },
  secondaryButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Spacing.three,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
  },
  pressed: { opacity: 0.72 },
});
