import {
  Redirect,
  useLocalSearchParams,
  usePathname,
  useSegments,
} from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ReactNode } from "react";

import { useMobileFirstRun } from "@/components/mobile-first-run-provider";
import { MobileSignOutButton } from "@/components/mobile-sign-out-button";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { MobileLinkDestination } from "@/lib/auth/mobile-link-destination";

export function MobileFirstRunBoundary({
  children,
}: Readonly<{ children: ReactNode }>) {
  const path = usePathname();
  const params = useLocalSearchParams<{ roundId?: string | string[] }>();
  const segments = useSegments();
  const theme = useTheme();
  const firstRun = useMobileFirstRun();
  const auth = useMobileAuth();
  const isFirstRunRoute = segments[0] === "auth" && segments[1] === "first-run";
  const isRecoveryRoute =
    segments[0] === "auth" &&
    (segments[1] === "callback" || segments[1] === "reset-password");

  if (isRecoveryRoute || auth.status !== "signed-in" || auth.recoveryRequired) {
    return children;
  }

  if (firstRun.status === "checking" || firstRun.status === "idle") {
    return (
      <StateScreen
        indicator={<ActivityIndicator color={theme.accent} />}
        title="Checking your profile"
        message="Checking your membership and the current legal documents. Your group appears after that."
      />
    );
  }

  if (firstRun.status === "error") {
    return (
      <StateScreen
        title={
          firstRun.code === "permission_denied"
            ? "Membership access unavailable"
            : firstRun.code === "configuration_unavailable"
              ? "Legal documents unavailable"
              : "Profile needs attention"
        }
        message={firstRun.message}
        action={
          firstRun.code === "permission_denied" ||
          firstRun.code === "configuration_unavailable" ? (
            <MobileSignOutButton />
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={firstRun.retry}
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
          )
        }
      />
    );
  }

  if (firstRun.status === "required" && !isFirstRunRoute) {
    const roundId = Array.isArray(params.roundId)
      ? params.roundId[0]
      : params.roundId;
    const deferredPath =
      path === "/rounds" && roundId ? `/rounds?roundId=${roundId}` : path;
    firstRun.rememberDeferredPath(deferredPath as MobileLinkDestination);
    return <Redirect href="/auth/first-run" />;
  }

  if (firstRun.status === "complete" && isFirstRunRoute) {
    return <Redirect href={firstRun.consumeDeferredPath()} />;
  }

  return children;
}

function StateScreen({
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
