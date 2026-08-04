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
import * as Notifications from "expo-notifications";

import {
  parseMobileAuthCallback,
  type MobileAuthCallback,
} from "@/lib/auth/mobile-auth-callback";
import {
  resolveMobileLinkDestination,
  type MobileLinkDestination,
} from "@/lib/auth/mobile-link-destination";
import { resumeMobilePendingDestination } from "@/lib/auth/mobile-pending-destination";
import {
  initialMobileAuthState,
  mobileAuthStateForEvent,
  restoredMobileAuthState,
  type MobileAuthState,
} from "@/lib/auth/mobile-auth-state";
import { mobileSupabase } from "@/lib/auth/mobile-supabase";
import { mobileRecoveryApi } from "@/lib/auth/mobile-recovery-api";
import {
  pendingLinkStorage,
  recoveryHandleStorage,
  recoveryRequirementStorage,
} from "@/lib/auth/secure-session-storage";
import { mobileRuntimeEnv } from "@/lib/runtime-env";
import { retireCurrentMobilePushDevice } from "@/lib/notifications/mobile-push-registration-default";
import { createMobileScoreQueue } from "@/lib/rounds/mobile-score-queue";
import { mobileLiveRoundSnapshotStorage } from "@/lib/rounds/mobile-live-round-snapshot-storage";
import { resolveResultsNotificationDestination } from "@/lib/notifications/mobile-results-notification";

type MobileAuthContextValue = MobileAuthState & {
  clearPendingDestination(): Promise<void>;
  resumePendingDestination(): Promise<MobileLinkDestination>;
  pendingDestination: MobileLinkDestination | null;
  pendingDestinationReady: boolean;
  retrySession(): Promise<void>;
};

async function retirePushDeviceBeforeLocalSignOut(session: Session | null) {
  if (!session?.user.id) return;
  try {
    await retireCurrentMobilePushDevice(session.user.id);
  } catch {
    // Recovery and callback cleanup must still clear the local Auth session.
    // The explicit profile sign-out path blocks when retirement is unavailable.
  }
}

async function clearMobileOfflineArtifacts(userId: string) {
  if (Platform.OS === "web") return;
  await mobileLiveRoundSnapshotStorage.clearUser(userId);
}

const MobileAuthContext = createContext<MobileAuthContextValue | null>(null);

async function restoreMobileAuthState(
  session: Session | null,
  recoveryHandle: string | null,
): Promise<MobileAuthState> {
  if (recoveryHandle) {
    const recovery = await mobileRecoveryApi.status(recoveryHandle);
    if (recovery.ok && recovery.state === "active") {
      if (session) {
        await retirePushDeviceBeforeLocalSignOut(session);
        await mobileSupabase.auth.signOut({ scope: "local" });
        await clearMobileOfflineArtifacts(session.user.id);
      }
      await recoveryRequirementStorage.require();
      return { recoveryRequired: true, session: null, status: "signed-in" };
    }
    if (!recovery.ok && recovery.code === "unavailable") {
      return { recoveryRequired: true, session: null, status: "error" };
    }
    await recoveryHandleStorage.clear();
    await recoveryRequirementStorage.clear();
    if (session) {
      await retirePushDeviceBeforeLocalSignOut(session);
      await mobileSupabase.auth.signOut({ scope: "local" });
      await clearMobileOfflineArtifacts(session.user.id);
    }
    return restoredMobileAuthState(null, false);
  }

  await recoveryRequirementStorage.clear();
  return restoredMobileAuthState(session, false);
}

export function MobileAuthProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const handledCallback = useRef<string | null>(null);
  const handledNotificationResponse = useRef<string | null>(null);
  const pendingRecoveryCallback = useRef<Extract<
    MobileAuthCallback,
    { kind: "code" }
  > | null>(null);
  const authEventQueue = useRef<Promise<void>>(Promise.resolve());
  const lastKnownUserId = useRef<string | null>(null);
  const scoreQueue = useMemo(
    () => createMobileScoreQueue({ platform: Platform.OS }),
    [],
  );
  const [state, setState] = useState<MobileAuthState>(initialMobileAuthState);
  const [pendingDestination, setPendingDestination] =
    useState<MobileLinkDestination | null>(null);
  const [pendingDestinationReady, setPendingDestinationReady] = useState(false);
  const [incomingLink, setIncomingLink] = useState<{
    eventId: number;
    url: string;
  } | null>(null);

  const clearPendingDestination = useCallback(async () => {
    await pendingLinkStorage.clear();
    setPendingDestination(null);
  }, []);

  const resumePendingDestination = useCallback(async () => {
    return resumeMobilePendingDestination(
      pendingDestination,
      pendingLinkStorage,
      mobileRuntimeEnv.appUrl,
    );
  }, [pendingDestination]);

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
          const currentSession = await mobileSupabase.auth
            .getSession()
            .then(({ data }) => data.session);
          await retirePushDeviceBeforeLocalSignOut(currentSession);
          await mobileSupabase.auth.signOut({ scope: "local" });
          if (currentSession?.user.id) {
            await clearMobileOfflineArtifacts(currentSession.user.id);
          }
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

        const currentSession = await mobileSupabase.auth
          .getSession()
          .then(({ data }) => data.session);
        await retirePushDeviceBeforeLocalSignOut(currentSession);
        await mobileSupabase.auth.signOut({ scope: "local" });
        if (currentSession?.user.id) {
          await clearMobileOfflineArtifacts(currentSession.user.id);
        }
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
        if (session?.user.id) lastKnownUserId.current = session.user.id;
        if (handledCallback.current && event === "INITIAL_SESSION") return;

        try {
          const priorUserId = lastKnownUserId.current;
          if (event === "PASSWORD_RECOVERY") {
            await recoveryRequirementStorage.require();
          } else if (event === "SIGNED_OUT") {
            lastKnownUserId.current = null;
            if (priorUserId && scoreQueue.isSupported) {
              await scoreQueue.clearUser(priorUserId);
            }
            if (priorUserId) {
              await clearMobileOfflineArtifacts(priorUserId);
            }
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
  }, [scoreQueue]);

  useEffect(() => {
    let active = true;

    void pendingLinkStorage
      .get()
      .then(async (pendingLink) => {
        const destination = pendingLink
          ? resolveMobileLinkDestination(pendingLink, mobileRuntimeEnv.appUrl)
          : null;
        if (pendingLink && !destination) await pendingLinkStorage.clear();
        if (active) setPendingDestination(destination?.href ?? null);
      })
      .finally(() => {
        if (active) setPendingDestinationReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let active = true;

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data;
      const destination = resolveResultsNotificationDestination(data);
      if (!destination) return;
      if (handledNotificationResponse.current === destination) return;
      handledNotificationResponse.current = destination;
      void pendingLinkStorage
        .set(`${mobileRuntimeEnv.appUrl}${destination}`)
        .then(() => {
          if (!active) return;
          setPendingDestination(destination);
          setPendingDestinationReady(true);
        });
    };

    const subscription =
      Notifications.addNotificationResponseReceivedListener(handleResponse);
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (active && response) handleResponse(response);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      subscription.remove();
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
    let active = true;
    let receivedEvent = false;

    const subscription = Linking.addEventListener("url", ({ url }) => {
      receivedEvent = true;
      setIncomingLink((current) => ({
        eventId: (current?.eventId ?? 0) + 1,
        url,
      }));
    });

    void Linking.getInitialURL()
      .then((url) => {
        if (active && !receivedEvent && url) {
          setIncomingLink({ eventId: 0, url });
        }
      })
      .catch(() => {
        if (active) {
          setState({ recoveryRequired: false, session: null, status: "error" });
        }
      });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const callbackUrl = incomingLink?.url;
    if (!callbackUrl || handledCallback.current === callbackUrl) return;

    let active = true;

    const callback = parseMobileAuthCallback(callbackUrl);

    if (callback.kind === "ignored") {
      const destination = resolveMobileLinkDestination(
        callbackUrl,
        mobileRuntimeEnv.appUrl,
      );
      if (!destination) return;

      void pendingLinkStorage.set(callbackUrl).then(() => {
        if (active) {
          setPendingDestination(destination.href);
          setPendingDestinationReady(true);
        }
      });
      return () => {
        active = false;
      };
    }

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
  }, [exchangeRecoveryCallback, incomingLink]);

  const value = useMemo(
    () => ({
      ...state,
      clearPendingDestination,
      resumePendingDestination,
      pendingDestination,
      pendingDestinationReady,
      retrySession,
    }),
    [
      clearPendingDestination,
      resumePendingDestination,
      pendingDestination,
      pendingDestinationReady,
      retrySession,
      state,
    ],
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
