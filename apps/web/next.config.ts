import type { NextConfig } from "next";

import { validateWebRuntimeEnv } from "./src/lib/validate-runtime-env";

validateWebRuntimeEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
});

const nextConfig: NextConfig = {};

export default nextConfig;
