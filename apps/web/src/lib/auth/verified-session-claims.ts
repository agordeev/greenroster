import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const sessionClaimsSchema = z.object({
  session_id: z.uuid(),
  sub: z.uuid(),
});

export type VerifiedSessionClaims = z.infer<typeof sessionClaimsSchema>;

export async function resolveVerifiedSessionClaims(
  supabase: SupabaseClient,
  accessToken?: string,
): Promise<VerifiedSessionClaims | null> {
  try {
    const { data, error } = await supabase.auth.getClaims(accessToken);
    if (error) return null;

    const parsed = sessionClaimsSchema.safeParse(data?.claims);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
