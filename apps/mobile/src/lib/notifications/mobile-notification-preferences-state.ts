import type {
  MobileNotificationPreference,
  MobileNotificationPreferenceChannel,
  MobileNotificationPreferenceMutation,
} from "./mobile-notification-preferences-api";

export type MobileNotificationPreferencesState = Readonly<{
  status: "idle" | "loading" | "ready" | "error";
  preferences: readonly MobileNotificationPreference[];
  pending: Readonly<{
    category: MobileNotificationPreference["category"];
    channel: MobileNotificationPreferenceChannel;
  }> | null;
  error: string | null;
}>;

export type MobileNotificationPreferencesAction =
  | Readonly<{ type: "load" }>
  | Readonly<{
      type: "loaded";
      preferences: readonly MobileNotificationPreference[];
    }>
  | Readonly<{ type: "failed"; message: string }>
  | Readonly<{
      type: "save_started";
      category: MobileNotificationPreference["category"];
      channel: MobileNotificationPreferenceChannel;
    }>
  | Readonly<{
      type: "save_succeeded";
      mutation: MobileNotificationPreferenceMutation;
    }>
  | Readonly<{ type: "save_failed"; message: string }>;

export const initialMobileNotificationPreferencesState =
  Object.freeze<MobileNotificationPreferencesState>({
    error: null,
    pending: null,
    preferences: [],
    status: "idle",
  });

export const mobileNotificationPreferenceLabels = {
  invitation_delivery_failed: "Invitation delivery failed",
  membership_invitation: "Membership invitation",
  role_changed: "Role changed",
  round_awaiting_completion: "Round awaiting completion",
  round_cancelled: "Round cancelled",
  round_details_changed: "Round details changed",
  round_published: "Round published",
  rsvp_reminder: "RSVP reminder",
  results_published: "Results published",
  scoring_opened: "Scoring opened",
} as const;

export function getMobileNotificationPreferenceLabel(
  category: keyof typeof mobileNotificationPreferenceLabels,
) {
  return mobileNotificationPreferenceLabels[category];
}

export function canChangeMobileNotificationPreference(
  preference: MobileNotificationPreference,
  channel: MobileNotificationPreferenceChannel,
) {
  if (preference.mandatory) return false;
  return channel === "email" ? preference.emailAllowed : preference.pushAllowed;
}

export function applyMobileNotificationPreferenceMutation(
  preferences: readonly MobileNotificationPreference[],
  mutation: MobileNotificationPreferenceMutation,
) {
  return preferences.map((preference) =>
    preference.category !== mutation.category ||
    preference.membershipId !== mutation.membershipId
      ? preference
      : {
          ...preference,
          emailEnabled: mutation.emailEnabled,
          pushEnabled: mutation.pushEnabled,
          updatedAt: mutation.updatedAt,
          version: mutation.version,
        },
  );
}

export function mobileNotificationPreferencesReducer(
  state: MobileNotificationPreferencesState,
  action: MobileNotificationPreferencesAction,
): MobileNotificationPreferencesState {
  switch (action.type) {
    case "load":
      return { ...state, error: null, pending: null, status: "loading" };
    case "loaded":
      return {
        error: null,
        pending: null,
        preferences: action.preferences,
        status: "ready",
      };
    case "failed":
      return {
        ...state,
        error: action.message,
        pending: null,
        status: "error",
      };
    case "save_started":
      return {
        ...state,
        error: null,
        pending: { category: action.category, channel: action.channel },
      };
    case "save_succeeded":
      return {
        ...state,
        error: null,
        pending: null,
        preferences: applyMobileNotificationPreferenceMutation(
          state.preferences,
          action.mutation,
        ),
        status: "ready",
      };
    case "save_failed":
      return { ...state, error: action.message, pending: null };
  }
}
