import * as Linking from "expo-linking";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";

import { parseMobileAuthCallback } from "@/lib/auth/mobile-auth-callback";
import {
  initialMobileAuthState,
  mobileAuthStateForEvent,
  restoredMobileAuthState,
  type MobileAuthState,
} from "@/lib/auth/mobile-auth-state";
import { mobileSupabase } from "@/lib/auth/mobile-supabase";
import { recoveryRequirementStorage } from "@/lib/auth/secure-session-storage";

type MobileAuthContextValue = MobileAuthState & {
  retrySession(): Promise<void>;
};

const MobileAuthContext = createContext<MobileAuthContextValue | null>(null);

export function MobileAuthProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const callbackUrl = Linking.useURL();
  const handledCallback = useRef<string | null>(null);
  const authEventQueue = useRef<Promise<void>>(Promise.resolve());
  const [state, setState] = useState<MobileAuthState>(initialMobileAuthState);

  const retrySession = useCallback(async () => {
    setState((current) => ({ ...current, status: "checking" }));
    authEventQueue.current = authEventQueue.current.then(async () => {
      try {
        const [{ data, error }, recoveryRequired] = await Promise.all([
          mobileSupabase.auth.getSession(),
          recoveryRequirementStorage.isRequired(),
        ]);

        if (error) {
          setState({ recoveryRequired: false, session: null, status: "error" });
          return;
        }

        if (!data.session && recoveryRequired) {
          await recoveryRequirementStorage.clear();
        }

        setState(restoredMobileAuthState(data.session, recoveryRequired));
      } catch {
        setState({ recoveryRequired: false, session: null, status: "error" });
      }
    });
    await authEventQueue.current;
  }, []);

  useEffect(() => {
    let active = true;
    authEventQueue.current = Promise.all([
      mobileSupabase.auth.getSession(),
      recoveryRequirementStorage.isRequired(),
    ])
      .then(async ([{ data, error }, recoveryRequired]) => {
        if (!active || handledCallback.current) return;

        if (error) {
          setState({ recoveryRequired: false, session: null, status: "error" });
          return;
        }

        if (!data.session && recoveryRequired) {
          await recoveryRequirementStorage.clear();
        }

        if (!active || handledCallback.current) return;
        setState(restoredMobileAuthState(data.session, recoveryRequired));
      })
      .catch(() => {
        if (!active || handledCallback.current) return;
        setState({ recoveryRequired: false, session: null, status: "error" });
      });

    const { data } = mobileSupabase.auth.onAuthStateChange((event, session) => {
      authEventQueue.current = authEventQueue.current.then(async () => {
        if (!active) return;
        if (handledCallback.current && event === "INITIAL_SESSION") return;

        try {
          if (event === "PASSWORD_RECOVERY") {
            await recoveryRequirementStorage.require();
          } else if (event === "SIGNED_OUT") {
            await recoveryRequirementStorage.clear();
          }

          if (!active) return;
          setState((current) =>
            mobileAuthStateForEvent(current, event, session),
          );
        } catch {
          if (!active) return;
          setState({
            recoveryRequired: event === "PASSWORD_RECOVERY",
            session: null,
            status: "error",
          });
        }
      });
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === "web" || state.status === "checking") return;

    const updateRefresh = (appState: string) => {
      if (appState === "active") {
        mobileSupabase.auth.startAutoRefresh();
      } else {
        mobileSupabase.auth.stopAutoRefresh();
      }
    };

    updateRefresh(AppState.currentState);
    const subscription = AppState.addEventListener("change", updateRefresh);

    return () => {
      subscription.remove();
      mobileSupabase.auth.stopAutoRefresh();
    };
  }, [state.status]);

  useEffect(() => {
    if (!callbackUrl || handledCallback.current === callbackUrl) return;

    let active = true;

    const callback = parseMobileAuthCallback(callbackUrl);

    if (callback.kind === "ignored") return;

    handledCallback.current = callbackUrl;

    void Promise.resolve().then(async () => {
      if (callback.kind === "error") {
        if (!active) return;
        setState({
          recoveryRequired: false,
          session: null,
          status: "error",
        });
        return;
      }

      if (!active) return;
      setState((current) => ({ ...current, status: "checking" }));
      try {
        const { data, error } =
          await mobileSupabase.auth.exchangeCodeForSession(callback.code);
        await authEventQueue.current;
        if (!active) return;
        setState((current) => ({
          recoveryRequired: error ? false : current.recoveryRequired,
          session: error ? null : data.session,
          status: error ? "error" : "signed-in",
        }));
      } catch {
        if (!active) return;
        setState({ recoveryRequired: false, session: null, status: "error" });
      }
    });

    return () => {
      active = false;
    };
  }, [callbackUrl]);

  const value = useMemo(
    () => ({ ...state, retrySession }),
    [retrySession, state],
  );

  return (
    <MobileAuthContext.Provider value={value}>
      {children}
    </MobileAuthContext.Provider>
  );
}

export function useMobileAuth() {
  const context = useContext(MobileAuthContext);

  if (!context) {
    throw new Error("useMobileAuth must be used within MobileAuthProvider");
  }

  return context;
}
