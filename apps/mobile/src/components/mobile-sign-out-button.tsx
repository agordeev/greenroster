import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { mobileAuthActions } from "@/lib/auth/mobile-auth-actions";
import { createMobileScoreQueue } from "@/lib/rounds/mobile-score-queue";
import { createMobileLiveRoundSnapshotStorage } from "@/lib/rounds/mobile-live-round-snapshot-storage";

export function MobileSignOutButton({
  beforeSignOut,
  disabled = false,
}: Readonly<{
  beforeSignOut?: () => boolean | Promise<boolean>;
  disabled?: boolean;
}>) {
  const theme = useTheme();
  const { session } = useMobileAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scoreQueue = useMemo(
    () => createMobileScoreQueue({ platform: Platform.OS }),
    [],
  );
  const snapshotStorage = useMemo(
    () => createMobileLiveRoundSnapshotStorage(),
    [],
  );

  const confirmPendingScores = async () => {
    const userId = session?.user.id;
    if (!userId || !scoreQueue.isSupported) return true;
    let hasPending = false;
    try {
      hasPending = await scoreQueue.hasPendingUser(userId);
    } catch {
      setError("GreenRoster could not inspect pending scores. Try again.");
      return false;
    }
    if (!hasPending) return true;
    return new Promise<boolean>((resolve) => {
      Alert.alert(
        "Pending scores",
        "Some scores are still waiting to sync. Keep signed in to retry, or discard them and sign out.",
        [
          {
            text: "Keep signed in",
            style: "cancel",
            onPress: () => resolve(false),
          },
          {
            text: "Discard and sign out",
            style: "destructive",
            onPress: () => resolve(true),
          },
        ],
      );
    });
  };

  const signOut = async () => {
    if (pending || disabled) return;
    if (beforeSignOut && !(await beforeSignOut())) return;
    if (!(await confirmPendingScores())) return;
    setPending(true);
    setError(null);
    if (session?.user.id && scoreQueue.isSupported) {
      try {
        await scoreQueue.clearUser(session.user.id);
        await snapshotStorage.clearUser(session.user.id);
      } catch {
        setError("GreenRoster could not clear pending scores. Try again.");
        setPending(false);
        return;
      }
    }
    const result = await mobileAuthActions.signOut();
    if (result.status === "error") setError(result.message);
    setPending(false);
  };

  return (
    <View style={styles.container}>
      {error ? (
        <ThemedText type="small" themeColor="accent" role="alert">
          {error}
        </ThemedText>
      ) : null}
      <Pressable
        accessibilityLabel="Sign out on this device"
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled: pending || disabled }}
        disabled={pending || disabled}
        onPress={() => void signOut()}
        style={({ pressed }) => [
          styles.button,
          { borderColor: theme.separator },
          pressed && styles.pressed,
          (pending || disabled) && styles.disabled,
        ]}
      >
        {pending ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          <ThemedText type="smallBold" themeColor="accent">
            Sign out on this device
          </ThemedText>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "flex-start", gap: Spacing.two },
  button: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.6 },
});
