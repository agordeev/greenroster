import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

export type MobileAuthStatus =
  "checking" | "signed-out" | "signed-in" | "error";

export type MobileAuthState = Readonly<{
  recoveryRequired: boolean;
  session: Session | null;
  status: MobileAuthStatus;
}>;

export const initialMobileAuthState: MobileAuthState = {
  recoveryRequired: false,
  session: null,
  status: "checking",
};

export function restoredMobileAuthState(
  session: Session | null,
  recoveryRequired: boolean,
): MobileAuthState {
  return {
    recoveryRequired: Boolean(session && recoveryRequired),
    session,
    status: session ? "signed-in" : "signed-out",
  };
}

export function mobileAuthStateForEvent(
  current: MobileAuthState,
  event: AuthChangeEvent,
  session: Session | null,
): MobileAuthState {
  if (event === "SIGNED_OUT" || !session) {
    return restoredMobileAuthState(null, false);
  }

  return {
    recoveryRequired: event === "PASSWORD_RECOVERY" || current.recoveryRequired,
    session,
    status: "signed-in",
  };
}
