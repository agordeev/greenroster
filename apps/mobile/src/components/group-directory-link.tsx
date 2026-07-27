import { Link } from "expo-router";
import { Pressable, StyleSheet } from "react-native";

import { Spacing } from "@/constants/theme";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";

export function GroupDirectoryLink() {
  return (
    <Link href="/group" asChild>
      <Pressable
        accessibilityLabel="Open Group directory"
        accessibilityRole="link"
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <ThemedView type="backgroundSelected" style={styles.linkCard}>
          <ThemedText type="smallBold" themeColor="accent">
            Group directory
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Search active members and shared contact details.
          </ThemedText>
        </ThemedView>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  linkCard: {
    minHeight: 48,
    justifyContent: "center",
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  pressed: { opacity: 0.72 },
});
