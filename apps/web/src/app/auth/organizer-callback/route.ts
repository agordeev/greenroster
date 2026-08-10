import { NextResponse, type NextRequest } from "next/server";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { createServerActionSupabaseClient } from "@/lib/supabase/server-action-client";
import { webRuntimeEnv } from "@/lib/runtime-env";

function organizerDestination(status?: string): URL {
  const url = new URL("/sign-up/finish", webRuntimeEnv.appUrl);
  if (status) url.searchParams.set("status", status);
  return url;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(organizerDestination("expired"));

  try {
    const supabase = await createServerActionSupabaseClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    const redirectType = (
      data as typeof data & { redirectType?: string | null }
    ).redirectType;

    if (redirectType === "recovery") {
      await supabase.auth.signOut({ scope: "local" });
      return NextResponse.redirect(organizerDestination("expired"));
    }

    if (error || !data.session || !data.user || !data.user.email_confirmed_at) {
      return NextResponse.redirect(
        organizerDestination(
          isAuthRetryableFetchError(error) ? "auth-unavailable" : "expired",
        ),
      );
    }

    return NextResponse.redirect(organizerDestination());
  } catch {
    return NextResponse.redirect(organizerDestination("auth-unavailable"));
  }
}
