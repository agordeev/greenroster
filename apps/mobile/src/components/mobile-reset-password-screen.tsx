import { useRouter } from "expo-router";
import { useRef, useState, type RefObject } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { mobileRecoveryApi } from "@/lib/auth/mobile-recovery-api";
import { mobileSupabase } from "@/lib/auth/mobile-supabase";
import {
  recoveryHandleStorage,
  recoveryRequirementStorage,
} from "@/lib/auth/secure-session-storage";

export function MobileResetPasswordScreen() {
  const router = useRouter();
  const theme = useTheme();
  const confirmInput = useRef<TextInput>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setMessage(null);
    const recoveryHandle = await recoveryHandleStorage.get();
    if (!recoveryHandle) {
      setMessage("This recovery link is expired or has already been used.");
      setPending(false);
      return;
    }
    const result = await mobileRecoveryApi.resetPassword(
      recoveryHandle,
      password,
      confirmPassword,
    );

    if (result.ok && result.state === "complete") {
      await recoveryHandleStorage.clear();
      await recoveryRequirementStorage.clear();
      await mobileSupabase.auth.signOut({ scope: "local" });
      router.replace("/auth/sign-in?status=password-updated");
      return;
    }

    setMessage(
      result.ok
        ? "The recovery service could not be reached. Try again."
        : result.code === "rate_limited"
          ? "Too many attempts. Wait a moment and try again."
          : result.code === "validation"
            ? (result.fieldErrors?.confirmPassword?.[0] ??
              result.fieldErrors?.password?.[0] ??
              "Use at least 12 characters and enter the same password twice.")
            : result.code === "expired" ||
                result.code === "authentication_required"
              ? "This recovery link is expired or has already been used."
              : "The recovery service could not be reached. Check your connection and try again.",
    );
    setPending(false);
  };

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            <View style={styles.heading}>
              <ThemedText type="smallBold" themeColor="accent">
                SINGLE-USE RECOVERY
              </ThemedText>
              <ThemedText type="title">Choose a new password</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.bodyCopy}>
                Use at least 12 characters. This recovery-only session cannot
                open member data.
              </ThemedText>
            </View>

            <ThemedView
              type="backgroundElement"
              style={[styles.form, { borderColor: theme.separator }]}
            >
              <PasswordField
                label="New password"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={() => confirmInput.current?.focus()}
                editable={!pending}
                secure={!showPasswords}
              />
              <PasswordField
                inputRef={confirmInput}
                label="Confirm new password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                onSubmitEditing={submit}
                editable={!pending}
                secure={!showPasswords}
              />

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: showPasswords }}
                onPress={() => setShowPasswords((visible) => !visible)}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <ThemedText type="smallBold" themeColor="accent">
                  {showPasswords ? "Hide passwords" : "Show passwords"}
                </ThemedText>
              </Pressable>

              {message ? (
                <ThemedText type="small" themeColor="accent" role="alert">
                  {message}
                </ThemedText>
              ) : null}

              <Pressable
                accessibilityLabel="Update password"
                accessibilityRole="button"
                accessibilityState={{ busy: pending, disabled: pending }}
                disabled={pending}
                onPress={submit}
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.accent },
                  pressed && styles.pressed,
                  pending && styles.disabled,
                ]}
              >
                {pending ? (
                  <ActivityIndicator
                    accessibilityElementsHidden
                    color={theme.background}
                  />
                ) : (
                  <ThemedText
                    type="smallBold"
                    style={{ color: theme.background }}
                  >
                    Update password
                  </ThemedText>
                )}
              </Pressable>
            </ThemedView>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function PasswordField({
  inputRef,
  editable,
  label,
  onChangeText,
  onSubmitEditing,
  secure,
  value,
}: Readonly<{
  inputRef?: RefObject<TextInput | null>;
  editable: boolean;
  label: string;
  onChangeText(value: string): void;
  onSubmitEditing(): void;
  secure: boolean;
  value: string;
}>) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        autoComplete="new-password"
        editable={editable}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={label === "New password" ? "next" : "done"}
        secureTextEntry={secure}
        style={[
          styles.input,
          { borderColor: theme.textSecondary, color: theme.text },
        ]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: "center" },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    padding: Spacing.four,
    paddingTop: Spacing.five,
    gap: Spacing.five,
  },
  heading: { gap: Spacing.three, maxWidth: 600 },
  bodyCopy: { lineHeight: 24 },
  form: {
    gap: Spacing.four,
    padding: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  field: { gap: Spacing.two },
  input: {
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.6 },
});
