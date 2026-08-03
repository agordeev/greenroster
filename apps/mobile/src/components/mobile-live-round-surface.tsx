import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { mobileSupabase } from "@/lib/auth/mobile-supabase";
import {
  mobileLiveRoundApi,
  mobileScoreChangedFieldsSchema,
  type MobileLiveRoundParticipant,
  type MobileLiveRoundScore,
} from "@/lib/rounds/mobile-live-round-api";
import {
  mobileRoundsApi,
  type MobileRoundSummary,
} from "@/lib/rounds/mobile-rounds-api";
import {
  applyMobileLiveRoundScoreReceipt,
  createMobileLiveRoundState,
  markMobileLiveRoundFailed,
  markMobileLiveRoundPending,
  markMobileLiveRoundStale,
  mobileLiveRoundOrderIsDeferred,
  mobileLiveRoundVisibleOrder,
  replaceMobileLiveRoundSnapshot,
  type MobileLiveRoundPendingScore,
  type MobileLiveRoundState,
} from "@/lib/rounds/mobile-live-round-state";
import {
  createMobileLiveRoundRealtime,
  MobileLiveRoundRealtimeError,
} from "@/lib/rounds/mobile-live-round-realtime";
import { createMobileScoreQueue } from "@/lib/rounds/mobile-score-queue";
import { createMobileLiveRoundSnapshotStorage } from "@/lib/rounds/mobile-live-round-snapshot-storage";
import { createMobileOperationId } from "@/lib/mobile-operation-id";

type SurfaceMode = "scorecard" | "leaderboard";

export function MobileLiveRoundSurface({
  mode,
}: Readonly<{ mode: SurfaceMode }>) {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useMobileAuth();
  const params = useLocalSearchParams<{ roundId?: string | string[] }>();
  const requestedRoundId = Array.isArray(params.roundId)
    ? params.roundId[0]
    : params.roundId;
  const [rounds, setRounds] = useState<readonly MobileRoundSummary[]>([]);
  const [roundStatus, setRoundStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [roundMessage, setRoundMessage] = useState<string | null>(null);
  const [scoreState, setScoreState] = useState<MobileLiveRoundState | null>(
    null,
  );
  const [scoreStatus, setScoreStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [scoreMessage, setScoreMessage] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState("stopped");
  const roundRequestSequence = useRef(0);
  const scoreRequestSequence = useRef(0);
  const queue = useMemo(
    () => createMobileScoreQueue({ platform: Platform.OS }),
    [],
  );
  const snapshotStorage = useMemo(
    () => createMobileLiveRoundSnapshotStorage(),
    [],
  );

  const purgeRoundOfflineData = useCallback(
    async (scope: { userId: string; groupId: string; roundId: string }) => {
      await Promise.allSettled([
        queue.isSupported ? queue.clear(scope) : Promise.resolve(),
        snapshotStorage.clear(scope),
      ]);
    },
    [queue, snapshotStorage],
  );

  const purgeUserOfflineData = useCallback(
    async (userId: string) => {
      await Promise.allSettled([
        queue.isSupported ? queue.clearUser(userId) : Promise.resolve(),
        snapshotStorage.clearUser(userId),
      ]);
    },
    [queue, snapshotStorage],
  );

  const selectedRound = useMemo(
    () =>
      requestedRoundId
        ? (rounds.find((round) => round.roundId === requestedRoundId) ?? null)
        : null,
    [requestedRoundId, rounds],
  );
  const selectedLiveRoundId =
    selectedRound?.state === "live" ? selectedRound.roundId : null;

  const loadRounds = useCallback(async () => {
    if (!session?.user.id) return;
    const sequence = ++roundRequestSequence.current;
    setRoundStatus("loading");
    setRoundMessage(null);
    const result = await mobileRoundsApi.list();
    if (sequence !== roundRequestSequence.current) return;
    if (!result.ok) {
      if (result.code === "permission_denied") {
        await purgeUserOfflineData(session.user.id);
        setRounds([]);
        setRoundStatus("error");
        setRoundMessage(result.message);
        return;
      }
      if (queue.isSupported) {
        try {
          const cachedRounds = await snapshotStorage.listUser(session.user.id);
          if (cachedRounds.length > 0) {
            setRounds(cachedRounds.map((cached) => cached.round));
            setRoundStatus("ready");
            setRoundMessage(
              "Showing your last authorized rounds while GreenRoster reconnects.",
            );
            return;
          }
        } catch {
          // Fall through to the actionable network error below.
        }
      }
      setRoundStatus("error");
      setRoundMessage(result.message);
      return;
    }
    if (queue.isSupported) {
      try {
        const accessibleRounds = new Map(
          result.data.map((round) => [round.roundId, round]),
        );
        const cachedRounds = await snapshotStorage.listUser(session.user.id);
        await Promise.allSettled(
          cachedRounds.map(async (cached) => {
            const freshRound = accessibleRounds.get(cached.round.roundId);
            if (!freshRound) {
              await purgeRoundOfflineData(cached.scope);
              return;
            }
            if (freshRound.state !== "live") {
              await Promise.allSettled([
                queue.markRoundLocked(cached.scope),
                snapshotStorage.clear(cached.scope),
              ]);
            }
          }),
        );
      } catch {
        // Cache reconciliation is best effort; the fresh server list remains authoritative.
      }
    }
    setRounds(result.data);
    setRoundStatus("ready");
  }, [
    purgeRoundOfflineData,
    purgeUserOfflineData,
    queue,
    session,
    snapshotStorage,
  ]);

  useEffect(() => {
    queueMicrotask(() => void loadRounds());
  }, [loadRounds]);

  const openRound = useCallback(
    (roundId: string) => {
      const destination = mode === "leaderboard" ? "/leaderboard" : "/rounds";
      router.push(`${destination}?roundId=${encodeURIComponent(roundId)}`);
    },
    [mode, router],
  );

  const clearSelectedRound = useCallback(() => {
    router.replace(mode === "leaderboard" ? "/leaderboard" : "/rounds");
  }, [mode, router]);

  useEffect(() => {
    if (!selectedLiveRoundId || !selectedRound) return;
    const liveRoundId = selectedLiveRoundId;
    const selectedRoundSummary = selectedRound;
    let active = true;
    let realtime: ReturnType<typeof createMobileLiveRoundRealtime> | null =
      null;
    let lifecycleHandled = false;
    const sequence = ++scoreRequestSequence.current;
    queueMicrotask(() => {
      if (!active) return;
      setScoreStatus("loading");
      setScoreMessage(null);
      setRealtimeStatus("refetching");
    });

    async function syncSelectedRound() {
      const scope = session?.user.id
        ? {
            userId: session.user.id,
            groupId: selectedRoundSummary.groupId,
            roundId: liveRoundId,
          }
        : null;
      let cachedState: MobileLiveRoundState | null = null;
      if (scope && queue.isSupported) {
        try {
          const cached = await snapshotStorage.load(scope);
          if (cached && active) {
            cachedState = markMobileLiveRoundStale(
              createMobileLiveRoundState({
                participants: cached.participants,
                syncedAt: cached.savedAt,
              }),
            );
            const queued = await queue.list(scope);
            for (const item of queued) {
              if (item.status === "failed" && item.failure) {
                cachedState = markMobileLiveRoundFailed(
                  cachedState,
                  item.participantId,
                  {
                    code: item.failure.code,
                    message: item.failure.message,
                    currentScore: item.failure.currentScore ?? null,
                    permanent: true,
                  },
                );
              } else {
                cachedState = markMobileLiveRoundPending(cachedState, {
                  participantId: item.participantId,
                  baseVersion: item.baseVersion,
                  changedFields: item.payload,
                  deviceOperationId: item.deviceOperationId,
                  operationId: item.operationId,
                  correlationId: item.correlationId,
                  clientChangedAt: item.clientChangedAt,
                  queuedAt: item.queuedAt,
                });
              }
            }
            setScoreState(cachedState);
            setScoreStatus("ready");
            setScoreMessage(
              "Showing the last confirmed values while GreenRoster reconnects.",
            );
            setRealtimeStatus("stale");
          }
        } catch {
          // Durable cache is best effort; an authoritative read still decides access.
        }
      }
      const result = await mobileLiveRoundApi.read(liveRoundId);
      if (!active || sequence !== scoreRequestSequence.current) return;
      if (!result.ok) {
        if (scope && result.code === "permission_denied") {
          await purgeRoundOfflineData(scope);
          if (!active || sequence !== scoreRequestSequence.current) return;
          setScoreState(null);
          setScoreStatus("error");
          setScoreMessage(result.message);
          setRealtimeStatus("stale");
          setRounds((current) =>
            current.filter((round) => round.roundId !== liveRoundId),
          );
          clearSelectedRound();
          void loadRounds();
          return;
        }
        if (scope && result.code === "locked") {
          try {
            if (queue.isSupported) await queue.markRoundLocked(scope);
          } finally {
            if (!active || sequence !== scoreRequestSequence.current) return;
            setScoreState(null);
            setScoreStatus("error");
            setScoreMessage(result.message);
            setRealtimeStatus("stale");
            setRounds((current) =>
              current.filter((round) => round.roundId !== liveRoundId),
            );
            clearSelectedRound();
            void loadRounds();
          }
          return;
        }
        setScoreStatus(cachedState ? "ready" : "error");
        setScoreMessage(result.message);
        setRealtimeStatus("stale");
        return;
      }
      const initial = createMobileLiveRoundState({
        participants: result.data,
        syncedAt: new Date().toISOString(),
      });
      setScoreState(initial);
      setScoreStatus("ready");
      if (scope) {
        await snapshotStorage
          .save(scope, result.data, selectedRoundSummary)
          .catch(() => undefined);
      }

      const first = result.data[0];
      if (!first || !scope) {
        setRealtimeStatus("current");
        return;
      }
      realtime = createMobileLiveRoundRealtime({
        client: mobileSupabase,
        groupId: first.groupId,
        roundId: first.roundId,
        initialState: initial,
        refetch: async () => {
          const refreshed = await mobileLiveRoundApi.read(first.roundId);
          if (!refreshed.ok) {
            const errorCode =
              refreshed.code === "permission_denied"
                ? "permission_denied"
                : refreshed.code === "locked"
                  ? "locked"
                  : refreshed.code === "validation"
                    ? "validation"
                    : "unavailable";
            throw new MobileLiveRoundRealtimeError(
              errorCode,
              refreshed.message,
            );
          }
          await snapshotStorage
            .save(scope, refreshed.data, selectedRoundSummary)
            .catch(() => undefined);
          return {
            participants: refreshed.data,
            syncedAt: new Date().toISOString(),
          };
        },
        onChange: (view) => {
          if (!active) return;
          if (
            !lifecycleHandled &&
            (view.errorCode === "permission_denied" ||
              view.errorCode === "locked")
          ) {
            lifecycleHandled = true;
            setScoreState(null);
            setScoreStatus("error");
            setScoreMessage(view.error ?? "This round is no longer available.");
            setRealtimeStatus(view.status);
            void (async () => {
              try {
                if (scope) {
                  if (view.errorCode === "permission_denied") {
                    await purgeRoundOfflineData(scope);
                  } else if (queue.isSupported) {
                    await queue.markRoundLocked(scope);
                  }
                }
              } finally {
                if (!active) return;
                setRounds((current) =>
                  current.filter((round) => round.roundId !== liveRoundId),
                );
                clearSelectedRound();
                if (realtime) await realtime.stop();
                void loadRounds();
              }
            })();
            return;
          }
          setRealtimeStatus(view.status);
          if (view.state) setScoreState(view.state);
          if (view.error && view.status === "stale")
            setScoreMessage(view.error);
        },
      });
      await realtime.start();
      if (!active || lifecycleHandled) {
        await realtime.stop();
        return;
      }
      if (queue.isSupported) {
        const drained = await queue.drain(scope, (item) =>
          mobileLiveRoundApi.setScore(
            {
              participantId: item.participantId,
              changedFields: item.payload,
              expectedScoreVersion: item.baseVersion,
              deviceOperationId: item.deviceOperationId,
              clientChangedAt: item.clientChangedAt,
              reason: item.reason,
            },
            {
              correlationId: item.correlationId,
              operationId: item.operationId,
            },
          ),
        );
        if (drained.status === "permanent") {
          const failedItem = drained.item;
          const failure = failedItem?.failure;
          if (failedItem && failure) {
            setScoreState((current) =>
              current
                ? markMobileLiveRoundFailed(current, failedItem.participantId, {
                    code: failure.code,
                    message: failure.message,
                    currentScore: failure.currentScore ?? null,
                    permanent: true,
                  })
                : current,
            );
          }
          setScoreMessage(
            "A pending score needs your attention before it can sync.",
          );
        }
        if (drained.processed > 0 && active) {
          const refreshed = await mobileLiveRoundApi.read(first.roundId);
          if (refreshed.ok) {
            setScoreState((current) =>
              current
                ? replaceMobileLiveRoundSnapshot(current, {
                    participants: refreshed.data,
                    syncedAt: new Date().toISOString(),
                  })
                : createMobileLiveRoundState({
                    participants: refreshed.data,
                    syncedAt: new Date().toISOString(),
                  }),
            );
            await snapshotStorage
              .save(scope, refreshed.data, selectedRoundSummary)
              .catch(() => undefined);
          }
        }
      }
    }

    void syncSelectedRound();

    return () => {
      active = false;
      if (realtime) void realtime.stop();
    };
  }, [
    queue,
    clearSelectedRound,
    loadRounds,
    purgeRoundOfflineData,
    selectedLiveRoundId,
    selectedRound,
    session?.user.id,
    snapshotStorage,
    purgeUserOfflineData,
  ]);

  const liveRounds = rounds.filter((round) => round.state === "live");
  const upcomingRounds = rounds.filter((round) => round.state === "published");
  const completedRounds = rounds.filter((round) => round.state === "completed");
  const selectedScoreState =
    selectedLiveRoundId && scoreState?.roundId === selectedLiveRoundId
      ? scoreState
      : null;
  const visibleRoundCount =
    mode === "leaderboard" ? liveRounds.length : rounds.length;

  if (
    requestedRoundId &&
    selectedRound?.state === "live" &&
    selectedScoreState
  ) {
    return (
      <MemberDestinationScreen
        eyebrow={mode === "leaderboard" ? "Leaderboard" : "Scorecard"}
        title={selectedRound.description || "Live round"}
        introduction="Official values arrive from the server. Missing scores stay distinct from zero, and a reconnect marks the board stale until the authoritative snapshot returns."
        emptyTitle=""
        emptyBody=""
        hideEmptyState
        facts={[
          ["Round state", "Live"],
          ["Connection", formatRealtimeStatus(realtimeStatus)],
          ["Last synced", formatLastSynced(selectedScoreState.lastSyncedAt)],
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to rounds"
          onPress={clearSelectedRound}
          style={[styles.secondaryButton, { borderColor: theme.separator }]}
        >
          <ThemedText type="smallBold" themeColor="accent">
            Back to rounds
          </ThemedText>
        </Pressable>
        {scoreMessage && realtimeStatus === "stale" ? (
          <ThemedText
            themeColor="textSecondary"
            accessibilityLiveRegion="polite"
          >
            Refreshing confirmed values: {scoreMessage}
          </ThemedText>
        ) : null}
        {mode === "leaderboard" ? (
          <LiveLeaderboard state={selectedScoreState} theme={theme} />
        ) : (
          <LiveScorecard
            state={selectedScoreState}
            onChange={setScoreState}
            queue={queue}
            sessionId={session?.user.id ?? null}
          />
        )}
      </MemberDestinationScreen>
    );
  }

  return (
    <MemberDestinationScreen
      eyebrow={mode === "leaderboard" ? "Leaderboard" : "Rounds"}
      title={
        mode === "leaderboard"
          ? "Live standings when play begins"
          : "Upcoming, live, and completed"
      }
      introduction="Round state, RSVP context, participant counts, and server-confirmed score sync stay together."
      emptyTitle={
        roundStatus === "error"
          ? "Rounds could not be loaded"
          : mode === "leaderboard"
            ? "No live round yet"
            : "No rounds yet"
      }
      emptyBody={
        roundMessage ??
        (mode === "leaderboard"
          ? "Live standings will appear when your group starts playing."
          : "Published rounds will appear here after your group access is resolved.")
      }
      hideEmptyState={
        roundStatus === "loading" ||
        (roundStatus === "ready" && visibleRoundCount > 0)
      }
      facts={[
        ["Live", String(liveRounds.length)],
        ["Upcoming", String(upcomingRounds.length)],
        ["Completed", String(completedRounds.length)],
      ]}
    >
      {roundStatus === "loading" ? (
        <ActivityIndicator
          color={theme.accent}
          accessibilityLabel="Loading rounds"
        />
      ) : null}
      {mode === "leaderboard" && liveRounds.length === 0 ? (
        <ThemedText themeColor="textSecondary">
          No round is Live right now.
        </ThemedText>
      ) : null}
      {requestedRoundId &&
      selectedRound?.state === "live" &&
      !selectedScoreState ? (
        <ThemedText themeColor="textSecondary" accessibilityLiveRegion="polite">
          {scoreStatus === "error"
            ? "The live score projection is unavailable. Try again."
            : "Loading the confirmed live score projection…"}
        </ThemedText>
      ) : null}
      <RoundSection
        title="Live"
        rounds={liveRounds}
        onOpen={openRound}
        theme={theme}
        interactive
      />
      {mode === "scorecard" ? (
        <RoundSection
          title="Upcoming"
          rounds={upcomingRounds}
          onOpen={openRound}
          theme={theme}
          interactive={false}
        />
      ) : null}
      {mode === "scorecard" ? (
        <RoundSection
          title="Completed"
          rounds={completedRounds}
          onOpen={openRound}
          theme={theme}
          interactive={false}
        />
      ) : null}
      {roundStatus === "error" ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void loadRounds()}
          style={[styles.secondaryButton, { borderColor: theme.separator }]}
        >
          <ThemedText type="smallBold" themeColor="accent">
            Retry rounds
          </ThemedText>
        </Pressable>
      ) : null}
    </MemberDestinationScreen>
  );
}

function RoundSection({
  title,
  rounds,
  onOpen,
  theme,
  interactive,
}: Readonly<{
  title: string;
  rounds: readonly MobileRoundSummary[];
  onOpen: (roundId: string) => void;
  theme: ReturnType<typeof useTheme>;
  interactive: boolean;
}>) {
  if (rounds.length === 0) return null;
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      {rounds.map((round) => (
        <RoundRow
          key={round.roundId}
          round={round}
          theme={theme}
          interactive={interactive}
          onOpen={onOpen}
        />
      ))}
    </View>
  );
}

function RoundRow({
  round,
  theme,
  interactive,
  onOpen,
}: Readonly<{
  round: MobileRoundSummary;
  theme: ReturnType<typeof useTheme>;
  interactive: boolean;
  onOpen: (roundId: string) => void;
}>) {
  const content = (
    <>
      <View style={styles.roundCopy}>
        <ThemedText type="smallBold">
          {round.description || "Untitled round"}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatRoundMeta(round)}
        </ThemedText>
      </View>
      <View style={styles.roundMeta}>
        <ThemedText
          type="smallBold"
          themeColor={round.state === "live" ? "accent" : "textSecondary"}
        >
          {formatState(round.state)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {round.participantStatus === "playing"
            ? "Playing"
            : formatRsvp(round.participantStatus)}
        </ThemedText>
      </View>
    </>
  );
  const rowStyle = [
    styles.roundRow,
    {
      borderColor: theme.separator,
      backgroundColor: theme.backgroundElement,
    },
  ];
  if (!interactive) return <View style={rowStyle}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${round.description || "round"}`}
      onPress={() => onOpen(round.roundId)}
      style={({ pressed }) => [...rowStyle, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function LiveLeaderboard({
  state,
  theme,
}: Readonly<{
  state: MobileLiveRoundState;
  theme: ReturnType<typeof useTheme>;
}>) {
  const serverOrder = useMemo(
    () => state.participants.map((entry) => entry.participant.participantId),
    [state.participants],
  );
  const [deferredOrder, setDeferredOrder] = useState<readonly string[] | null>(
    null,
  );

  const participantsById = useMemo(
    () =>
      new Map(
        state.participants.map((entry) => [
          entry.participant.participantId,
          entry,
        ]),
      ),
    [state.participants],
  );
  const visibleOrder = useMemo(() => {
    return mobileLiveRoundVisibleOrder(serverOrder, deferredOrder);
  }, [deferredOrder, serverOrder]);
  const visibleParticipants = visibleOrder
    .map((participantId) => participantsById.get(participantId))
    .filter(
      (entry): entry is MobileLiveRoundState["participants"][number] =>
        entry !== undefined,
    );
  const orderDeferred = mobileLiveRoundOrderIsDeferred(
    serverOrder,
    visibleOrder,
    deferredOrder,
  );

  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={styles.sectionTitle}>
        Confirmed leaderboard
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Server ordering is authoritative. Ties are not broken alphabetically.
      </ThemedText>
      {orderDeferred ? (
        <View style={styles.staleNotice} accessibilityLiveRegion="polite">
          <ThemedText type="small" themeColor="textSecondary">
            Standings updated. The focused row stays in place until you review.
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Review updated standings"
            onPress={() => {
              setDeferredOrder(null);
            }}
            style={[styles.secondaryButton, { borderColor: theme.separator }]}
          >
            <ThemedText type="smallBold" themeColor="accent">
              Review updated standings
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
      {visibleParticipants.map((entry) => (
        <View
          key={entry.participant.participantId}
          accessible
          focusable
          accessibilityRole="text"
          accessibilityLabel={`${participantName(entry.participant)}, ${formatScore(entry.confirmed.golfPoints)} points, ${formatSigned(entry.confirmed.plusMinus)}`}
          onFocus={() => setDeferredOrder((current) => current ?? serverOrder)}
          style={styles.scoreRow}
        >
          <View style={styles.roundCopy}>
            <ThemedText type="smallBold">
              {participantName(entry.participant)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {entry.participant.participantKind === "guest" ? "Guest · " : ""}
              {formatScoreState(entry)}
            </ThemedText>
          </View>
          <View style={styles.roundMeta}>
            <ThemedText type="smallBold">
              {formatScore(entry.confirmed.golfPoints)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatSigned(entry.confirmed.plusMinus)}
            </ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}

function LiveScorecard({
  state,
  onChange,
  queue,
  sessionId,
}: Readonly<{
  state: MobileLiveRoundState;
  onChange: Dispatch<SetStateAction<MobileLiveRoundState | null>>;
  queue: ReturnType<typeof createMobileScoreQueue>;
  sessionId: string | null;
}>) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={styles.sectionTitle}>
        Scorecard
      </ThemedText>
      {state.participants.map((entry) => (
        <MobileScoreEditor
          key={`${entry.participant.participantId}:${entry.confirmed.version}`}
          entry={entry}
          onChange={onChange}
          queue={queue}
          sessionId={sessionId}
        />
      ))}
    </View>
  );
}

function MobileScoreEditor({
  entry,
  onChange,
  queue,
  sessionId,
}: Readonly<{
  entry: MobileLiveRoundState["participants"][number];
  onChange: Dispatch<SetStateAction<MobileLiveRoundState | null>>;
  queue: ReturnType<typeof createMobileScoreQueue>;
  sessionId: string | null;
}>) {
  const theme = useTheme();
  const participant = entry.participant;
  const [draft, setDraft] = useState(() => ({
    golf_points: participant.score.golfPoints ?? "",
    gross_score: participant.score.grossScore ?? "",
    net_score: participant.score.netScore ?? "",
    manual_merit: participant.score.manualMerit ?? "",
  }));
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const enabledFields = [
    participant.enabledFields.golfPoints ? "golf_points" : null,
    participant.enabledFields.grossScore ? "gross_score" : null,
    participant.enabledFields.netScore ? "net_score" : null,
    participant.canAuthorManualMerit ? "manual_merit" : null,
  ].filter((value): value is keyof typeof draft => value !== null);
  const locked = participant.rsvpStatus !== "playing" || !participant.canEdit;
  const typedPlusMinus = previewPlusMinus(participant, draft.golf_points);

  async function save() {
    if (busy || locked || !sessionId) return;
    const changedFields: Record<string, number | null> = {};
    for (const field of enabledFields) {
      const raw = draft[field].trim();
      const value = raw === "" ? null : Number(raw);
      const current = scoreValue(entry.confirmed, field);
      if (value !== null && !Number.isFinite(value)) {
        setMessage("Enter a valid number before saving.");
        return;
      }
      if (!sameNumber(value, current)) changedFields[field] = value;
    }
    const parsedFields =
      mobileScoreChangedFieldsSchema.safeParse(changedFields);
    if (!parsedFields.success) {
      setMessage("Enter a valid enabled score value before saving.");
      return;
    }
    if (Object.keys(changedFields).length === 0) {
      setMessage("Change at least one value before saving.");
      return;
    }
    const correctionNeeded = Object.keys(changedFields).some(
      (field) =>
        scoreValue(entry.confirmed, field as keyof typeof draft) !== null,
    );
    if (correctionNeeded && !reason.trim()) {
      setMessage("Add a reason when replacing a confirmed value.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const deviceOperationId = createMobileOperationId();
    const operationId = createMobileOperationId();
    const correlationId = createMobileOperationId();
    const input = {
      participantId: participant.participantId,
      changedFields: parsedFields.data,
      expectedScoreVersion: entry.confirmed.version,
      deviceOperationId,
      clientChangedAt: new Date().toISOString(),
      reason: reason.trim() || null,
    } as const;
    const result = await mobileLiveRoundApi.setScore(input, {
      correlationId,
      operationId,
    });
    if (result.ok) {
      onChange((current) =>
        current
          ? applyMobileLiveRoundScoreReceipt(current, result.data)
          : current,
      );
      setReason("");
      setMessage("Score confirmed by the server.");
      setBusy(false);
      return;
    }
    if (result.code === "unavailable") {
      const pending: MobileLiveRoundPendingScore = {
        participantId: participant.participantId,
        baseVersion: entry.confirmed.version,
        changedFields: parsedFields.data,
        deviceOperationId,
        operationId,
        correlationId,
        clientChangedAt: input.clientChangedAt,
        queuedAt: new Date().toISOString(),
      };
      await queue.enqueue({
        userId: sessionId,
        groupId: participant.groupId,
        roundId: participant.roundId,
        participantId: pending.participantId,
        baseVersion: pending.baseVersion,
        deviceOperationId,
        operationId,
        correlationId,
        payload: parsedFields.data,
        reason: input.reason,
        clientChangedAt: pending.clientChangedAt,
      });
      onChange((current) =>
        current ? markMobileLiveRoundPending(current, pending) : current,
      );
      setMessage("Pending sync — this score is not official yet.");
    } else {
      onChange((current) =>
        current
          ? markMobileLiveRoundFailed(current, participant.participantId, {
              code: result.code,
              message: result.message,
              currentScore: result.details?.currentScore ?? null,
              permanent: true,
            })
          : current,
      );
      setMessage(result.message);
    }
    setBusy(false);
  }

  return (
    <View style={[styles.editor, { borderColor: theme.separator }]}>
      <View style={styles.roundCopy}>
        <ThemedText type="smallBold">{participantName(participant)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {participant.participantKind === "guest" ? "Guest · " : ""}
          {formatScoreState(entry)}
        </ThemedText>
      </View>
      {enabledFields.map((field) => (
        <View key={field} style={styles.inputGroup}>
          <ThemedText type="small" themeColor="textSecondary">
            {fieldLabel(field)}
          </ThemedText>
          <TextInput
            accessibilityLabel={`${fieldLabel(field)} for ${participantName(participant)}`}
            editable={!locked && !busy}
            keyboardType="decimal-pad"
            placeholder="Missing"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.input,
              { borderColor: theme.separator, color: theme.text },
            ]}
            value={draft[field]}
            onChangeText={(value) =>
              setDraft((current) => ({ ...current, [field]: value }))
            }
          />
        </View>
      ))}
      {entry.staleCurrentValue ? (
        <View style={styles.staleNotice} accessibilityRole="alert">
          <ThemedText type="smallBold">Current server values</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatCurrentScore(entry.staleCurrentValue)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Re-enter the intended value; nothing was overwritten.
          </ThemedText>
        </View>
      ) : null}
      {entry.confirmed.version > 0 && !locked ? (
        <View style={styles.inputGroup}>
          <ThemedText type="small" themeColor="textSecondary">
            Correction reason
          </ThemedText>
          <TextInput
            accessibilityLabel="Correction reason"
            editable={!busy}
            multiline
            maxLength={500}
            style={[
              styles.input,
              styles.reasonInput,
              { borderColor: theme.separator, color: theme.text },
            ]}
            value={reason}
            onChangeText={setReason}
          />
        </View>
      ) : null}
      <View style={styles.confirmedRow}>
        <ThemedText type="small" themeColor="textSecondary">
          Plus/minus
        </ThemedText>
        <ThemedText type="smallBold">
          {formatSigned(entry.confirmed.plusMinus)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatScoreState(entry)}
        </ThemedText>
      </View>
      <View style={styles.confirmedRow}>
        <ThemedText type="small" themeColor="textSecondary">
          Typed points preview
        </ThemedText>
        <ThemedText type="smallBold">{formatSigned(typedPlusMinus)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Preview only
        </ThemedText>
      </View>
      {message ? (
        <ThemedText
          themeColor={entry.syncState === "Failed" ? "accent" : "textSecondary"}
          accessibilityLiveRegion="polite"
        >
          {message}
        </ThemedText>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: locked || busy }}
        disabled={locked || busy}
        onPress={() => void save()}
        style={[
          styles.primaryButton,
          { backgroundColor: theme.accent },
          (locked || busy) && styles.disabled,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={theme.background} />
        ) : (
          <ThemedText type="smallBold" style={{ color: theme.background }}>
            Save score
          </ThemedText>
        )}
      </Pressable>
    </View>
  );
}

function scoreValue(
  score: MobileLiveRoundScore,
  field: keyof MobileLiveRoundScoreDraft,
): string | null {
  switch (field) {
    case "golf_points":
      return score.golfPoints;
    case "gross_score":
      return score.grossScore;
    case "net_score":
      return score.netScore;
    case "manual_merit":
      return score.manualMerit;
  }
}

function fieldLabel(field: keyof MobileLiveRoundScoreDraft) {
  return field === "golf_points"
    ? "Golf points"
    : field === "gross_score"
      ? "Gross score"
      : field === "net_score"
        ? "Net score"
        : "Manual merit";
}

function previewPlusMinus(
  participant: MobileLiveRoundParticipant,
  rawPoints: string,
) {
  if (!rawPoints.trim() || participant.quotaSnapshot === null) return null;
  const points = Number(rawPoints);
  const quota = Number(participant.quotaSnapshot);
  if (!Number.isFinite(points) || !Number.isFinite(quota)) return null;
  return (points - quota).toFixed(2);
}

type MobileLiveRoundScoreDraft = {
  golf_points: string;
  gross_score: string;
  net_score: string;
  manual_merit: string;
};

function sameNumber(next: number | null, current: string | null) {
  if (next === null) return current === null;
  return current !== null && Number(current) === next;
}

function participantName(participant: MobileLiveRoundParticipant) {
  return (
    [participant.firstName, participant.lastName].filter(Boolean).join(" ") ||
    "Unnamed participant"
  );
}

function formatScore(value: string | null) {
  return value === null ? "Missing" : value;
}

function formatSigned(value: string | null) {
  if (value === null) return "Missing";
  return Number(value) > 0 ? `+${value}` : value;
}

function formatCurrentScore(score: MobileLiveRoundScore) {
  return [
    `Points ${formatScore(score.golfPoints)}`,
    `Gross ${formatScore(score.grossScore)}`,
    `Net ${formatScore(score.netScore)}`,
    `Plus/minus ${formatSigned(score.plusMinus)}`,
  ].join(" · ");
}

function formatScoreState(entry: MobileLiveRoundState["participants"][number]) {
  return entry.syncState;
}

function formatState(state: MobileRoundSummary["state"]) {
  return state === "live"
    ? "Live"
    : state === "published"
      ? "Published"
      : state === "completed"
        ? "Completed"
        : "Cancelled";
}

function formatRsvp(status: MobileRoundSummary["participantStatus"]) {
  return status === "not_playing"
    ? "Not playing"
    : status === "no_response"
      ? "No response"
      : "Playing";
}

function formatRoundMeta(round: MobileRoundSummary) {
  const date = round.scheduledAt ? new Date(round.scheduledAt) : null;
  const when =
    date && !Number.isNaN(date.valueOf())
      ? new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date)
      : "Time not set";
  return `${when} · ${round.format === "individual_net" ? "Individual Net" : "Individual Gross"}${round.venue ? ` · ${round.venue}` : ""}`;
}

function formatRealtimeStatus(status: string) {
  return status === "current"
    ? "Connected"
    : status === "locked"
      ? "Round locked"
      : status === "permission_denied"
        ? "Access unavailable"
        : status === "stopped"
          ? "Stopped"
          : status === "refetching"
            ? "Refreshing"
            : "Stale — refreshing";
}

function formatLastSynced(value: string | null) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Recently"
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  sectionTitle: { fontSize: 24, lineHeight: 32 },
  roundRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  roundCopy: { flex: 1, gap: Spacing.one },
  roundMeta: { alignItems: "flex-end", gap: Spacing.one },
  scoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(128,128,128,0.24)",
  },
  editor: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  staleNotice: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderWidth: 1,
    borderColor: "#b85c38",
    borderRadius: Spacing.two,
  },
  inputGroup: { gap: Spacing.one },
  input: {
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
    fontSize: 16,
  },
  reasonInput: { minHeight: 72, textAlignVertical: "top" },
  confirmedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
  },
  secondaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.58 },
});
