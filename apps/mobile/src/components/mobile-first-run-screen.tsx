import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useMobileFirstRun } from "@/components/mobile-first-run-provider";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { mobileRuntimeEnv } from "@/lib/runtime-env";

export function MobileFirstRunScreen() {
  const router = useRouter();
  const theme = useTheme();
  const firstRun = useMobileFirstRun();
  const firstNameInput = useRef<TextInput>(null);
  const lastNameInput = useRef<TextInput>(null);
  const profile = firstRun.status === "required" ? firstRun.profile : null;
  const [firstName, setFirstName] = useState(profile?.firstName ?? "");
  const [lastName, setLastName] = useState(profile?.lastName ?? "");
  const [acceptedTermsVersion, setAcceptedTermsVersion] = useState<
    string | null
  >(null);
  const [acceptedPrivacyVersion, setAcceptedPrivacyVersion] = useState<
    string | null
  >(null);
  const [pending, setPending] = useState(false);
  const [field, setField] = useState<"firstName" | "lastName" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!profile) return null;

  const acceptedTerms = acceptedTermsVersion === profile.currentTermsVersion;
  const acceptedPrivacy =
    acceptedPrivacyVersion === profile.currentPrivacyVersion;

  const submit = async () => {
    if (pending) return;
    setField(null);
    setMessage(null);

    if (!firstName.trim()) {
      setField("firstName");
      setMessage("Enter your first name.");
      firstNameInput.current?.focus();
      return;
    }

    if (!lastName.trim()) {
      setField("lastName");
      setMessage("Enter your last name.");
      lastNameInput.current?.focus();
      return;
    }

    if (!acceptedTerms || !acceptedPrivacy) {
      setMessage("Accept the Terms of Use and Privacy Policy to continue.");
      return;
    }

    setPending(true);
    const result = await firstRun.complete(firstName, lastName);
    setPending(false);

    if (!result.ok) {
      setField(result.field ?? null);
      setMessage(result.message);
      if (result.field === "firstName") firstNameInput.current?.focus();
      if (result.field === "lastName") lastNameInput.current?.focus();
      return;
    }

    router.replace(firstRun.consumeDeferredPath());
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
                YOUR PROFILE
              </ThemedText>
              <ThemedText type="title">Confirm your profile</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.bodyCopy}>
                Confirm your name and accept the Terms of Use and Privacy Policy
                to see your group.
              </ThemedText>
            </View>

            <ThemedView
              type="backgroundElement"
              style={[styles.form, { borderColor: theme.separator }]}
            >
              <NameField
                editable={!pending}
                error={field === "firstName" ? message : null}
                inputRef={firstNameInput}
                label="First name"
                onChangeText={setFirstName}
                onSubmitEditing={() => lastNameInput.current?.focus()}
                value={firstName}
              />
              <NameField
                editable={!pending}
                error={field === "lastName" ? message : null}
                inputRef={lastNameInput}
                label="Last name"
                onChangeText={setLastName}
                onSubmitEditing={submit}
                value={lastName}
              />

              <LegalAcceptance
                accepted={acceptedTerms}
                documentName="Terms of Use"
                onPress={() =>
                  setAcceptedTermsVersion(
                    acceptedTerms ? null : profile.currentTermsVersion,
                  )
                }
                onRead={() =>
                  void Linking.openURL(`${mobileRuntimeEnv.appUrl}/terms`)
                }
                version={profile.currentTermsVersion}
              />
              <LegalAcceptance
                accepted={acceptedPrivacy}
                documentName="Privacy Policy"
                onPress={() =>
                  setAcceptedPrivacyVersion(
                    acceptedPrivacy ? null : profile.currentPrivacyVersion,
                  )
                }
                onRead={() =>
                  void Linking.openURL(`${mobileRuntimeEnv.appUrl}/privacy`)
                }
                version={profile.currentPrivacyVersion}
              />

              {message && !field ? (
                <ThemedText type="small" themeColor="accent" role="alert">
                  {message}
                </ThemedText>
              ) : null}

              <Pressable
                accessibilityHint="Saves your name and your acceptance of the Terms of Use and Privacy Policy."
                accessibilityLabel="Complete profile"
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
                  <ActivityIndicator color={theme.background} />
                ) : (
                  <ThemedText
                    type="smallBold"
                    style={{ color: theme.background }}
                  >
                    Complete profile
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

function NameField({
  editable,
  error,
  inputRef,
  label,
  onChangeText,
  onSubmitEditing,
  value,
}: Readonly<{
  editable: boolean;
  error: string | null;
  inputRef?: React.RefObject<TextInput | null>;
  label: string;
  onChangeText(value: string): void;
  onSubmitEditing(): void;
  value: string;
}>) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        accessibilityHint={`Enter your ${label.toLowerCase()}.`}
        autoCapitalize="words"
        autoComplete={label === "First name" ? "name-given" : "name-family"}
        editable={editable}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={label === "First name" ? "next" : "done"}
        style={[
          styles.input,
          { borderColor: theme.textSecondary, color: theme.text },
        ]}
        value={value}
      />
      {error ? (
        <ThemedText type="small" themeColor="accent" role="alert">
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

function LegalAcceptance({
  accepted,
  documentName,
  onPress,
  onRead,
  version,
}: Readonly<{
  accepted: boolean;
  documentName: string;
  onPress(): void;
  onRead(): void;
  version: string;
}>) {
  return (
    <View style={styles.legalRow}>
      <Pressable
        aria-checked={accepted}
        accessibilityHint={`Double tap to ${accepted ? "remove your acceptance" : "accept"}.`}
        accessibilityLabel={`Accept the current ${documentName}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.legalControl,
          pressed && styles.pressed,
        ]}
      >
        <ThemedText type="smallBold">
          {accepted ? "☑" : "☐"} I accept the current {documentName}
        </ThemedText>
      </Pressable>
      <Pressable
        accessibilityHint={`Opens the ${documentName} in the browser.`}
        accessibilityLabel={`Read the current ${documentName}`}
        accessibilityRole="link"
        onPress={onRead}
        style={({ pressed }) => [
          styles.legalControl,
          pressed && styles.pressed,
        ]}
      >
        <ThemedText type="small" themeColor="accent">
          Read {documentName} · {version}
        </ThemedText>
      </Pressable>
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
    paddingHorizontal: Spacing.four,
    paddingTop: Platform.OS === "web" ? 88 : Spacing.five,
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
  legalRow: { gap: Spacing.two },
  legalControl: { minHeight: 48, justifyContent: "center" },
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
