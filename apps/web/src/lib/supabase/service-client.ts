import "server-only";

import { createClient } from "@supabase/supabase-js";

import { webRuntimeEnv } from "@/lib/runtime-env";

export function createSupabaseServiceClient() {
  return createClient(
    webRuntimeEnv.supabaseUrl,
    webRuntimeEnv.supabaseSecretKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}
