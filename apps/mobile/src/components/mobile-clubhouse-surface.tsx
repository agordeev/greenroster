import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useCallback, useEffect, useState } from "react";

import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { ThemedText } from "@/components/themed-text";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  mobileClubhouseApi,
  type MobileClubhouseData,
  type MobileCoordinatorContact,
  type MobileCoordinator,
} from "@/lib/clubhouse/mobile-clubhouse-api";

export function MobileClubhouseSurface() {
  const theme = useTheme();
  const { session } = useMobileAuth();
  const [data, setData] = useState<MobileClubhouseData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [coordinators, setCoordinators] = useState<
    readonly MobileCoordinator[]
  >([]);
  const [contacts, setContacts] = useState<readonly MobileCoordinatorContact[]>(
    [],
  );
  const [contactHistoryMessage, setContactHistoryMessage] = useState<
    string | null
  >(null);
  const [selectedCoordinator, setSelectedCoordinator] = useState<string | null>(
    null,
  );
  const [contactBody, setContactBody] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    if (!session) {
      setLoading(false);
      setMessage("You sign in to see your group news.");
      return;
    }
    const result = await mobileClubhouseApi.read();
    const [nextCoordinators, contactResult] = await Promise.all([
      mobileClubhouseApi.coordinators(),
      mobileClubhouseApi.contacts(),
    ]);
    setCoordinators(nextCoordinators);
    if (contactResult.ok) {
      setContacts(contactResult.data);
      setContactHistoryMessage(null);
    } else {
      setContacts([]);
      setContactHistoryMessage(contactResult.message);
    }
    if (!result.ok) {
      setMessage(result.message);
      setData(null);
    } else setData(result.data);
    setLoading(false);
  }, [session]);
  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);
  return (
    <MemberDestinationScreen
      eyebrow="Clubhouse"
      title={data?.groupName ?? "Your clubhouse"}
      introduction="You see news, videos, and group updates here."
      emptyTitle={
        message
          ? "You can't open your clubhouse"
          : "You have no clubhouse news yet"
      }
      emptyBody={message ?? "Your coordinators can share news and videos here."}
      hideEmptyState={
        loading || Boolean(data && (data.news.length || data.media.length))
      }
      facts={[
        ["News", data ? String(data.news.length) : "—"],
        ["Videos", data ? String(data.media.length) : "—"],
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={theme.accent}
          accessibilityLabel="Loading your clubhouse"
        />
      ) : null}
      {message ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry clubhouse"
          onPress={() => void load()}
          style={[styles.button, { borderColor: theme.separator }]}
        >
          <ThemedText type="smallBold" themeColor="accent">
            Retry clubhouse
          </ThemedText>
        </Pressable>
      ) : null}
      {data?.news.map((item) => (
        <View
          key={item.id}
          style={[styles.card, { borderColor: theme.separator }]}
        >
          <ThemedText type="subtitle">{item.title}</ThemedText>
          <ThemedText>{item.body}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {item.author}
          </ThemedText>
        </View>
      ))}
      {data?.media.map((item) => (
        <View
          key={item.id}
          style={[styles.card, { borderColor: theme.separator }]}
        >
          <ThemedText type="subtitle">{item.title}</ThemedText>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${item.title}`}
            onPress={() => void Linking.openURL(item.mediaUrl)}
            style={styles.button}
          >
            <ThemedText type="smallBold" themeColor="accent">
              Open video
            </ThemedText>
          </Pressable>
        </View>
      ))}
      {coordinators.length > 0 ? (
        <View style={styles.card}>
          <ThemedText type="subtitle">Contact your coordinator</ThemedText>
          <View style={styles.coordinatorList}>
            {coordinators.map((coordinator) => (
              <Pressable
                key={coordinator.membershipId}
                accessibilityRole="button"
                onPress={() => setSelectedCoordinator(coordinator.membershipId)}
                style={[
                  styles.button,
                  {
                    borderColor:
                      selectedCoordinator === coordinator.membershipId
                        ? theme.accent
                        : theme.separator,
                  },
                ]}
              >
                <ThemedText type="smallBold" themeColor="accent">
                  {coordinator.displayName}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          {selectedCoordinator ? (
            <>
              <TextInput
                accessibilityLabel="Message for your coordinator"
                multiline
                maxLength={2000}
                value={contactBody}
                onChangeText={setContactBody}
                placeholder="Write your message"
                style={[
                  styles.input,
                  { borderColor: theme.separator, color: theme.text },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                onPress={async () => {
                  const result = await mobileClubhouseApi.contact(
                    selectedCoordinator,
                    contactBody,
                  );
                  setContactMessage(
                    result.ok ? "You sent your message." : result.message,
                  );
                  if (result.ok) {
                    setContactBody("");
                    const refreshed = await mobileClubhouseApi.contacts();
                    if (refreshed.ok) {
                      setContacts(refreshed.data);
                      setContactHistoryMessage(null);
                    } else setContactHistoryMessage(refreshed.message);
                  }
                }}
                style={[styles.button, { borderColor: theme.separator }]}
              >
                <ThemedText type="smallBold" themeColor="accent">
                  Send message
                </ThemedText>
              </Pressable>
            </>
          ) : null}
          {contactMessage ? (
            <ThemedText
              accessibilityLiveRegion="polite"
              themeColor="textSecondary"
            >
              {contactMessage}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
      {contacts.length > 0 || contactHistoryMessage ? (
        <View style={[styles.card, { borderColor: theme.separator }]}>
          <ThemedText type="subtitle">
            You see your coordinator messages
          </ThemedText>
          {contactHistoryMessage ? (
            <ThemedText
              accessibilityLiveRegion="polite"
              themeColor="textSecondary"
            >
              {contactHistoryMessage}
            </ThemedText>
          ) : (
            contacts.map((contact) => (
              <View key={contact.messageId} style={styles.contactHistoryItem}>
                <ThemedText>{contact.body}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {contact.sentByActor
                    ? `You sent this to ${contact.recipientDisplayName}.`
                    : `You receive this from ${contact.senderDisplayName}.`}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatContactTimestamp(contact.createdAt)}
                </ThemedText>
              </View>
            ))
          )}
        </View>
      ) : null}
    </MemberDestinationScreen>
  );
}

function formatContactTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  button: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
    alignItems: "center",
  },
  coordinatorList: { gap: Spacing.two },
  contactHistoryItem: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    minHeight: 96,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
    textAlignVertical: "top",
  },
});
