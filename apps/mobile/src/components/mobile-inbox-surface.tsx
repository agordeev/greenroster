import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { ThemedText } from "@/components/themed-text";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  mobileMemberInboxApi,
  type MobileMemberInboxItem,
} from "@/lib/notifications/mobile-member-inbox-api";

type InboxStatus = "loading" | "ready" | "error" | "permission";

export function MobileInboxSurface() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useMobileAuth();
  const sessionUserId = session?.user.id ?? null;
  const requestSequence = useRef(0);
  const [status, setStatus] = useState<InboxStatus>("loading");
  const [items, setItems] = useState<readonly MobileMemberInboxItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (!sessionUserId) {
      setItems([]);
      setMessage("Sign in to see your round updates.");
      setStatus("permission");
      return;
    }
    setStatus("loading");
    setMessage(null);
    const result = await mobileMemberInboxApi.read();
    if (sequence !== requestSequence.current) return;
    if (!result.ok) {
      setItems([]);
      setMessage(result.message);
      setStatus(result.code === "permission_denied" ? "permission" : "error");
      return;
    }
    setItems(result.data);
    setStatus("ready");
  }, [sessionUserId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load().catch(() => {
        setStatus("error");
        setMessage("You can't load your round updates right now. Try again.");
      });
    });
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  const isLoading = status === "loading";
  const isError = status === "error" || status === "permission";

  return (
    <MemberDestinationScreen
      eyebrow="Inbox"
      title="Your round updates"
      introduction="You open updates from your coordinators and administrators here."
      emptyTitle={
        isError
          ? status === "permission"
            ? "You can't open your round updates"
            : "You can't load your round updates"
          : "You have no round updates yet"
      }
      emptyBody={
        message ?? "You see new updates here when your group posts them."
      }
      hideEmptyState={isLoading || (status === "ready" && items.length > 0)}
      facts={[
        [
          "Unread updates",
          status === "ready"
            ? String(items.filter((item) => !item.readAt).length)
            : "—",
        ],
        ["Updates", status === "ready" ? String(items.length) : "—"],
      ]}
    >
      {isLoading ? (
        <ActivityIndicator
          color={theme.accent}
          accessibilityLabel="Loading your round updates"
        />
      ) : null}
      {isError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry round updates"
          onPress={() => void load()}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: theme.separator },
            pressed && styles.pressed,
          ]}
        >
          <ThemedText type="smallBold" themeColor="accent">
            Retry round updates
          </ThemedText>
        </Pressable>
      ) : null}
      {status === "ready"
        ? items.map((item) => (
            <InboxCard
              key={item.inboxItemId}
              item={item}
              theme={theme}
              onRead={async () => {
                if (item.readAt) return;
                const result = await mobileMemberInboxApi.markRead(
                  item.inboxItemId,
                );
                if (!result.ok) {
                  setMessage(result.message);
                  return;
                }
                setItems((current) =>
                  current.map((currentItem) =>
                    currentItem.inboxItemId === item.inboxItemId
                      ? { ...currentItem, readAt: result.data.readAt }
                      : currentItem,
                  ),
                );
              }}
              onOpenRound={() =>
                router.push(
                  `/rounds?roundId=${encodeURIComponent(item.roundId)}`,
                )
              }
            />
          ))
        : null}
    </MemberDestinationScreen>
  );
}

function InboxCard({
  item,
  onOpenRound,
  onRead,
  theme,
}: Readonly<{
  item: MobileMemberInboxItem;
  onOpenRound: () => void;
  onRead: () => Promise<void>;
  theme: ReturnType<typeof useTheme>;
}>) {
  return (
    <View
      style={[
        styles.card,
        { borderColor: item.readAt ? theme.separator : theme.accent },
      ]}
    >
      <View style={styles.heading}>
        <ThemedText type="subtitle">
          {item.roundDescription ?? "Your round"}
        </ThemedText>
        <ThemedText type="smallBold" themeColor="accent">
          {item.readAt ? "Read" : "New"}
        </ThemedText>
      </View>
      <ThemedText style={styles.body}>{item.body}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {item.authorDisplayName} · {formatRole(item.authorRole)} ·{" "}
        {formatDate(item.createdAt)}
      </ThemedText>
      <View style={styles.actions}>
        {!item.readAt ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mark update as read"
            onPress={() => void onRead()}
            style={({ pressed }) => [
              styles.secondaryButton,
              { borderColor: theme.separator },
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold" themeColor="accent">
              Mark as read
            </ThemedText>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open round"
          onPress={onOpenRound}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: theme.separator },
            pressed && styles.pressed,
          ]}
        >
          <ThemedText type="smallBold" themeColor="accent">
            Open round
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRole(role: MobileMemberInboxItem["authorRole"]) {
  return role === "administrator"
    ? "Administrator"
    : role === "coordinator"
      ? "Coordinator"
      : "Member";
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  heading: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  body: {
    lineHeight: 24,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  pressed: {
    opacity: 0.72,
  },
});
