import { NextResponse, type NextRequest } from "next/server";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { createServerActionSupabaseClient } from "@/lib/supabase/server-action-client";
import { webRuntimeEnv } from "@/lib/runtime-env";

function invitationDestination(status?: string): URL {
  const url = new URL("/invitations/accept", webRuntimeEnv.appUrl);
  if (status) url.searchParams.set("status", status);
  return url;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(invitationDestination("expired"));

  try {
    const supabase = await createServerActionSupabaseClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    const redirectType = (
      data as typeof data & { redirectType?: string | null }
    ).redirectType;
    if (!error && redirectType === "recovery" && data.session) {
      await supabase.auth.signOut({ scope: "local" });
      return NextResponse.redirect(invitationDestination("expired"));
    }
    if (error || !data.session || !data.user) {
      return NextResponse.redirect(
        invitationDestination(
          isAuthRetryableFetchError(error) ? "auth-unavailable" : "expired",
        ),
      );
    }
    return NextResponse.redirect(invitationDestination());
  } catch {
    return NextResponse.redirect(invitationDestination("auth-unavailable"));
  }
}
