import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";

import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  mobileNotificationPreferencesApi,
  type MobileNotificationPreference,
  type MobileNotificationPreferenceChannel,
} from "@/lib/notifications/mobile-notification-preferences-api";
import {
  canChangeMobileNotificationPreference,
  getMobileNotificationPreferenceLabel,
  initialMobileNotificationPreferencesState,
  mobileNotificationPreferencesReducer,
} from "@/lib/notifications/mobile-notification-preferences-state";
import {
  getMobilePushPermissionStatus,
  mobilePushRegistration,
  type MobilePushPermissionStatus,
} from "@/lib/notifications/mobile-push-registration-default";

export default function NotificationPreferencesScreen() {
  const theme = useTheme();
  const { recoveryRequired, session } = useMobileAuth();
  const [state, dispatch] = useReducer(
    mobileNotificationPreferencesReducer,
    initialMobileNotificationPreferencesState,
  );
  const [permissionStatus, setPermissionStatus] =
    useState<MobilePushPermissionStatus>("undetermined");
  const [registrationPending, setRegistrationPending] = useState(false);
  const [registrationStatus, setRegistrationStatus] = useState<
    "unknown" | "registered" | "error"
  >("unknown");
  const [pushError, setPushError] = useState<string | null>(null);
  const registrationPendingRef = useRef(false);

  const load = useCallback(() => {
    if (!session?.user.id || recoveryRequired) return;
    dispatch({ type: "load" });
    void mobileNotificationPreferencesApi.resolve().then((result) => {
      if (result.ok) dispatch({ preferences: result.data, type: "loaded" });
      else dispatch({ message: result.message, type: "failed" });
    });
  }, [recoveryRequired, session?.user.id]);

  const registerPush = useCallback(
    async (requestPermission: boolean) => {
      const userId = session?.user.id;
      if (!userId || registrationPendingRef.current || Platform.OS === "web")
        return;
      setPushError(null);
      registrationPendingRef.current = true;
      setRegistrationPending(true);
      try {
        const result = await mobilePushRegistration.register(userId, {
          requestPermission,
        });
        setPermissionStatus(await getMobilePushPermissionStatus());
        if (result.status === "registered") {
          setRegistrationStatus("registered");
          return;
        }
        if (result.status === "permission_denied") {
          setRegistrationStatus("error");
          return;
        }
        setRegistrationStatus("error");
        setPushError(
          result.message ?? "We couldn't turn on push notifications.",
        );
      } catch {
        setRegistrationStatus("error");
        setPushError(
          "We couldn't turn on push notifications. Check your connection and try again.",
        );
      } finally {
        registrationPendingRef.current = false;
        setRegistrationPending(false);
      }
    },
    [session?.user.id],
  );

  useEffect(() => {
    load();
    const userId = session?.user.id;
    if (!userId || recoveryRequired) return;
    let active = true;
    void getMobilePushPermissionStatus().then(async (status) => {
      if (!active) return;
      setPermissionStatus(status);
      if (status === "granted" && Platform.OS !== "web") {
        await registerPush(false);
      }
    });
    return () => {
      active = false;
    };
  }, [load, recoveryRequired, registerPush, session?.user.id]);

  const retryPushRegistration = () => {
    void registerPush(permissionStatus !== "granted");
  };

  const permissionCopy =
    permissionStatus === "granted" && registrationStatus === "registered"
      ? "Push notifications are on for this device."
      : permissionStatus === "granted"
        ? "Your phone allows notifications, but this device isn't connected to GreenRoster yet."
        : permissionStatus === "denied"
          ? "Push notifications are turned off in your phone's settings. Email notifications still arrive."
          : permissionStatus === "unsupported"
            ? "Push notifications work in the GreenRoster app."
            : "Turn on push notifications for rounds and your account.";

  const setPreference = async (
    preference: MobileNotificationPreference,
    channel: MobileNotificationPreferenceChannel,
    enabled: boolean,
  ) => {
    if (
      state.pending ||
      !canChangeMobileNotificationPreference(preference, channel)
    ) {
      return;
    }
    dispatch({ category: preference.category, channel, type: "save_started" });
    const result = await mobileNotificationPreferencesApi.setPreference({
      category: preference.category,
      channel,
      enabled,
      expectedPreferenceVersion: preference.version,
    });
    if (result.ok) dispatch({ mutation: result.data, type: "save_succeeded" });
    else dispatch({ message: result.message, type: "save_failed" });
  };

  return (
    <MemberDestinationScreen
      eyebrow="Notifications"
      title="Notification preferences"
      introduction="Choose which messages you get by email or push. Required messages stay on. You can turn off the optional ones."
      emptyTitle={
        recoveryRequired
          ? "Finish your password reset"
          : state.status === "loading"
            ? "Loading notification preferences"
            : state.status === "error"
              ? "Notification preferences unavailable"
              : "Notification preferences"
      }
      emptyBody={
        recoveryRequired
          ? "You can change these after you reset your password."
          : (state.error ?? "Your choices apply to your group.")
      }
      facts={[
        [
          "Push notifications",
          permissionStatus === "granted" ? "Enabled" : "Not enabled",
        ],
        ["Optional messages", "Can be changed"],
        ["Required messages", "Always on"],
      ]}
    >
      {state.error ? (
        <ThemedText type="small" themeColor="accent" role="alert">
          {state.error}
        </ThemedText>
      ) : null}
      {state.status === "error" ? (
        <>
          <ActionButton label="Retry preferences" onPress={load} busy={false} />
        </>
      ) : null}

      {!recoveryRequired && session?.user.id ? (
        <>
          <View style={[styles.pushCard, { borderColor: theme.separator }]}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Push on this device
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.bodyCopy}>
              {permissionCopy}
            </ThemedText>
            {pushError ? (
              <ThemedText type="small" themeColor="accent" role="alert">
                {pushError}
              </ThemedText>
            ) : null}
            {permissionStatus !== "unsupported" &&
            (permissionStatus !== "granted" ||
              registrationStatus !== "registered") ? (
              <ActionButton
                label={
                  permissionStatus === "denied"
                    ? "Open notification settings"
                    : permissionStatus === "granted"
                      ? "Try again"
                      : "Enable push notifications"
                }
                onPress={() =>
                  permissionStatus === "denied"
                    ? void Linking.openSettings()
                    : retryPushRegistration()
                }
                busy={registrationPending}
              />
            ) : null}
            {permissionStatus === "unsupported" ? null : (
              <ThemedText type="small" themeColor="textSecondary">
                You can change this choice later in the device settings.
              </ThemedText>
            )}
          </View>

          <View style={styles.preferenceList}>
            {state.preferences.map((preference) => (
              <PreferenceRow
                key={preference.category}
                preference={preference}
                pending={state.pending}
                onChange={setPreference}
              />
            ))}
          </View>
        </>
      ) : null}
    </MemberDestinationScreen>
  );
}

function PreferenceRow({
  onChange,
  pending,
  preference,
}: Readonly<{
  onChange: (
    preference: MobileNotificationPreference,
    channel: MobileNotificationPreferenceChannel,
    enabled: boolean,
  ) => void;
  pending: {
    category: MobileNotificationPreference["category"];
    channel: MobileNotificationPreferenceChannel;
  } | null;
  preference: MobileNotificationPreference;
}>) {
  const theme = useTheme();
  const label = getMobileNotificationPreferenceLabel(preference.category);
  return (
    <View style={[styles.preferenceRow, { borderColor: theme.separator }]}>
      <View style={styles.preferenceCopy}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {preference.mandatory ? "Required" : "Optional"}
        </ThemedText>
      </View>
      <View style={styles.channelList}>
        {preference.emailAllowed ? (
          <ChannelSwitch
            accessibilityLabel={`Email for ${label}`}
            channel="email"
            disabled={
              !canChangeMobileNotificationPreference(preference, "email") ||
              pending !== null
            }
            enabled={preference.emailEnabled}
            pending={
              pending?.category === preference.category &&
              pending.channel === "email"
            }
            onChange={(enabled) => onChange(preference, "email", enabled)}
          />
        ) : null}
        {preference.pushAllowed ? (
          <ChannelSwitch
            accessibilityLabel={`Push for ${label}`}
            channel="push"
            disabled={
              !canChangeMobileNotificationPreference(preference, "push") ||
              pending !== null
            }
            enabled={preference.pushEnabled}
            pending={
              pending?.category === preference.category &&
              pending.channel === "push"
            }
            onChange={(enabled) => onChange(preference, "push", enabled)}
          />
        ) : null}
      </View>
    </View>
  );
}

function ChannelSwitch({
  accessibilityLabel,
  channel,
  disabled,
  enabled,
  onChange,
  pending,
}: Readonly<{
  accessibilityLabel: string;
  channel: MobileNotificationPreferenceChannel;
  disabled: boolean;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  pending: boolean;
}>) {
  const theme = useTheme();
  return (
    <View style={styles.channel}>
      <ThemedText type="small" themeColor="textSecondary">
        {channel === "email" ? "Email" : "Push"}
      </ThemedText>
      {pending ? <ActivityIndicator color={theme.accent} size="small" /> : null}
      <Switch
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled, disabled }}
        disabled={disabled || pending}
        onValueChange={onChange}
        value={enabled}
        trackColor={{ false: theme.separator, true: theme.accent }}
      />
    </View>
  );
}

function ActionButton({
  busy,
  label,
  onPress,
}: Readonly<{ busy: boolean; label: string; onPress: () => void }>) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        { borderColor: theme.accent },
        pressed && styles.pressed,
        busy && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={theme.accent} />
      ) : (
        <ThemedText type="smallBold" themeColor="accent">
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignSelf: "flex-start",
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  bodyCopy: { lineHeight: 24 },
  channel: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.one,
  },
  channelList: {
    alignItems: "flex-end",
    gap: Spacing.two,
  },
  disabled: { opacity: 0.6 },
  preferenceCopy: { flex: 1, gap: Spacing.half },
  preferenceList: { gap: 0 },
  preferenceRow: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: Spacing.three,
    minHeight: 76,
    paddingVertical: Spacing.two,
  },
  pressed: { opacity: 0.72 },
  pushCard: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    gap: Spacing.three,
    padding: Spacing.four,
  },
  sectionTitle: { fontSize: 24, lineHeight: 32 },
});
