import { createClient, processLock } from "@supabase/supabase-js";
import { Platform } from "react-native";

import { secureSessionStorage } from "./secure-session-storage";

import { mobileRuntimeEnv } from "@/lib/runtime-env";

const persistNativeSession = Platform.OS !== "web";

export const mobileSupabase = createClient(
  mobileRuntimeEnv.supabaseUrl,
  mobileRuntimeEnv.supabasePublishableKey,
  {
    auth: {
      autoRefreshToken: persistNativeSession,
      detectSessionInUrl: false,
      flowType: "pkce",
      lock: processLock,
      persistSession: persistNativeSession,
      storage: persistNativeSession ? secureSessionStorage : undefined,
    },
  },
);
