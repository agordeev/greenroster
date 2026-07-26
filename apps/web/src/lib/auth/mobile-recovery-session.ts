import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service-client";
import { resolveVerifiedSessionClaims } from "@/lib/auth/verified-session-claims";

export type VerifiedMobileRecoverySession = Readonly<{
  accessToken: string;
  email: string;
  expiresAt: Date;
  sessionId: string;
  userId: string;
}>;

export async function verifyMobileRecoverySession(
  authorization: string | null,
): Promise<VerifiedMobileRecoverySession | null> {
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match) return null;

  const accessToken = match[1];
  const supabase = createSupabaseServiceClient();

  try {
    const [{ data, error }, claims] = await Promise.all([
      supabase.auth.getUser(accessToken),
      resolveVerifiedSessionClaims(supabase, accessToken),
    ]);

    if (error || !data.user?.email || !claims || claims.sub !== data.user.id) {
      return null;
    }

    const now = Date.now();
    const expiresAt = new Date(
      Math.min(claims.exp * 1000, now + 15 * 60 * 1000),
    );
    if (expiresAt.getTime() <= now) return null;

    return {
      accessToken,
      email: data.user.email.trim().toLowerCase(),
      expiresAt,
      sessionId: claims.session_id,
      userId: claims.sub,
    };
  } catch {
    return null;
  }
}
