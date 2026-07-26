import * as Linking from "expo-linking";
import type { Session } from "@supabase/supabase-js";
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

import {
  parseMobileAuthCallback,
  type MobileAuthCallback,
} from "@/lib/auth/mobile-auth-callback";
import {
  initialMobileAuthState,
  mobileAuthStateForEvent,
  restoredMobileAuthState,
  type MobileAuthState,
} from "@/lib/auth/mobile-auth-state";
import { mobileSupabase } from "@/lib/auth/mobile-supabase";
import { mobileRecoveryApi } from "@/lib/auth/mobile-recovery-api";
import {
  recoveryHandleStorage,
  recoveryRequirementStorage,
} from "@/lib/auth/secure-session-storage";

type MobileAuthContextValue = MobileAuthState & {
  retrySession(): Promise<void>;
};

const MobileAuthContext = createContext<MobileAuthContextValue | null>(null);

async function restoreMobileAuthState(
  session: Session | null,
  recoveryHandle: string | null,
): Promise<MobileAuthState> {
  if (recoveryHandle) {
    const recovery = await mobileRecoveryApi.status(recoveryHandle);
    if (recovery.ok && recovery.state === "active") {
      if (session) await mobileSupabase.auth.signOut({ scope: "local" });
      await recoveryRequirementStorage.require();
      return { recoveryRequired: true, session: null, status: "signed-in" };
    }
    if (!recovery.ok && recovery.code === "unavailable") {
      return { recoveryRequired: true, session: null, status: "error" };
    }
    await recoveryHandleStorage.clear();
    await recoveryRequirementStorage.clear();
    if (session) await mobileSupabase.auth.signOut({ scope: "local" });
    return restoredMobileAuthState(null, false);
  }

  await recoveryRequirementStorage.clear();
  return restoredMobileAuthState(session, false);
}

export function MobileAuthProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const callbackUrl = Linking.useURL();
  const handledCallback = useRef<string | null>(null);
  const pendingRecoveryCallback = useRef<Extract<
    MobileAuthCallback,
    { kind: "code" }
  > | null>(null);
  const authEventQueue = useRef<Promise<void>>(Promise.resolve());
  const [state, setState] = useState<MobileAuthState>(initialMobileAuthState);

  const exchangeRecoveryCallback = useCallback(
    async (
      callback: Extract<MobileAuthCallback, { kind: "code" }>,
      isActive: () => boolean = () => true,
    ) => {
      if (!isActive()) return;
      setState((current) => ({ ...current, status: "checking" }));
      try {
        const recovery = await mobileRecoveryApi.exchange(
          callback.code,
          callback.recoveryState,
        );
        if (
          !recovery.ok ||
          recovery.state !== "active" ||
          !recovery.recoveryHandle
        ) {
          if (
            !recovery.ok &&
            (recovery.code === "unavailable" ||
              recovery.code === "rate_limited")
          ) {
            if (!isActive()) return;
            setState({
              recoveryRequired: false,
              session: null,
              status: "error",
            });
            return;
          }

          pendingRecoveryCallback.current = null;
          await mobileSupabase.auth.signOut({ scope: "local" });
          await recoveryHandleStorage.clear();
          await recoveryRequirementStorage.clear();
          if (!isActive()) return;
          setState({
            recoveryRequired: false,
            session: null,
            status: "signed-out",
          });
          return;
        }

        await mobileSupabase.auth.signOut({ scope: "local" });
        await authEventQueue.current;
        await recoveryHandleStorage.set(recovery.recoveryHandle);
        await recoveryRequirementStorage.require();
        if (!isActive()) return;

        pendingRecoveryCallback.current = null;
        setState({
          recoveryRequired: true,
          session: null,
          status: "signed-in",
        });
      } catch {
        if (!isActive()) return;
        setState({ recoveryRequired: false, session: null, status: "error" });
      }
    },
    [],
  );

  const retrySession = useCallback(async () => {
    const recoveryCallback = pendingRecoveryCallback.current;
    if (recoveryCallback) {
      await exchangeRecoveryCallback(recoveryCallback);
      return;
    }

    setState((current) => ({ ...current, status: "checking" }));
    authEventQueue.current = authEventQueue.current.then(async () => {
      try {
        const [{ data, error }, recoveryHandle] = await Promise.all([
          mobileSupabase.auth.getSession(),
          recoveryHandleStorage.get(),
        ]);

        if (error) {
          setState({ recoveryRequired: false, session: null, status: "error" });
          return;
        }

        setState(await restoreMobileAuthState(data.session, recoveryHandle));
      } catch {
        setState({ recoveryRequired: false, session: null, status: "error" });
      }
    });
    await authEventQueue.current;
  }, [exchangeRecoveryCallback]);

  useEffect(() => {
    let active = true;
    authEventQueue.current = Promise.all([
      mobileSupabase.auth.getSession(),
      recoveryHandleStorage.get(),
    ])
      .then(async ([{ data, error }, recoveryHandle]) => {
        if (!active || handledCallback.current) return;

        if (error) {
          setState({ recoveryRequired: false, session: null, status: "error" });
          return;
        }

        if (!active || handledCallback.current) return;
        const restored = await restoreMobileAuthState(
          data.session,
          recoveryHandle,
        );
        if (!active || handledCallback.current) return;
        setState(restored);
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
            if (await recoveryHandleStorage.get()) return;
            await recoveryRequirementStorage.clear();
          }

          if (!active) return;
          setState((current) =>
            event === "PASSWORD_RECOVERY"
              ? { ...current, recoveryRequired: true, status: "checking" }
              : mobileAuthStateForEvent(current, event, session),
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
    if (
      Platform.OS === "web" ||
      state.status === "checking" ||
      state.recoveryRequired
    ) {
      return;
    }

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
  }, [state.recoveryRequired, state.status]);

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

      pendingRecoveryCallback.current = callback;
      await exchangeRecoveryCallback(callback, () => active);
    });

    return () => {
      active = false;
    };
  }, [callbackUrl, exchangeRecoveryCallback]);

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
