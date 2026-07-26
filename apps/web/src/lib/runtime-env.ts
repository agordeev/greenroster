import "server-only";

import { validateWebRuntimeEnv } from "./validate-runtime-env";

export const webRuntimeEnv = validateWebRuntimeEnv({
  APP_URL: process.env.APP_URL,
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
});
