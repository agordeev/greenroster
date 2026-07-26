import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { mobileAuthActions } from "@/lib/auth/mobile-auth-actions";

export function MobileSignOutButton() {
  const theme = useTheme();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
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
        accessibilityRole="button"
        disabled={pending}
        onPress={signOut}
        style={({ pressed }) => [
          styles.button,
          { borderColor: theme.separator },
          pressed && styles.pressed,
          pending && styles.disabled,
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
