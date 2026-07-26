import { Redirect, useSegments } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function MobileAuthBoundary({
  children,
}: Readonly<{ children: ReactNode }>) {
  const segments = useSegments();
  const theme = useTheme();
  const { recoveryRequired, retrySession, status } = useMobileAuth();
  const isAuthRoute = segments[0] === "auth";
  const isRecoveryRoute =
    isAuthRoute &&
    (segments[1] === "callback" || segments[1] === "reset-password");

  if (status === "checking") {
    return (
      <SessionStatusScreen
        indicator={<ActivityIndicator color={theme.accent} />}
        title="Checking secure access"
        message="GreenRoster is restoring your person-specific session before any protected group data is shown."
      />
    );
  }

  if (status === "error") {
    return (
      <SessionStatusScreen
        title="Session needs attention"
        message="GreenRoster could not verify this session. Check your connection and try again."
        action={
          <Pressable
            accessibilityRole="button"
            onPress={retrySession}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.accent },
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              Try again
            </ThemedText>
          </Pressable>
        }
      />
    );
  }

  if (status === "signed-in" && recoveryRequired && !isRecoveryRoute) {
    return <Redirect href="/auth/reset-password" />;
  }

  if (status === "signed-out" && !isAuthRoute) {
    return <Redirect href="/auth/sign-in" />;
  }

  return children;
}

function SessionStatusScreen({
  action,
  indicator,
  message,
  title,
}: Readonly<{
  action?: ReactNode;
  indicator?: ReactNode;
  message: string;
  title: string;
}>) {
  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          {indicator}
          <ThemedText type="title">{title}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.message}>
            {message}
          </ThemedText>
          {action}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  message: { maxWidth: 600, lineHeight: 24 },
  button: {
    alignSelf: "flex-start",
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
  },
  pressed: { opacity: 0.72 },
});
