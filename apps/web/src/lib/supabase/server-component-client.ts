import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { webRuntimeEnv } from "@/lib/runtime-env";

export async function createServerComponentSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    webRuntimeEnv.supabaseUrl,
    webRuntimeEnv.supabasePublishableKey,
    { cookies: { getAll: () => cookieStore.getAll() } },
  );
}
