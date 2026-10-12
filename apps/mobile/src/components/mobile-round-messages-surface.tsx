import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  mobileClubhouseApi,
  type MobileRoundMessage,
} from "@/lib/clubhouse/mobile-clubhouse-api";

export function MobileRoundMessagesSurface() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ roundId?: string }>();
  const roundId = typeof params.roundId === "string" ? params.roundId : "";
  const [messages, setMessages] = useState<readonly MobileRoundMessage[]>([]);
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!roundId) {
      setFeedback("Open messages from one of your rounds.");
      setLoading(false);
      return;
    }
    const result = await mobileClubhouseApi.readRoundMessages(roundId);
    if (!result.ok) setFeedback(result.message);
    else setMessages(result.data);
    setLoading(false);
  }, [roundId]);
  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);
  return (
    <MemberDestinationScreen
      eyebrow="Round conversation"
      title="Messages for this round"
      introduction="Read and post messages with the people in this round."
      emptyTitle={
        feedback ? "You can't open round messages" : "You have no messages yet"
      }
      emptyBody={feedback || "Your round messages appear here."}
      hideEmptyState={loading || messages.length > 0}
      facts={[["Messages", loading ? "—" : String(messages.length)]]}
    >
      {loading ? (
        <ActivityIndicator
          color={theme.accent}
          accessibilityLabel="Loading round messages"
        />
      ) : null}
      {messages.map((message) => (
        <View
          key={message.messageId}
          style={[styles.card, { borderColor: theme.separator }]}
        >
          <ThemedText>{message.body ?? "This message was removed."}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {message.authorDisplayName}
          </ThemedText>
        </View>
      ))}
      {roundId ? (
        <>
          <TextInput
            accessibilityLabel="Write a round message"
            multiline
            maxLength={300}
            value={body}
            onChangeText={setBody}
            placeholder="Write a message"
            style={[
              styles.input,
              { borderColor: theme.separator, color: theme.text },
            ]}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {300 - body.length} characters left.
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={!body.trim()}
            onPress={async () => {
              const result = await mobileClubhouseApi.postRoundMessage(
                roundId,
                body,
              );
              setFeedback(
                result.ok ? "You posted your message." : result.message,
              );
              if (result.ok) {
                setBody("");
                await load();
              }
            }}
            style={[styles.button, { borderColor: theme.separator }]}
          >
            <ThemedText type="smallBold" themeColor="accent">
              Post message
            </ThemedText>
          </Pressable>
        </>
      ) : null}
    </MemberDestinationScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  input: {
    minHeight: 96,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
    textAlignVertical: "top",
  },
  button: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
  },
});
