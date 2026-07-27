import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  mobileGroupDirectoryApi,
  type MobileGroupDirectoryData,
  type MobileGroupDirectoryMember,
  type MobileGroupDirectoryQuery,
} from "@/lib/group/mobile-group-directory-api";
import {
  directoryAddressLines,
  canApplyDirectoryResponse,
  directoryContactLines,
  directoryEmptyState,
  formatDirectoryMemberName,
  formatDirectoryTee,
} from "@/lib/group/mobile-group-directory-presentation";

const emptyQuery: MobileGroupDirectoryQuery = {
  alphabet: null,
  search: "",
};

type DirectoryScreenState =
  | Readonly<{
      query: MobileGroupDirectoryQuery;
      sessionUserId: string | null;
      status: "loading";
    }>
  | Readonly<{
      message: string;
      query: MobileGroupDirectoryQuery;
      sessionUserId: string;
      status: "error";
    }>
  | Readonly<{
      data: MobileGroupDirectoryData;
      query: MobileGroupDirectoryQuery;
      sessionUserId: string;
      status: "ready";
    }>;

export default function GroupScreen() {
  const theme = useTheme();
  const { session } = useMobileAuth();
  const sessionUserId = session?.user.id ?? null;
  const mounted = useRef(true);
  const requestId = useRef(0);
  const currentSessionUserId = useRef(sessionUserId);
  const [draftSearch, setDraftSearch] = useState("");
  const [allMemberCount, setAllMemberCount] = useState<Readonly<{
    count: number;
    sessionUserId: string;
  }> | null>(null);
  const [state, setState] = useState<DirectoryScreenState>({
    query: emptyQuery,
    sessionUserId: null,
    status: "loading",
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
    };
  }, []);

  const loadDirectory = useCallback(
    async (
      query: MobileGroupDirectoryQuery,
      requestSessionUserId = currentSessionUserId.current,
    ) => {
      if (!mounted.current) return;
      if (
        !requestSessionUserId ||
        currentSessionUserId.current !== requestSessionUserId
      ) {
        return;
      }
      const currentRequest = ++requestId.current;
      if (!query.search && !query.alphabet) setAllMemberCount(null);
      setState({
        query,
        sessionUserId: requestSessionUserId,
        status: "loading",
      });
      const result = await mobileGroupDirectoryApi.resolve(
        query.search,
        query.alphabet,
      );
      if (
        !mounted.current ||
        !canApplyDirectoryResponse(
          requestSessionUserId,
          currentSessionUserId.current,
          currentRequest,
          requestId.current,
        )
      ) {
        return;
      }

      if (!result.ok) {
        setState({
          message: result.message,
          query,
          sessionUserId: requestSessionUserId,
          status: "error",
        });
        return;
      }

      if (!query.search && !query.alphabet) {
        setAllMemberCount({
          count: result.data.members.length,
          sessionUserId: requestSessionUserId,
        });
      }
      setState({
        data: result.data,
        query,
        sessionUserId: requestSessionUserId,
        status: "ready",
      });
    },
    [],
  );

  useEffect(() => {
    currentSessionUserId.current = sessionUserId;
    void Promise.resolve().then(() => {
      if (!mounted.current) return;
      setDraftSearch("");
      if (sessionUserId) void loadDirectory(emptyQuery, sessionUserId);
    });
  }, [loadDirectory, sessionUserId]);

  const visibleState: DirectoryScreenState =
    state.sessionUserId === sessionUserId
      ? state
      : { query: emptyQuery, sessionUserId, status: "loading" };
  const query = visibleState.query;
  const busy = visibleState.status === "loading";
  const visibleAllMemberCount =
    allMemberCount?.sessionUserId === sessionUserId
      ? allMemberCount.count
      : null;

  function submitSearch() {
    if (busy) return;
    void loadDirectory(
      {
        alphabet: query.alphabet,
        search: draftSearch.trim(),
      },
      sessionUserId,
    );
  }

  function chooseAlphabet(alphabet: string | null) {
    if (busy) return;
    void loadDirectory({ alphabet, search: query.search }, sessionUserId);
  }

  function clearFilters() {
    if (busy) return;
    setDraftSearch("");
    void loadDirectory(emptyQuery, sessionUserId);
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              onRefresh={() => void loadDirectory(query, sessionUserId)}
              refreshing={busy}
              tintColor={theme.accent}
            />
          }
        >
          <View style={styles.content}>
            <View style={styles.brandRow}>
              <View
                accessibilityElementsHidden
                style={[styles.brandMark, { borderColor: theme.accent }]}
              >
                <ThemedText
                  type="smallBold"
                  themeColor="accent"
                  style={styles.brandInitials}
                >
                  GR
                </ThemedText>
              </View>
              <View style={styles.brandCopy}>
                <ThemedText type="smallBold">GreenRoster</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Your group directory
                </ThemedText>
              </View>
            </View>

            <View style={styles.heading}>
              <ThemedText
                type="smallBold"
                themeColor="accent"
                style={styles.eyebrow}
              >
                GROUP
              </ThemedText>
              <ThemedText type="title" style={styles.title}>
                {visibleState.status === "ready"
                  ? visibleState.data.group.name
                  : "Group"}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.bodyCopy}>
                Find active members and the contact details your group has
                chosen to share.
              </ThemedText>
            </View>

            {visibleState.status === "ready" ? (
              <ThemedView
                type="backgroundElement"
                style={[styles.groupCard, { borderColor: theme.separator }]}
              >
                <ThemedText type="smallBold" themeColor="textSecondary">
                  GROUP TIME ZONE
                </ThemedText>
                <ThemedText>{visibleState.data.group.timeZone}</ThemedText>
              </ThemedView>
            ) : null}

            <View style={styles.filterSection}>
              <ThemedText type="subtitle" style={styles.sectionTitle}>
                Directory
              </ThemedText>
              <View style={styles.searchRow}>
                <TextInput
                  accessibilityLabel="Search active members"
                  autoCapitalize="words"
                  autoCorrect={false}
                  editable={!busy}
                  maxLength={200}
                  onChangeText={setDraftSearch}
                  onSubmitEditing={submitSearch}
                  placeholder="Search by name"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="search"
                  style={[
                    styles.searchInput,
                    {
                      borderColor: theme.separator,
                      color: theme.text,
                    },
                  ]}
                  value={draftSearch}
                />
                <Pressable
                  accessibilityLabel="Search active members"
                  accessibilityRole="button"
                  accessibilityState={{ busy, disabled: busy }}
                  disabled={busy}
                  onPress={submitSearch}
                  style={({ pressed }) => [
                    styles.searchButton,
                    { backgroundColor: theme.accent },
                    pressed && styles.pressed,
                    busy && styles.disabled,
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={theme.background} />
                  ) : (
                    <ThemedText
                      type="smallBold"
                      style={{ color: theme.background }}
                    >
                      Search
                    </ThemedText>
                  )}
                </Pressable>
              </View>

              <ScrollView
                contentContainerStyle={styles.alphabetRow}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                <AlphabetButton
                  active={query.alphabet === null}
                  disabled={busy}
                  label="All"
                  onPress={() => chooseAlphabet(null)}
                />
                {Array.from({ length: 26 }, (_, index) => {
                  const letter = String.fromCharCode(65 + index);
                  return (
                    <AlphabetButton
                      key={letter}
                      active={query.alphabet === letter}
                      disabled={busy}
                      label={letter}
                      onPress={() => chooseAlphabet(letter)}
                    />
                  );
                })}
              </ScrollView>

              {query.search || query.alphabet ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear directory filters"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={clearFilters}
                  style={({ pressed }) => [
                    styles.clearFiltersButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <ThemedText type="smallBold" themeColor="accent">
                    Clear filters
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>

            <DirectoryContent
              allMemberCount={visibleAllMemberCount}
              query={query}
              state={visibleState}
              onRetry={() => void loadDirectory(query, sessionUserId)}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function AlphabetButton({
  active,
  disabled,
  label,
  onPress,
}: Readonly<{
  active: boolean;
  disabled: boolean;
  label: string;
  onPress: () => void;
}>) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={`Filter members by ${label === "All" ? "all surnames" : `surname ${label}`}`}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <ThemedView
        type={active ? "backgroundSelected" : "backgroundElement"}
        style={[styles.alphabetButton, { borderColor: theme.separator }]}
      >
        <ThemedText
          type="smallBold"
          themeColor={active ? "text" : "textSecondary"}
        >
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function DirectoryContent({
  allMemberCount,
  onRetry,
  query,
  state,
}: Readonly<{
  allMemberCount: number | null;
  onRetry: () => void;
  query: MobileGroupDirectoryQuery;
  state: DirectoryScreenState;
}>) {
  const theme = useTheme();
  if (state.status === "loading") {
    return (
      <ThemedView
        type="backgroundElement"
        style={[styles.statusCard, { borderColor: theme.separator }]}
      >
        <ActivityIndicator color={theme.accent} />
        <ThemedText type="subtitle">Loading directory</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.bodyCopy}>
          GreenRoster is checking the current group roster.
        </ThemedText>
      </ThemedView>
    );
  }

  if (state.status === "error") {
    return (
      <ThemedView
        type="backgroundElement"
        style={[styles.statusCard, { borderColor: theme.separator }]}
      >
        <ThemedText type="subtitle">Directory unavailable</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.bodyCopy}>
          {state.message}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading group directory"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryButton,
            { backgroundColor: theme.accent },
            pressed && styles.pressed,
          ]}
        >
          <ThemedText type="smallBold" style={{ color: theme.background }}>
            Try again
          </ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  if (state.data.members.length === 0) {
    const empty = directoryEmptyState(allMemberCount, query);
    return (
      <ThemedView
        type="backgroundElement"
        style={[styles.statusCard, { borderColor: theme.separator }]}
      >
        <ThemedText type="subtitle">
          {empty === "no_members" ? "No members yet" : "No members match"}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.bodyCopy}>
          {empty === "no_members"
            ? "No active members are available in this group yet."
            : "Try a different search or surname initial."}
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <View style={styles.memberSection}>
      <View style={styles.memberHeading}>
        <ThemedText type="subtitle">Active members</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {state.data.members.length} listed
        </ThemedText>
      </View>
      <View style={styles.memberList}>
        {state.data.members.map((member) => (
          <DirectoryMemberCard key={member.membershipId} member={member} />
        ))}
      </View>
    </View>
  );
}

function DirectoryMemberCard({
  member,
}: Readonly<{ member: MobileGroupDirectoryMember }>) {
  const theme = useTheme();
  const name = formatDirectoryMemberName(member);
  const tee = formatDirectoryTee(member.teeLocation);
  const contacts = directoryContactLines(member).filter(([, value]) =>
    Boolean(value),
  ) as readonly (readonly [string, string])[];
  const address = member.address ? directoryAddressLines(member.address) : [];
  const accessibilityLabel = [
    name,
    tee ? `Tee ${tee}` : null,
    ...contacts.map(([label, value]) => `${label} ${value}`),
    ...(address.length > 0 ? [`Address ${address.join(", ")}`] : []),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <ThemedView
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="text"
      type="backgroundElement"
      style={[styles.memberCard, { borderColor: theme.separator }]}
    >
      <View style={styles.memberCardHeading}>
        <ThemedText type="subtitle" style={styles.memberName}>
          {name}
        </ThemedText>
        {tee ? (
          <ThemedText type="smallBold" themeColor="accent">
            Tee · {tee}
          </ThemedText>
        ) : null}
      </View>

      {contacts.length > 0 ? (
        <View style={styles.optionalSection}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            CONTACT
          </ThemedText>
          {contacts.map(([label, value]) => (
            <View key={label} style={styles.detailRow}>
              <ThemedText type="small" themeColor="textSecondary">
                {label}
              </ThemedText>
              <ThemedText style={styles.detailValue}>{value}</ThemedText>
            </View>
          ))}
        </View>
      ) : null}

      {address.length > 0 ? (
        <View style={styles.optionalSection}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            ADDRESS
          </ThemedText>
          {address.map((line, index) => (
            <ThemedText key={`${line}-${index}`}>{line}</ThemedText>
          ))}
        </View>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    paddingBottom: Spacing.six,
  },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.five,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: Spacing.three },
  brandMark: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 22,
  },
  brandInitials: { letterSpacing: 1 },
  brandCopy: { flex: 1, gap: Spacing.half },
  heading: { gap: Spacing.three },
  eyebrow: { letterSpacing: 1.5 },
  title: { maxWidth: 600 },
  bodyCopy: { maxWidth: 600, lineHeight: 24 },
  groupCard: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  filterSection: { gap: Spacing.three },
  sectionTitle: { fontSize: 28, lineHeight: 36 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
    fontSize: 16,
  },
  searchButton: {
    minWidth: 88,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  alphabetRow: { gap: Spacing.one, paddingVertical: Spacing.one },
  alphabetButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  clearFiltersButton: {
    minWidth: 48,
    minHeight: 48,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: Spacing.two,
  },
  statusCard: {
    gap: Spacing.three,
    padding: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  retryButton: {
    alignSelf: "flex-start",
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
  },
  memberSection: { gap: Spacing.three },
  memberHeading: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  memberList: { gap: Spacing.three },
  memberCard: {
    gap: Spacing.four,
    padding: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  memberCardHeading: { gap: Spacing.one },
  memberName: { fontSize: 26, lineHeight: 34 },
  optionalSection: { gap: Spacing.two },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  detailValue: { flexShrink: 1, textAlign: "right" },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.6 },
});
