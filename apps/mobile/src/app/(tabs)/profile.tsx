import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { GroupDirectoryLink } from "@/components/group-directory-link";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { MobileSignOutButton } from "@/components/mobile-sign-out-button";
import { useMobileFirstRun } from "@/components/mobile-first-run-provider";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import {
  mobileAccountEmailActions,
  type MobileAccountEmailActionResult,
} from "@/lib/auth/mobile-account-email-actions";

import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useState } from "react";
import { Spacing } from "@/constants/theme";

export default function ProfileScreen() {
  const { recoveryRequired, session } = useMobileAuth();
  const firstRun = useMobileFirstRun();
  const profile = firstRun.status === "complete" ? firstRun.profile : null;
  const currentEmail = session?.user.email ?? null;

  return (
    <MemberDestinationScreen
      eyebrow="Profile"
      title="Identity, golf data, and privacy"
      introduction="Your account, group label, personal golf details, history, directory, standings, and privacy actions meet here."
      emptyTitle={
        recoveryRequired
          ? "Password recovery must be completed"
          : "Golf and account details are not loaded"
      }
      emptyBody={
        recoveryRequired
          ? "This recovery-only session cannot load member data. Continue to password replacement when prompted."
          : "Your required identity profile is confirmed. Optional golfer, history, notification, and privacy details arrive in later phases."
      }
      facts={[
        ["Account", recoveryRequired ? "Password recovery" : "Signed in"],
        [
          "Name",
          profile ? `${profile.firstName} ${profile.lastName}` : "Not resolved",
        ],
        [
          "Legal status",
          profile
            ? `Terms ${profile.currentTermsVersion} · Privacy ${profile.currentPrivacyVersion}`
            : "Not resolved",
        ],
      ]}
    >
      <GroupDirectoryLink />
      {!recoveryRequired ? (
        <AccountEmailSection
          key={currentEmail ?? "no-session-email"}
          currentEmail={currentEmail}
        />
      ) : null}
      <MobileSignOutButton />
    </MemberDestinationScreen>
  );
}

function AccountEmailSection({
  currentEmail,
}: Readonly<{ currentEmail: string | null }>) {
  const theme = useTheme();
  const [nextEmail, setNextEmail] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"change" | "refresh" | null>(null);
  const [result, setResult] = useState<MobileAccountEmailActionResult | null>(
    null,
  );

  const submit = async () => {
    if (busy || !currentEmail) return;
    setBusy("change");
    setResult(null);
    const nextResult = await mobileAccountEmailActions.requestEmailChange(
      currentEmail,
      nextEmail,
      confirmed,
    );
    setResult(nextResult);
    setBusy(null);
  };

  const refresh = async () => {
    if (busy || !currentEmail) return;
    setBusy("refresh");
    const nextResult = await mobileAccountEmailActions.refreshSession();
    setResult(nextResult);
    setBusy(null);
  };

  return (
    <View style={[styles.accountSection, { borderColor: theme.separator }]}>
      <View style={styles.sectionHeading}>
        <ThemedText type="subtitle">Account e-mail</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.bodyCopy}>
          Your account e-mail is the single address GreenRoster uses for
          sign-in, recovery, and product notifications.
        </ThemedText>
      </View>

      <View style={styles.currentEmail}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          CURRENT ACCOUNT E-MAIL
        </ThemedText>
        <ThemedText accessibilityLabel="Current account e-mail">
          {currentEmail ?? "Unavailable in this session"}
        </ThemedText>
      </View>

      <View style={styles.field}>
        <ThemedText type="smallBold">New account e-mail</ThemedText>
        <TextInput
          accessibilityLabel="New account e-mail"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          editable={busy === null && currentEmail !== null}
          inputMode="email"
          onChangeText={setNextEmail}
          onSubmitEditing={submit}
          returnKeyType="send"
          style={[
            styles.input,
            { borderColor: theme.textSecondary, color: theme.text },
          ]}
          value={nextEmail}
        />
        {result?.field === "email" ? (
          <ThemedText type="small" themeColor="accent" role="alert">
            {result.message}
          </ThemedText>
        ) : null}
      </View>

      <Pressable
        accessibilityLabel="Confirm account e-mail change"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: confirmed, disabled: busy !== null }}
        disabled={busy !== null}
        onPress={() => setConfirmed((value) => !value)}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <ThemedText type="smallBold" themeColor="accent">
          {confirmed ? "✓ " : "☐ "}I understand verification must be completed
        </ThemedText>
      </Pressable>
      {result?.field === "confirmation" ? (
        <ThemedText type="small" themeColor="accent" role="alert">
          {result.message}
        </ThemedText>
      ) : null}

      {result && !result.field ? (
        <ThemedText
          type="small"
          themeColor={result.status === "error" ? "accent" : "textSecondary"}
          role={result.status === "error" ? "alert" : "status"}
        >
          {result.message}
        </ThemedText>
      ) : null}

      <Pressable
        accessibilityLabel="Send account e-mail confirmation links"
        accessibilityRole="button"
        accessibilityState={{
          busy: busy === "change",
          disabled: busy !== null || currentEmail === null,
        }}
        disabled={busy !== null || currentEmail === null}
        onPress={submit}
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: theme.accent },
          pressed && styles.pressed,
          busy !== null && styles.disabled,
        ]}
      >
        {busy === "change" ? (
          <ActivityIndicator
            accessibilityElementsHidden
            color={theme.background}
          />
        ) : (
          <ThemedText type="smallBold" style={{ color: theme.background }}>
            Send confirmation links
          </ThemedText>
        )}
      </Pressable>

      <Pressable
        accessibilityLabel="Refresh account e-mail status"
        accessibilityRole="button"
        accessibilityState={{
          busy: busy === "refresh",
          disabled: busy !== null || currentEmail === null,
        }}
        disabled={busy !== null || currentEmail === null}
        onPress={refresh}
        style={({ pressed }) => pressed && styles.pressed}
      >
        {busy === "refresh" ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          <ThemedText type="smallBold" themeColor="accent">
            Refresh account status
          </ThemedText>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  accountSection: {
    gap: Spacing.four,
    padding: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  sectionHeading: {
    gap: Spacing.three,
  },
  bodyCopy: {
    lineHeight: 24,
  },
  currentEmail: {
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.two,
  },
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
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.6,
  },
});
