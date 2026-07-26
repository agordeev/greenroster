import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function MemberDestinationScreen({
  emptyBody,
  emptyTitle,
  eyebrow,
  facts,
  introduction,
  title,
}: Readonly<{
  emptyBody: string;
  emptyTitle: string;
  eyebrow: string;
  facts: readonly (readonly [label: string, value: string])[];
  introduction: string;
  title: string;
}>) {
  const theme = useTheme();

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          contentInsetAdjustmentBehavior="automatic"
        >
          <View style={styles.content}>
            <View style={styles.brandRow}>
              <View
                style={[styles.brandMark, { borderColor: theme.accent }]}
                accessibilityElementsHidden
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
                  Group appears after sign-in
                </ThemedText>
              </View>
            </View>

            <View style={styles.heading}>
              <ThemedText
                type="smallBold"
                themeColor="accent"
                style={styles.eyebrow}
              >
                {eyebrow.toUpperCase()}
              </ThemedText>
              <ThemedText type="title" style={styles.title}>
                {title}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.bodyCopy}>
                {introduction}
              </ThemedText>
            </View>

            <ThemedView
              type="backgroundElement"
              style={[styles.emptyCard, { borderColor: theme.separator }]}
            >
              <ThemedText type="subtitle">{emptyTitle}</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.bodyCopy}>
                {emptyBody}
              </ThemedText>
            </ThemedView>

            <View style={[styles.factList, { borderColor: theme.separator }]}>
              {facts.map(([label, value]) => (
                <View
                  key={label}
                  style={[styles.factRow, { borderColor: theme.separator }]}
                >
                  <ThemedText type="small" themeColor="textSecondary">
                    {label.toUpperCase()}
                  </ThemedText>
                  <ThemedText type="smallBold">{value}</ThemedText>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    paddingBottom: BottomTabInset + Spacing.five,
  },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Platform.OS === "web" ? 88 : Spacing.three,
    gap: Spacing.five,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  brandMark: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 22,
  },
  brandInitials: {
    letterSpacing: 1,
  },
  brandCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  heading: {
    gap: Spacing.three,
  },
  eyebrow: {
    letterSpacing: 1.5,
  },
  title: {
    maxWidth: 540,
  },
  bodyCopy: {
    maxWidth: 600,
    lineHeight: 24,
  },
  emptyCard: {
    gap: Spacing.three,
    padding: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  factList: {
    borderTopWidth: 1,
  },
  factRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
  },
});
