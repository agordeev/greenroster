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
import type { MobileLinkDestination } from "@/lib/auth/mobile-link-destination";
import { MOBILE_LINK_PATHS } from "@/lib/auth/mobile-link-destination";
import { createMobileOperationId } from "@/lib/mobile-operation-id";

import { useMobileAuth } from "@/components/mobile-auth-provider";
import {
  mobileFirstRunApi,
  type MobileFirstRunErrorCode,
  type MobileFirstRunResult,
  type MobileFirstRunState,
} from "@/lib/profile/mobile-first-run-api";

type ProviderState =
  | Readonly<{ status: "idle" | "checking" }>
  | Readonly<{
      code: MobileFirstRunErrorCode;
      message: string;
      status: "error";
    }>
  | Readonly<{
      profile: MobileFirstRunState;
      status: "complete" | "required";
    }>;

type MobileFirstRunContextValue = ProviderState & {
  complete(firstName: string, lastName: string): Promise<MobileFirstRunResult>;
  consumeDeferredPath(): MobileLinkDestination;
  rememberDeferredPath(path: MobileLinkDestination): void;
  retry(): Promise<void>;
};

const MobileFirstRunContext = createContext<MobileFirstRunContextValue | null>(
  null,
);

function providerStateForResult(result: MobileFirstRunResult): ProviderState {
  if (!result.ok) {
    return { code: result.code, message: result.message, status: "error" };
  }

  return {
    profile: result.state,
    status: result.state.isComplete ? "complete" : "required",
  };
}

export function MobileFirstRunProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { recoveryRequired, session, status: authStatus } = useMobileAuth();
  const deferredPath = useRef<MobileLinkDestination>("/profile");
  const completionContext = useRef({
    correlationId: createMobileOperationId(),
    operationId: createMobileOperationId(),
  });
  const [state, setState] = useState<ProviderState>({ status: "idle" });

  const resolve = useCallback(async () => {
    if (authStatus !== "signed-in" || recoveryRequired || !session) {
      return;
    }

    const result = await mobileFirstRunApi.resolve();
    setState(providerStateForResult(result));
  }, [authStatus, recoveryRequired, session]);

  useEffect(() => {
    let active = true;
    if (authStatus !== "signed-in" || recoveryRequired || !session) {
      return;
    }

    void mobileFirstRunApi.resolve().then((result) => {
      if (active) setState(providerStateForResult(result));
    });

    return () => {
      active = false;
    };
  }, [authStatus, recoveryRequired, session]);

  const retry = useCallback(async () => {
    setState({ status: "checking" });
    await resolve();
  }, [resolve]);

  const complete = useCallback(
    async (firstName: string, lastName: string) => {
      if (state.status !== "required") {
        return {
          code: "unavailable",
          message: "GreenRoster could not verify your profile. Try again.",
          ok: false,
        } as const;
      }

      const result = await mobileFirstRunApi.complete(
        firstName,
        lastName,
        {
          privacyVersion: state.profile.currentPrivacyVersion,
          termsVersion: state.profile.currentTermsVersion,
        },
        completionContext.current,
      );
      if (result.ok) {
        completionContext.current = {
          correlationId: createMobileOperationId(),
          operationId: createMobileOperationId(),
        };
        setState({ profile: result.state, status: "complete" });
      } else if (result.code === "legal_documents_changed") {
        const refreshed = await mobileFirstRunApi.resolve();
        setState(providerStateForResult(refreshed));
      }
      return result;
    },
    [state],
  );

  const value = useMemo<MobileFirstRunContextValue>(
    () => ({
      ...state,
      complete,
      consumeDeferredPath() {
        return deferredPath.current;
      },
      rememberDeferredPath(path: MobileLinkDestination) {
        if (
          (MOBILE_LINK_PATHS as readonly string[]).includes(path) ||
          /^\/rounds\?roundId=[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            path,
          )
        ) {
          deferredPath.current = path;
        }
      },
      retry,
    }),
    [complete, retry, state],
  );

  return (
    <MobileFirstRunContext.Provider value={value}>
      {children}
    </MobileFirstRunContext.Provider>
  );
}

export function useMobileFirstRun() {
  const context = useContext(MobileFirstRunContext);
  if (!context) {
    throw new Error(
      "useMobileFirstRun must be used within MobileFirstRunProvider",
    );
  }
  return context;
}
