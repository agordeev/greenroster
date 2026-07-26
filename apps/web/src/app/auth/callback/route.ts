import { NextResponse, type NextRequest } from "next/server";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { createServerActionSupabaseClient } from "@/lib/supabase/server-action-client";
import { recoveryDestination } from "@/lib/auth/recovery-callback";
import { registerPasswordRecoverySession } from "@/lib/auth/password-recovery-registry";
import { resolveVerifiedSessionClaims } from "@/lib/auth/verified-session-claims";
import { webRuntimeEnv } from "@/lib/runtime-env";

const recoveryLifetimeMilliseconds = 15 * 60 * 1000;

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = recoveryDestination(request.nextUrl.searchParams.get("next"));

  if (code && next) {
    try {
      const supabase = await createServerActionSupabaseClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      const redirectType = (
        data as typeof data & { redirectType?: string | null }
      ).redirectType;

      if (!error && redirectType === "recovery" && data.session) {
        const claims = await resolveVerifiedSessionClaims(
          supabase,
          data.session.access_token,
        );
        const sessionExpiresAtMilliseconds = data.session.expires_at
          ? data.session.expires_at * 1000
          : Date.now() + recoveryLifetimeMilliseconds;
        const expiresAt = new Date(
          Math.min(
            sessionExpiresAtMilliseconds,
            Date.now() + recoveryLifetimeMilliseconds,
          ),
        );

        if (
          claims &&
          claims.sub === data.user.id &&
          (await registerPasswordRecoverySession(
            claims.session_id,
            claims.sub,
            expiresAt,
          ))
        ) {
          return NextResponse.redirect(new URL(next, webRuntimeEnv.appUrl));
        }

        await supabase.auth.signOut({ scope: "local" });
        return NextResponse.redirect(
          new URL("/recover-password?status=unavailable", webRuntimeEnv.appUrl),
        );
      }

      if (!error && data.session) {
        await supabase.auth.signOut({ scope: "local" });
      }

      if (isAuthRetryableFetchError(error)) {
        return NextResponse.redirect(
          new URL("/recover-password?status=unavailable", webRuntimeEnv.appUrl),
        );
      }
    } catch {
      return NextResponse.redirect(
        new URL("/recover-password?status=unavailable", webRuntimeEnv.appUrl),
      );
    }
  }

  return NextResponse.redirect(
    new URL("/recover-password?status=expired", webRuntimeEnv.appUrl),
  );
}
