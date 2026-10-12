import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { ThemedText } from "@/components/themed-text";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { createMobileOperationId } from "@/lib/mobile-operation-id";
import {
  mobileRoundsApi,
  type MobileRoundDetail,
  type MobileRoundRsvpStatus,
  type MobileRoundSummary,
} from "@/lib/rounds/mobile-rounds-api";
import {
  applyMobileRoundRsvpReceipt,
  createMobileRoundDetailState,
  markMobileRoundRsvpFailed,
  markMobileRoundRsvpPending,
  type MobileRoundDetailState,
} from "@/lib/rounds/mobile-round-state";

export function MobileUpcomingRoundSurface({
  round,
  onBack,
}: Readonly<{
  round: MobileRoundSummary;
  onBack: () => void;
}>) {
  const theme = useTheme();
  const { session } = useMobileAuth();
  const [detail, setDetail] = useState<MobileRoundDetailState | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setStatus("loading");
    setMessage(null);
    const result = await mobileRoundsApi.readDetail(round.roundId);
    if (!result.ok) {
      setDetail(null);
      setStatus("error");
      setMessage(result.message);
      return;
    }
    setDetail(createMobileRoundDetailState(result.data));
    setStatus("ready");
  }, [round.roundId]);

  useEffect(() => {
    let active = true;
    void mobileRoundsApi.readDetail(round.roundId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setDetail(null);
        setStatus("error");
        setMessage(result.message);
        return;
      }
      setDetail(createMobileRoundDetailState(result.data));
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [round.roundId]);

  async function changeRsvp(nextStatus: MobileRoundRsvpStatus) {
    if (!detail || detail.syncState === "Pending") return;
    if (
      detail.confirmedStatus === nextStatus &&
      detail.syncState !== "Failed"
    ) {
      return;
    }
    if (detail.confirmedVersion === null || !session?.user.id) {
      setMessage(
        "Your RSVP can't be changed right now. Refresh and try again.",
      );
      return;
    }
    setDetail((current) =>
      current ? markMobileRoundRsvpPending(current, nextStatus) : current,
    );
    setMessage(null);
    const result = await mobileRoundsApi.setRsvp(
      {
        roundId: round.roundId,
        rsvpStatus: nextStatus,
        expectedParticipantVersion: detail.confirmedVersion,
      },
      {
        correlationId: createMobileOperationId(),
        operationId: createMobileOperationId(),
      },
    );
    if (result.ok) {
      setDetail((current) =>
        current ? applyMobileRoundRsvpReceipt(current, result.data) : current,
      );
      setMessage("Your RSVP is saved.");
      return;
    }
    setDetail((current) =>
      current ? markMobileRoundRsvpFailed(current, result.message) : current,
    );
    setMessage(
      result.code === "unavailable"
        ? "Your answer wasn't sent. Check your connection and try again."
        : result.message,
    );
  }

  const selected = detail?.detail ?? null;
  const displayStatus = detail?.pendingStatus ?? detail?.confirmedStatus;
  const canRespond = Boolean(
    selected &&
    selected.state === "published" &&
    detail?.confirmedVersion !== null &&
    detail?.confirmedVersion !== undefined,
  );

  return (
    <MemberDestinationScreen
      eyebrow="Upcoming round"
      title={selected?.description || round.description || "Round details"}
      introduction="Check the round details, then choose Playing or Not Playing. Your answer shows as saved once it goes through."
      emptyTitle={status === "error" ? "Round detail unavailable" : ""}
      emptyBody={message ?? "Loading this round."}
      hideEmptyState={status !== "error"}
      facts={[
        [
          "Status",
          selected ? formatState(selected.state) : formatState(round.state),
        ],
        [
          "RSVP",
          selected ? formatRsvp(displayStatus ?? "no_response") : "Loading",
        ],
        [
          "Players",
          selected
            ? `${selected.playingCount} of ${selected.participantCount} playing`
            : "Loading",
        ],
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

      {status === "loading" ? (
        <ActivityIndicator
          color={theme.accent}
          accessibilityLabel="Loading round detail"
        />
      ) : null}

      {status === "error" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: false }}
          onPress={() => void loadDetail()}
          style={[styles.secondaryButton, { borderColor: theme.separator }]}
        >
          <ThemedText type="smallBold" themeColor="accent">
            Retry round detail
          </ThemedText>
        </Pressable>
      ) : null}

      {selected ? (
        <View style={styles.section}>
          <View style={styles.detailCard}>
            <DetailRow
              label="When"
              value={formatDate(selected.scheduledAt, selected.groupTimeZone)}
            />
            <DetailRow label="Group time zone" value={selected.groupTimeZone} />
            <DetailRow label="Venue" value={selected.venue ?? "Not provided"} />
            <DetailRow label="Format" value={formatFormat(selected.format)} />
            <DetailRow
              label="RSVP deadline"
              value={
                selected.rsvpDeadlineAt
                  ? formatDate(selected.rsvpDeadlineAt, selected.groupTimeZone)
                  : "Before the round starts"
              }
            />
            <DetailRow
              label="Your response changed"
              value={
                selected.rsvpChangedAt
                  ? formatDate(selected.rsvpChangedAt, selected.groupTimeZone)
                  : "Not yet"
              }
            />
          </View>

          {selected.notes ? (
            <View style={styles.notes}>
              <ThemedText type="smallBold">Notes</ThemedText>
              <ThemedText themeColor="textSecondary">
                {selected.notes}
              </ThemedText>
            </View>
          ) : null}

          <View style={styles.rsvpSection}>
            <ThemedText type="subtitle">Your RSVP</ThemedText>
            <ThemedText themeColor="textSecondary">
              Saved answer:{" "}
              {formatRsvp(detail?.confirmedStatus ?? "no_response")}
              {detail?.confirmedChangedAt
                ? ` · changed ${formatDate(detail.confirmedChangedAt, selected.groupTimeZone)}`
                : ""}
            </ThemedText>
            {detail?.pendingStatus ? (
              <ThemedText
                themeColor="textSecondary"
                accessibilityLiveRegion="polite"
              >
                Sending {formatRsvp(detail.pendingStatus)}…
              </ThemedText>
            ) : null}
            {detail?.failure ? (
              <ThemedText themeColor="accent" accessibilityRole="alert">
                {detail.failure}
              </ThemedText>
            ) : null}
            {!canRespond ? (
              <ThemedText themeColor="textSecondary">
                RSVP is closed for this round.
              </ThemedText>
            ) : (
              <View style={styles.rsvpButtons}>
                <RsvpButton
                  label="Playing"
                  selected={displayStatus === "playing"}
                  busy={detail?.syncState === "Pending"}
                  theme={theme}
                  onPress={() => void changeRsvp("playing")}
                />
                <RsvpButton
                  label="Not Playing"
                  selected={displayStatus === "not_playing"}
                  busy={detail?.syncState === "Pending"}
                  theme={theme}
                  onPress={() => void changeRsvp("not_playing")}
                />
              </View>
            )}
          </View>
        </View>
      ) : null}
    </MemberDestinationScreen>
  );
}

function RsvpButton({
  label,
  selected,
  busy,
  theme,
  onPress,
}: Readonly<{
  label: string;
  selected: boolean;
  busy: boolean;
  theme: ReturnType<typeof useTheme>;
  onPress: () => void;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`RSVP ${label}`}
      accessibilityState={{ busy, disabled: busy, selected }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.rsvpButton,
        {
          backgroundColor: selected ? theme.accent : theme.backgroundElement,
          borderColor: theme.accent,
        },
        pressed && styles.pressed,
        busy && styles.disabled,
      ]}
    >
      {busy && selected ? (
        <ActivityIndicator color={theme.background} />
      ) : (
        <ThemedText
          type="smallBold"
          style={{ color: selected ? theme.background : theme.accent }}
        >
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

function DetailRow({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
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

function formatDate(value: string | null, timeZone: string) {
  if (!value) return "Time not set";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Time not set";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

function formatState(state: MobileRoundSummary["state"]) {
  return state === "published"
    ? "Published"
    : state === "live"
      ? "Live"
      : state === "completed"
        ? "Completed"
        : state === "cancelled"
          ? "Cancelled"
          : "Draft";
}

function formatRsvp(status: MobileRoundRsvpStatus | "no_response" | undefined) {
  return status === "playing"
    ? "Playing"
    : status === "not_playing"
      ? "Not Playing"
      : "No response";
}

function formatFormat(format: MobileRoundDetail["format"]) {
  return format === "individual_net" ? "Individual Net" : "Individual Gross";
}

const styles = StyleSheet.create({
  section: { gap: Spacing.four },
  detailCard: {
    gap: Spacing.three,
    padding: Spacing.four,
    borderWidth: 1,
    borderColor: "rgba(128,128,128,0.24)",
    borderRadius: Spacing.two,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: Spacing.three,
  },
  detailValue: { flex: 1, textAlign: "right" },
  notes: {
    gap: Spacing.one,
    padding: Spacing.four,
    borderLeftWidth: 3,
    borderLeftColor: "#4b8f68",
  },
  rsvpSection: { gap: Spacing.two },
  rsvpButtons: { flexDirection: "row", gap: Spacing.two },
  rsvpButton: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
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
