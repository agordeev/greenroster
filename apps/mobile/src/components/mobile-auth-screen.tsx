import { Link, useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  mobileAuthActions,
  type MobileAuthActionResult,
} from "@/lib/auth/mobile-auth-actions";

export function MobileAuthScreen({
  initialMessage,
  mode,
}: Readonly<{ initialMessage?: string; mode: "recovery" | "sign-in" }>) {
  const router = useRouter();
  const { consumePendingDestination } = useMobileAuth();
  const theme = useTheme();
  const passwordInput = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MobileAuthActionResult | null>(
    initialMessage
      ? { field: null, message: initialMessage, status: "success" }
      : null,
  );
  const isSignIn = mode === "sign-in";

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setResult(null);

    const nextResult = isSignIn
      ? await mobileAuthActions.signIn(email, password)
      : await mobileAuthActions.requestPasswordRecovery(email);

    setResult(nextResult);
    setPending(false);
    if (isSignIn && nextResult.status === "success") {
      router.replace(await consumePendingDestination());
    }
  };

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            <View style={styles.heading}>
              <ThemedText type="smallBold" themeColor="accent">
                {isSignIn ? "PERSON-SPECIFIC ACCESS" : "ACCOUNT RECOVERY"}
              </ThemedText>
              <ThemedText type="title">
                {isSignIn ? "Sign in as yourself" : "Reset your password"}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.bodyCopy}>
                {isSignIn
                  ? "Use the e-mail and password attached to your own GreenRoster membership."
                  : "Enter your account e-mail. The response never reveals whether an account exists."}
              </ThemedText>
            </View>

            <ThemedView
              type="backgroundElement"
              style={[styles.form, { borderColor: theme.separator }]}
            >
              <View style={styles.field}>
                <ThemedText type="smallBold">E-mail</ThemedText>
                <TextInput
                  accessibilityLabel="E-mail"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  editable={!pending}
                  inputMode="email"
                  onChangeText={setEmail}
                  onSubmitEditing={
                    isSignIn ? () => passwordInput.current?.focus() : submit
                  }
                  returnKeyType={isSignIn ? "next" : "send"}
                  style={[
                    styles.input,
                    { borderColor: theme.textSecondary, color: theme.text },
                  ]}
                  value={email}
                />
                {result?.field === "email" ? (
                  <ThemedText type="small" themeColor="accent" role="alert">
                    {result.message}
                  </ThemedText>
                ) : null}
              </View>

              {isSignIn ? (
                <View style={styles.field}>
                  <ThemedText type="smallBold">Password</ThemedText>
                  <TextInput
                    ref={passwordInput}
                    accessibilityLabel="Password"
                    autoComplete="current-password"
                    editable={!pending}
                    onChangeText={setPassword}
                    onSubmitEditing={submit}
                    returnKeyType="go"
                    secureTextEntry={!showPassword}
                    style={[
                      styles.input,
                      { borderColor: theme.textSecondary, color: theme.text },
                    ]}
                    value={password}
                  />
                  {result?.field === "password" ? (
                    <ThemedText type="small" themeColor="accent" role="alert">
                      {result.message}
                    </ThemedText>
                  ) : null}
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: showPassword }}
                    onPress={() => setShowPassword((visible) => !visible)}
                    style={({ pressed }) => pressed && styles.pressed}
                  >
                    <ThemedText type="smallBold" themeColor="accent">
                      {showPassword ? "Hide password" : "Show password"}
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}

              {result && !result.field ? (
                <ThemedText
                  type="small"
                  themeColor={result.status === "error" ? "accent" : "text"}
                  role={result.status === "error" ? "alert" : "status"}
                >
                  {result.message}
                </ThemedText>
              ) : null}

              <Pressable
                accessibilityLabel={
                  isSignIn ? "Sign in" : "Send recovery instructions"
                }
                accessibilityRole="button"
                accessibilityState={{ busy: pending, disabled: pending }}
                disabled={pending}
                onPress={submit}
                style={({ pressed }) => [
                  styles.primaryButton,
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
                    {isSignIn ? "Sign in" : "Send recovery instructions"}
                  </ThemedText>
                )}
              </Pressable>

              <Link href={isSignIn ? "/auth/recover" : "/auth/sign-in"} asChild>
                <Pressable style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedText type="smallBold" themeColor="accent">
                    {isSignIn ? "Forgot your password?" : "Return to sign in"}
                  </ThemedText>
                </Pressable>
              </Link>
            </ThemedView>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: "center" },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Platform.OS === "web" ? 112 : Spacing.five,
    paddingBottom: Spacing.six,
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
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.6 },
});
