import { Link, useNavigation, type Href } from "expo-router";
import Constants from "expo-constants";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { GroupDirectoryLink } from "@/components/group-directory-link";
import { MobileGolfStatsPanel } from "@/components/mobile-golf-stats-panel";
import { MemberDestinationScreen } from "@/components/member-destination-screen";
import { MobileSignOutButton } from "@/components/mobile-sign-out-button";
import { useMobileAuth } from "@/components/mobile-auth-provider";
import { useMobileFirstRun } from "@/components/mobile-first-run-provider";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import {
  mobileAccountEmailActions,
  type MobileAccountEmailActionResult,
} from "@/lib/auth/mobile-account-email-actions";
import {
  mobileSelfProfileApi,
  type MobileMutationOperationContext,
  type MobileSelfProfileData,
} from "@/lib/profile/mobile-self-profile-api";
import {
  getMobileMutationRetryContext,
  isMobileSelfProfileDraftDirty,
  mobileSelfProfileDraftFingerprint,
  normalizeMobileSelfProfileDraft,
  type MobileSelfProfileDraft,
} from "@/lib/profile/mobile-self-profile-state";
import { createMobileOperationId } from "@/lib/mobile-operation-id";
import { mobileRuntimeEnv } from "@/lib/runtime-env";
import { retireCurrentMobilePushDevice } from "@/lib/notifications/mobile-push-registration-default";
import { useTheme } from "@/hooks/use-theme";

export default function ProfileScreen() {
  const { recoveryRequired, session } = useMobileAuth();
  const firstRun = useMobileFirstRun();
  const currentEmail = session?.user.email ?? null;
  const [profile, setProfile] = useState<MobileSelfProfileData | null>(null);
  const [draft, setDraft] = useState<MobileSelfProfileDraft | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [saveState, setSaveState] = useState<"profile" | "handicap" | null>(
    null,
  );
  const [profileFeedback, setProfileFeedback] = useState<{
    status: "error" | "success";
    message: string;
    correlationId?: string;
    field?: string;
  } | null>(null);
  const [handicapDirty, setHandicapDirty] = useState(false);
  const requestSequence = useRef(0);
  const currentUserId = useRef<string | null>(null);
  const currentGeneration = useRef(0);
  const activeSaveToken = useRef<string | null>(null);
  const profileRetryContext = useRef<
    (MobileMutationOperationContext & { fingerprint: string }) | null
  >(null);
  const profileRetryFingerprint = useRef<string | null>(null);
  const [initialDraft, setInitialDraft] =
    useState<MobileSelfProfileDraft | null>(null);
  const navigation = useNavigation();
  const isCurrentMutation = useCallback(
    (userId: string | null, generation: number) =>
      userId === currentUserId.current &&
      generation === currentGeneration.current,
    [],
  );
  const captureGeneration = useCallback(() => currentGeneration.current, []);

  useEffect(() => {
    const userId = session?.user.id;
    const sequence = ++requestSequence.current;
    currentGeneration.current += 1;
    currentUserId.current = userId ?? null;
    activeSaveToken.current = null;
    profileRetryContext.current = null;
    profileRetryFingerprint.current = null;
    queueMicrotask(() => {
      if (sequence !== requestSequence.current) return;
      setProfile(null);
      setDraft(null);
      setInitialDraft(null);
      setSaveState(null);
      setProfileFeedback(null);
      setHandicapDirty(false);
      setLoadState(userId && !recoveryRequired ? "loading" : "ready");
    });
    if (!userId || recoveryRequired) return;

    void mobileSelfProfileApi.resolve().then((result) => {
      if (sequence !== requestSequence.current) return;
      if (!result.ok) {
        setProfile(null);
        setDraft(null);
        setInitialDraft(null);
        setHandicapDirty(false);
        setLoadState("error");
        return;
      }
      setProfile(result.data);
      setDraft(result.data.draft);
      setInitialDraft(result.data.draft);
      setLoadState("ready");
    });
  }, [recoveryRequired, session?.user.id]);

  const sessionProfile =
    !recoveryRequired && profile && profile.userId === session?.user.id
      ? profile
      : null;
  const sessionDraft = sessionProfile ? draft : null;
  const profileDraftFingerprint = useMemo(() => {
    if (!sessionDraft) return null;
    try {
      return mobileSelfProfileDraftFingerprint(
        normalizeMobileSelfProfileDraft(sessionDraft),
      );
    } catch {
      return null;
    }
  }, [sessionDraft]);
  const profileFingerprint = useMemo(() => {
    if (!profileDraftFingerprint || !sessionProfile) return null;
    return JSON.stringify({
      draft: profileDraftFingerprint,
      profileVersion: sessionProfile.profileVersion,
      contactVersion: sessionProfile.contactVersion,
      membershipVersion: sessionProfile.membershipVersion,
    });
  }, [profileDraftFingerprint, sessionProfile]);

  useEffect(() => {
    if (
      profileRetryFingerprint.current !== null &&
      profileRetryFingerprint.current !== profileFingerprint
    ) {
      profileRetryContext.current = null;
    }
    profileRetryFingerprint.current = profileFingerprint;
  }, [profileFingerprint]);

  const profileDirty = useMemo(() => {
    if (!sessionDraft || !initialDraft) return false;
    try {
      return isMobileSelfProfileDraftDirty(
        initialDraft,
        normalizeMobileSelfProfileDraft(sessionDraft),
      );
    } catch {
      return true;
    }
  }, [initialDraft, sessionDraft]);

  const dirty = useMemo(() => {
    return profileDirty || handicapDirty;
  }, [handicapDirty, profileDirty]);

  const confirmSignOut = useCallback(() => {
    if (!dirty) return true;
    return new Promise<boolean>((resolve) => {
      Alert.alert(
        "Discard profile changes?",
        "Sign out and lose your unsaved changes?",
        [
          {
            text: "Keep editing",
            style: "cancel",
            onPress: () => resolve(false),
          },
          {
            text: "Sign out",
            style: "destructive",
            onPress: () => resolve(true),
          },
        ],
      );
    });
  }, [dirty]);

  useEffect(() => {
    if (!dirty && !saveState) return;
    const subscription = navigation.addListener("beforeRemove", (event) => {
      event.preventDefault();
      if (saveState) {
        Alert.alert(
          "Save in progress",
          "Wait for the profile save to finish before leaving.",
          [{ text: "Stay", style: "cancel" }],
        );
        return;
      }
      Alert.alert(
        "Discard profile changes?",
        "Your unsaved changes will be lost.",
        [
          { text: "Keep editing", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => navigation.dispatch(event.data.action),
          },
        ],
      );
    });
    return subscription;
  }, [dirty, navigation, saveState]);

  useEffect(() => {
    if (Platform.OS !== "web" || (!dirty && !saveState)) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, saveState]);

  const updateDraft = <K extends keyof MobileSelfProfileDraft>(
    field: K,
    value: MobileSelfProfileDraft[K],
  ) =>
    setDraft((current) => (current ? { ...current, [field]: value } : current));

  const saveProfile = async () => {
    if (!sessionProfile || !sessionDraft || saveState) return;
    const sequence = requestSequence.current;
    const userId = currentUserId.current;
    const generation = captureGeneration();
    const saveToken = createMobileOperationId();
    activeSaveToken.current = saveToken;
    const operationContext = getMobileMutationRetryContext(
      profileRetryContext.current,
      profileFingerprint ?? "",
      () => ({
        correlationId: createMobileOperationId(),
        operationId: createMobileOperationId(),
      }),
    );
    profileRetryContext.current = operationContext;
    setSaveState("profile");
    setProfileFeedback(null);
    const result = await mobileSelfProfileApi.update(
      {
        ...sessionDraft,
        expectedProfileVersion: sessionProfile.profileVersion,
        expectedContactVersion: sessionProfile.contactVersion,
        expectedMembershipVersion: sessionProfile.membershipVersion,
      },
      operationContext,
    );
    if (
      sequence !== requestSequence.current ||
      currentUserId.current !== userId ||
      generation !== currentGeneration.current ||
      activeSaveToken.current !== saveToken
    ) {
      return;
    }
    activeSaveToken.current = null;
    setSaveState(null);
    if (!result.ok) {
      setProfileFeedback({
        status: "error",
        correlationId: result.correlationId,
        message: result.message,
        field: result.field,
      });
      if (result.code !== "unavailable") profileRetryContext.current = null;
      if (result.code === "stale") {
        Alert.alert(
          "Profile changed",
          supportMessage(result.message, result.correlationId),
          [{ text: "Reload", onPress: () => void reloadProfile() }],
        );
      }
      return;
    }
    profileRetryContext.current = null;
    setProfileFeedback({ status: "success", message: "Profile saved." });
    setProfile(result.data);
    setDraft(result.data.draft);
    setInitialDraft(result.data.draft);
  };

  const reloadProfile = async () => {
    const sequence = ++requestSequence.current;
    currentGeneration.current += 1;
    currentUserId.current = session?.user.id ?? null;
    activeSaveToken.current = null;
    profileRetryContext.current = null;
    setSaveState(null);
    setLoadState("loading");
    const result = await mobileSelfProfileApi.resolve();
    if (sequence !== requestSequence.current) return;
    if (!result.ok) {
      setProfile(null);
      setDraft(null);
      setInitialDraft(null);
      setHandicapDirty(false);
      setLoadState("error");
      return;
    }
    setProfile(result.data);
    setDraft(result.data.draft);
    setInitialDraft(result.data.draft);
    setLoadState("ready");
  };

  const facts = [
    ["Account", recoveryRequired ? "Password recovery" : "Signed in"],
    [
      "Name",
      sessionProfile
        ? `${sessionProfile.draft.firstName} ${sessionProfile.draft.lastName}`
        : firstRun.status === "complete"
          ? `${firstRun.profile.firstName} ${firstRun.profile.lastName}`
          : "Not loaded yet",
    ],
    ["Group", sessionProfile?.groupName ?? "Not loaded yet"],
    ["Group time zone", sessionProfile?.groupTimeZone ?? "Not loaded yet"],
    [
      "Role / status",
      sessionProfile
        ? `${sessionProfile.role} · ${sessionProfile.status}`
        : "Not loaded yet",
    ],
  ] as const;

  return (
    <MemberDestinationScreen
      eyebrow="Profile"
      title="Your profile and golf details"
      introduction="Update what your group sees, keep your golf details current, and manage your account e-mail separately."
      emptyTitle={
        recoveryRequired
          ? "Finish your password reset"
          : loadState === "loading"
            ? "Loading your profile"
            : loadState === "error"
              ? "We couldn't load your profile"
              : "Your profile is ready"
      }
      emptyBody={
        recoveryRequired
          ? "Your profile opens after you choose a new password."
          : loadState === "error"
            ? "Check your connection and try again."
            : "Your role and status can't be changed here. Notification preferences are separate."
      }
      facts={facts}
    >
      <GroupDirectoryLink />
      {!recoveryRequired ? (
        <Link href={"/notification-preferences" as Href} asChild>
          <Pressable
            accessibilityLabel="Manage notification preferences"
            accessibilityRole="link"
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold" themeColor="accent">
              Manage notification preferences
            </ThemedText>
          </Pressable>
        </Link>
      ) : null}
      {!recoveryRequired && loadState === "error" ? (
        <ActionButton
          label="Retry profile"
          onPress={() => void reloadProfile()}
          busy={false}
        />
      ) : null}
      {!recoveryRequired && sessionProfile && sessionDraft ? (
        <>
          <ProfileEditor
            draft={sessionDraft}
            onChange={updateDraft}
            onSave={() => void saveProfile()}
            busy={saveState === "profile"}
            dirty={profileDirty}
            disabled={loadState === "loading" || saveState !== null}
            feedback={profileFeedback}
          />
          <HandicapEditor
            key={`${sessionProfile.membershipVersion}-${sessionProfile.handicapRecordId ?? "none"}`}
            profile={sessionProfile}
            onSaved={(next) => {
              setProfile((current) => {
                if (!current || current.userId !== next.userId) return current;
                return {
                  ...current,
                  membershipVersion: next.membershipVersion,
                  handicapRecordId: next.handicapRecordId,
                  handicapId: next.handicapId,
                  handicap: next.handicap,
                  handicapSource: next.handicapSource,
                  handicapAsOf: next.handicapAsOf,
                  handicapCreatedAt: next.handicapCreatedAt,
                };
              });
            }}
            busy={saveState === "handicap"}
            disabled={
              loadState === "loading" ||
              (saveState !== null && saveState !== "handicap")
            }
            setBusy={(busy) => setSaveState(busy ? "handicap" : null)}
            onDirtyChange={setHandicapDirty}
            isCurrentMutation={isCurrentMutation}
            captureGeneration={captureGeneration}
            onReload={() => void reloadProfile()}
          />
          <MobileGolfStatsPanel />
        </>
      ) : null}
      {!recoveryRequired ? (
        <AccountEmailSection
          key={currentEmail ?? "no-session-email"}
          currentEmail={currentEmail}
        />
      ) : null}
      <ProfileAboutSection />
      <MobileSignOutButton
        disabled={saveState !== null}
        beforeSignOut={async () => {
          if (!(await confirmSignOut())) return false;
          if (session?.user.id) {
            try {
              const retirement = await retireCurrentMobilePushDevice(
                session.user.id,
              );
              if (retirement.status === "unavailable") {
                Alert.alert(
                  "Connect to sign out",
                  "We couldn't turn off notifications on this device. Reconnect and try signing out again.",
                );
                return false;
              }
            } catch {
              Alert.alert(
                "Connect to sign out",
                "We couldn't turn off notifications on this device. Reconnect and try signing out again.",
              );
              return false;
            }
          }
          return true;
        }}
      />
    </MemberDestinationScreen>
  );
}

function ProfileEditor({
  draft,
  onChange,
  onSave,
  busy,
  dirty,
  disabled,
  feedback,
}: Readonly<{
  draft: MobileSelfProfileDraft;
  onChange: <K extends keyof MobileSelfProfileDraft>(
    field: K,
    value: MobileSelfProfileDraft[K],
  ) => void;
  onSave: () => void;
  busy: boolean;
  dirty: boolean;
  disabled: boolean;
  feedback: {
    status: "error" | "success";
    message: string;
    correlationId?: string;
    field?: string;
  } | null;
}>) {
  const theme = useTheme();
  const firstInvalidInputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (feedback?.status !== "error" || !feedback.field) return;
    const handle = setTimeout(() => firstInvalidInputRef.current?.focus(), 0);
    return () => clearTimeout(handle);
  }, [feedback]);
  const assignInvalidInput = useCallback((input: TextInput | null) => {
    firstInvalidInputRef.current = input;
  }, []);
  const inputFor = (field: string) =>
    feedback?.status === "error" && feedback.field === field
      ? assignInvalidInput
      : undefined;
  return (
    <View style={[styles.section, { borderColor: theme.separator }]}>
      <SectionHeading
        title="Member profile"
        body="Changes save to your profile. Turn on visibility to show a detail in the group directory."
      />
      <Subheading text="Name" />
      <Field
        disabled={disabled || busy}
        invalid={feedback?.field === "firstName"}
        inputRef={inputFor("firstName")}
        label="First name"
        value={draft.firstName}
        onChangeText={(value) => onChange("firstName", value)}
      />
      <Field
        disabled={disabled || busy}
        invalid={feedback?.field === "lastName"}
        inputRef={inputFor("lastName")}
        label="Last name"
        value={draft.lastName}
        onChangeText={(value) => onChange("lastName", value)}
      />
      <View style={styles.fieldRow}>
        <View style={styles.halfField}>
          <Field
            disabled={disabled || busy}
            invalid={feedback?.field === "spouseFirstName"}
            inputRef={inputFor("spouseFirstName")}
            label="Spouse first name"
            value={draft.spouseFirstName ?? ""}
            onChangeText={(value) => onChange("spouseFirstName", value)}
          />
        </View>
        <View style={styles.halfField}>
          <Field
            disabled={disabled || busy}
            invalid={feedback?.field === "spouseLastName"}
            inputRef={inputFor("spouseLastName")}
            label="Spouse last name"
            value={draft.spouseLastName ?? ""}
            onChangeText={(value) => onChange("spouseLastName", value)}
          />
        </View>
      </View>
      <Subheading text="Golf preference" />
      <SelectField
        label="Preferred tee"
        value={draft.teeLocation}
        options={["pro", "back", "middle", "front"]}
        onChange={(value) =>
          onChange(
            "teeLocation",
            value as MobileSelfProfileDraft["teeLocation"],
          )
        }
        disabled={disabled || busy}
      />
      <Subheading text="Contact" />
      <FieldWithVisibility
        disabled={disabled || busy}
        invalid={feedback?.field === "secondaryEmail"}
        inputRef={inputFor("secondaryEmail")}
        label="Secondary e-mail"
        value={draft.secondaryEmail ?? ""}
        visible={draft.secondaryEmailVisible}
        onChangeText={(value) => onChange("secondaryEmail", value)}
        onToggle={() =>
          onChange("secondaryEmailVisible", !draft.secondaryEmailVisible)
        }
        keyboardType="email-address"
      />
      <FieldWithVisibility
        disabled={disabled || busy}
        invalid={feedback?.field === "homePhone"}
        inputRef={inputFor("homePhone")}
        label="Home phone"
        value={draft.homePhone ?? ""}
        visible={draft.homePhoneVisible}
        onChangeText={(value) => onChange("homePhone", value)}
        onToggle={() => onChange("homePhoneVisible", !draft.homePhoneVisible)}
        keyboardType="phone-pad"
      />
      <FieldWithVisibility
        disabled={disabled || busy}
        invalid={feedback?.field === "workPhone"}
        inputRef={inputFor("workPhone")}
        label="Work phone"
        value={draft.workPhone ?? ""}
        visible={draft.workPhoneVisible}
        onChangeText={(value) => onChange("workPhone", value)}
        onToggle={() => onChange("workPhoneVisible", !draft.workPhoneVisible)}
        keyboardType="phone-pad"
      />
      <FieldWithVisibility
        disabled={disabled || busy}
        invalid={feedback?.field === "mobilePhone"}
        inputRef={inputFor("mobilePhone")}
        label="Mobile phone"
        value={draft.mobilePhone ?? ""}
        visible={draft.mobilePhoneVisible}
        onChangeText={(value) => onChange("mobilePhone", value)}
        onToggle={() =>
          onChange("mobilePhoneVisible", !draft.mobilePhoneVisible)
        }
        keyboardType="phone-pad"
      />
      <Subheading text="Postal address" />
      <Field
        disabled={disabled || busy}
        invalid={feedback?.field === "addressLine1"}
        inputRef={inputFor("addressLine1")}
        label="Address line 1"
        value={draft.addressLine1 ?? ""}
        onChangeText={(value) => onChange("addressLine1", value)}
      />
      <Field
        disabled={disabled || busy}
        invalid={feedback?.field === "addressLine2"}
        inputRef={inputFor("addressLine2")}
        label="Address line 2"
        value={draft.addressLine2 ?? ""}
        onChangeText={(value) => onChange("addressLine2", value)}
      />
      <View style={styles.fieldRow}>
        <View style={styles.halfField}>
          <Field
            disabled={disabled || busy}
            invalid={feedback?.field === "city"}
            inputRef={inputFor("city")}
            label="City"
            value={draft.city ?? ""}
            onChangeText={(value) => onChange("city", value)}
          />
        </View>
        <View style={styles.halfField}>
          <Field
            disabled={disabled || busy}
            invalid={feedback?.field === "stateRegion"}
            inputRef={inputFor("stateRegion")}
            label="State / region"
            value={draft.stateRegion ?? ""}
            onChangeText={(value) => onChange("stateRegion", value)}
          />
        </View>
      </View>
      <View style={styles.fieldRow}>
        <View style={styles.halfField}>
          <Field
            disabled={disabled || busy}
            invalid={feedback?.field === "postalCode"}
            inputRef={inputFor("postalCode")}
            label="Postal code"
            value={draft.postalCode ?? ""}
            onChangeText={(value) => onChange("postalCode", value)}
          />
        </View>
        <View style={styles.halfField}>
          <Field
            disabled={disabled || busy}
            invalid={feedback?.field === "country"}
            inputRef={inputFor("country")}
            label="Country"
            value={draft.country ?? ""}
            onChangeText={(value) => onChange("country", value)}
          />
        </View>
      </View>
      <Subheading text="Directory visibility" />
      <VisibilityToggle
        disabled={disabled || busy}
        label="List address in directory"
        checked={draft.addressListed}
        onPress={() => onChange("addressListed", !draft.addressListed)}
      />
      {feedback ? (
        <>
          <ThemedText
            type="small"
            themeColor={
              feedback.status === "error" ? "accent" : "textSecondary"
            }
            role={feedback.status === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </ThemedText>
          {feedback.status === "error" && feedback.correlationId ? (
            <SupportReference correlationId={feedback.correlationId} />
          ) : null}
        </>
      ) : null}
      <ActionButton
        label={busy ? "Saving profile…" : "Save profile"}
        onPress={onSave}
        busy={busy}
        disabled={disabled || !dirty}
      />
    </View>
  );
}

function HandicapEditor({
  profile,
  onSaved,
  busy,
  setBusy,
  onDirtyChange,
  disabled,
  isCurrentMutation,
  captureGeneration,
  onReload,
}: Readonly<{
  profile: MobileSelfProfileData;
  onSaved: (profile: MobileSelfProfileData) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  disabled: boolean;
  isCurrentMutation: (userId: string | null, generation: number) => boolean;
  captureGeneration: () => number;
  onReload: () => void;
}>) {
  const theme = useTheme();
  const [handicapId, setHandicapId] = useState(profile.handicapId ?? "");
  const [handicap, setHandicap] = useState(profile.handicap ?? "");
  const [asOf, setAsOf] = useState(
    profile.handicapAsOf ?? new Date().toISOString().slice(0, 10),
  );
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [feedback, setFeedback] = useState<{
    correlationId?: string;
    message: string;
  } | null>(null);
  const activeHandicapToken = useRef<string | null>(null);
  const handicapRetryContext = useRef<
    (MobileMutationOperationContext & { fingerprint: string }) | null
  >(null);
  const handicapFingerprint = useMemo(
    () =>
      JSON.stringify({
        handicapId: handicapId.trim(),
        handicap: handicap.trim(),
        asOf: asOf.trim(),
        reason: reason.trim(),
        confirmed,
        expectedMembershipVersion: profile.membershipVersion,
      }),
    [asOf, confirmed, handicap, handicapId, profile.membershipVersion, reason],
  );

  useEffect(() => {
    if (
      handicapRetryContext.current &&
      handicapRetryContext.current.fingerprint !== handicapFingerprint
    ) {
      handicapRetryContext.current = null;
    }
  }, [handicapFingerprint]);

  useEffect(() => {
    onDirtyChange(
      handicapId !== (profile.handicapId ?? "") ||
        handicap !== (profile.handicap ?? "") ||
        asOf !==
          (profile.handicapAsOf ?? new Date().toISOString().slice(0, 10)) ||
        reason.trim() !== "" ||
        confirmed,
    );
  }, [
    asOf,
    confirmed,
    handicap,
    handicapId,
    onDirtyChange,
    profile.handicap,
    profile.handicapAsOf,
    profile.handicapId,
    reason,
  ]);

  const save = async () => {
    if (busy || disabled) return;
    const generation = captureGeneration();
    const userId = profile.userId;
    const token = createMobileOperationId();
    activeHandicapToken.current = token;
    const operationContext = getMobileMutationRetryContext(
      handicapRetryContext.current,
      handicapFingerprint,
      () => ({
        correlationId: createMobileOperationId(),
        operationId: createMobileOperationId(),
      }),
    );
    handicapRetryContext.current = operationContext;
    setFeedback(null);
    setBusy(true);
    const result = await mobileSelfProfileApi.setHandicap(
      {
        handicapId,
        handicap,
        asOf,
        expectedMembershipVersion: profile.membershipVersion,
        confirmed,
        reason,
      },
      operationContext,
    );
    if (
      !isCurrentMutation(userId, generation) ||
      activeHandicapToken.current !== token
    ) {
      return;
    }
    activeHandicapToken.current = null;
    setBusy(false);
    if (!result.ok) {
      setFeedback({
        correlationId: result.correlationId,
        message: result.message,
      });
      if (result.code === "stale") {
        Alert.alert(
          "Handicap changed",
          supportMessage(result.message, result.correlationId),
          [
            { text: "Keep editing", style: "cancel" },
            { text: "Reload latest", onPress: onReload },
          ],
        );
      } else {
        Alert.alert(
          "Handicap not saved",
          supportMessage(result.message, result.correlationId),
        );
      }
      if (result.code !== "unavailable") handicapRetryContext.current = null;
      return;
    }
    handicapRetryContext.current = null;
    setFeedback(null);
    Alert.alert("Handicap saved", "Your new handicap is saved.");
    onSaved(result.data);
    setReason("");
    setConfirmed(false);
  };

  return (
    <View style={[styles.section, { borderColor: theme.separator }]}>
      <SectionHeading
        title="Current handicap"
        body="Enter a new handicap below to add it to your history. The source and date stay visible."
      />
      <View style={styles.currentHandicap}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          CURRENT VALUE
        </ThemedText>
        <ThemedText>
          {profile.handicap === null
            ? "Not recorded"
            : `${profile.handicap}${profile.handicapId ? ` · ${profile.handicapId}` : ""}`}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {profile.handicapSource
            ? `${profile.handicapSource} · ${profile.handicapAsOf ?? "date unavailable"}`
            : "No current source"}
        </ThemedText>
      </View>
      <Field
        disabled={disabled || busy}
        label="Handicap ID"
        value={handicapId}
        onChangeText={setHandicapId}
      />
      <Field
        disabled={disabled || busy}
        label="New handicap"
        value={handicap}
        onChangeText={setHandicap}
        keyboardType="decimal-pad"
      />
      <Field
        disabled={disabled || busy}
        label="Date (YYYY-MM-DD)"
        value={asOf}
        onChangeText={setAsOf}
      />
      <Field
        disabled={disabled || busy}
        label="Reason (required)"
        value={reason}
        onChangeText={setReason}
        multiline
      />
      <VisibilityToggle
        disabled={disabled || busy}
        label="I confirm this handicap is correct"
        checked={confirmed}
        onPress={() => setConfirmed((value) => !value)}
      />
      {feedback ? (
        <>
          <ThemedText type="small" themeColor="accent" role="alert">
            {feedback.message}
          </ThemedText>
          {feedback.correlationId ? (
            <SupportReference correlationId={feedback.correlationId} />
          ) : null}
        </>
      ) : null}
      <ActionButton
        label={busy ? "Saving handicap…" : "Save handicap"}
        onPress={() => void save()}
        busy={busy}
        disabled={disabled || !confirmed || reason.trim() === ""}
      />
    </View>
  );
}

function SectionHeading({
  title,
  body,
}: Readonly<{ title: string; body: string }>) {
  return (
    <View style={styles.sectionHeading}>
      <ThemedText type="subtitle">{title}</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.bodyCopy}>
        {body}
      </ThemedText>
    </View>
  );
}

function Subheading({ text }: Readonly<{ text: string }>) {
  return (
    <ThemedText type="smallBold" themeColor="accent" style={styles.subheading}>
      {text.toUpperCase()}
    </ThemedText>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  multiline,
  disabled,
  invalid = false,
  inputRef,
}: Readonly<{
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: "default" | "email-address" | "phone-pad" | "decimal-pad";
  multiline?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  inputRef?: Ref<TextInput>;
}>) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        accessibilityHint={invalid ? "Check this value." : undefined}
        aria-invalid={invalid}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
        autoCorrect={false}
        editable={!disabled}
        ref={inputRef}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          {
            borderColor: invalid ? theme.accent : theme.textSecondary,
            color: theme.text,
          },
        ]}
        value={value}
      />
    </View>
  );
}

function FieldWithVisibility({
  label,
  value,
  visible,
  onChangeText,
  onToggle,
  keyboardType,
  disabled,
  invalid,
  inputRef,
}: Readonly<{
  label: string;
  value: string;
  visible: boolean;
  onChangeText: (value: string) => void;
  onToggle: () => void;
  keyboardType?: "email-address" | "phone-pad";
  disabled?: boolean;
  invalid?: boolean;
  inputRef?: Ref<TextInput>;
}>) {
  return (
    <>
      <Field
        disabled={disabled}
        invalid={invalid}
        inputRef={inputRef}
        label={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
      />
      <VisibilityToggle
        disabled={disabled}
        label={`List ${label.toLowerCase()} in directory`}
        checked={visible}
        onPress={onToggle}
      />
    </>
  );
}

function VisibilityToggle({
  label,
  checked,
  onPress,
  disabled,
}: Readonly<{
  label: string;
  checked: boolean;
  onPress: () => void;
  disabled?: boolean;
}>) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      aria-checked={checked}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
    >
      <ThemedText type="smallBold" themeColor="accent">
        {checked ? "✓ " : "☐ "}
        {label}
      </ThemedText>
    </Pressable>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
}: Readonly<{
  label: string;
  value: string | null;
  options: readonly string[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
}>) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View style={styles.optionRow}>
        {[...options, "none"].map((option) => {
          const selected =
            option === "none" ? value === null : value === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              aria-checked={selected}
              disabled={disabled}
              onPress={() => onChange(option === "none" ? null : option)}
              style={({ pressed }) => [
                styles.option,
                {
                  borderColor: selected ? theme.accent : theme.textSecondary,
                  backgroundColor: selected ? theme.accent : "transparent",
                },
                pressed && styles.pressed,
              ]}
            >
              <ThemedText
                type="small"
                themeColor={selected ? "background" : "text"}
              >
                {option === "none"
                  ? "Not set"
                  : option[0]?.toUpperCase() + option.slice(1)}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  busy,
  disabled,
}: Readonly<{
  label: string;
  onPress: () => void;
  busy: boolean;
  disabled?: boolean;
}>) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: theme.accent },
        pressed && styles.pressed,
        (disabled || busy) && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          accessibilityElementsHidden
          color={theme.background}
        />
      ) : (
        <ThemedText type="smallBold" style={{ color: theme.background }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
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
    setResult(
      await mobileAccountEmailActions.requestEmailChange(
        currentEmail,
        nextEmail,
        confirmed,
      ),
    );
    setBusy(null);
  };
  const refresh = async () => {
    if (busy || !currentEmail) return;
    setBusy("refresh");
    setResult(await mobileAccountEmailActions.refreshSession());
    setBusy(null);
  };
  return (
    <View style={[styles.section, { borderColor: theme.separator }]}>
      <SectionHeading
        title="Account e-mail"
        body="This is the address you sign in with, and where we send password recovery and app notifications. Changes need e-mail verification."
      />
      <View style={styles.currentEmail}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          CURRENT ACCOUNT E-MAIL
        </ThemedText>
        <ThemedText accessibilityLabel="Current account e-mail">
          {currentEmail ?? "Unavailable right now"}
        </ThemedText>
      </View>
      <Field
        label="New account e-mail"
        value={nextEmail}
        onChangeText={setNextEmail}
        keyboardType="email-address"
      />
      <VisibilityToggle
        label="I understand I'll need to verify the new address"
        checked={confirmed}
        onPress={() => setConfirmed((value) => !value)}
      />
      {result?.field ? (
        <>
          <ThemedText type="small" themeColor="accent" role="alert">
            {result.message}
          </ThemedText>
          {result.status === "error" && result.correlationId ? (
            <SupportReference correlationId={result.correlationId} />
          ) : null}
        </>
      ) : null}
      {result && !result.field ? (
        <>
          <ThemedText
            type="small"
            themeColor={result.status === "error" ? "accent" : "textSecondary"}
            role={result.status === "error" ? "alert" : "status"}
          >
            {result.message}
          </ThemedText>
          {result.status === "error" && result.correlationId ? (
            <SupportReference correlationId={result.correlationId} />
          ) : null}
        </>
      ) : null}
      <ActionButton
        label="Send confirmation links"
        onPress={() => void submit()}
        busy={busy === "change"}
        disabled={busy !== null || currentEmail === null}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh account e-mail status"
        accessibilityState={{
          busy: busy === "refresh",
          disabled: busy !== null || currentEmail === null,
        }}
        disabled={busy !== null || currentEmail === null}
        onPress={() => void refresh()}
        style={({ pressed }) => [
          styles.secondaryButton,
          pressed && styles.pressed,
        ]}
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

function SupportReference({
  correlationId,
}: Readonly<{ correlationId: string }>) {
  return (
    <ThemedText
      accessibilityLabel={`Support reference ${correlationId}`}
      selectable
      type="small"
      themeColor="textSecondary"
    >
      Support reference: {correlationId}
    </ThemedText>
  );
}

function supportMessage(message: string, correlationId?: string) {
  return correlationId
    ? `${message}\n\nSupport reference: ${correlationId}`
    : message;
}

const profileAboutLinks = [
  ["Help center", "/help"],
  ["Contact support", "/support"],
  ["Send feedback", "/feedback"],
  ["Privacy Policy", "/privacy"],
  ["Privacy requests", "/account/privacy"],
  ["Terms of Use", "/terms"],
] as const;

function ProfileAboutSection() {
  const theme = useTheme();
  const appVersion = Constants.expoConfig?.version ?? "Unavailable";
  const appBuild =
    Platform.OS === "ios"
      ? (Constants.platform?.ios?.buildNumber ??
        Constants.expoConfig?.ios?.buildNumber ??
        null)
      : Platform.OS === "android"
        ? (Constants.platform?.android?.versionCode?.toString() ??
          Constants.expoConfig?.android?.versionCode?.toString() ??
          null)
        : null;

  return (
    <View style={[styles.section, { borderColor: theme.separator }]}>
      <SectionHeading
        title="About GreenRoster"
        body="Get help, contact support, send feedback, or read the current legal documents. These open in your browser."
      />
      <View
        accessibilityLabel="GreenRoster app version and build"
        style={styles.appMetadata}
      >
        <View style={styles.metadataRow}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            APP VERSION
          </ThemedText>
          <ThemedText>{appVersion}</ThemedText>
        </View>
        <View style={styles.metadataRow}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            BUILD
          </ThemedText>
          <ThemedText>{appBuild ?? "Unavailable"}</ThemedText>
        </View>
      </View>
      <View style={styles.aboutLinks}>
        {profileAboutLinks.map(([label, path]) => (
          <Pressable
            key={path}
            accessibilityHint="Opens this GreenRoster page in your browser."
            accessibilityLabel={label}
            accessibilityRole="link"
            onPress={() =>
              void Linking.openURL(`${mobileRuntimeEnv.appUrl}${path}`)
            }
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold" themeColor="accent">
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.four,
    padding: Spacing.four,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  sectionHeading: { gap: Spacing.three },
  subheading: { letterSpacing: 1.2, marginTop: Spacing.two },
  bodyCopy: { lineHeight: 24 },
  field: { gap: Spacing.two },
  toggle: {
    minHeight: Platform.OS === "android" ? 48 : 44,
    justifyContent: "center",
  },
  fieldRow: { flexDirection: "row", gap: Spacing.three },
  halfField: { flex: 1, minWidth: 0 },
  input: {
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: "top",
    paddingTop: Spacing.three,
  },
  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  option: {
    minHeight: Platform.OS === "android" ? 48 : 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
  },
  secondaryButton: { minHeight: 48, justifyContent: "center" },
  currentHandicap: { gap: Spacing.two },
  currentEmail: { gap: Spacing.two },
  appMetadata: { gap: Spacing.two },
  metadataRow: { gap: Spacing.one },
  aboutLinks: { gap: Spacing.one },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.6 },
});
