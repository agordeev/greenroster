import { NextResponse } from "next/server";
import { z } from "zod";

import { memberAuthDestination } from "@/lib/auth/safe-return-path";
import { resolveVerifiedSessionClaims } from "@/lib/auth/verified-session-claims";
import { webRuntimeEnv } from "@/lib/runtime-env";
import { createServerActionSupabaseClient } from "@/lib/supabase/server-action-client";

const memberCallbackPayloadSchema = z
  .object({
    token_hash: z.string().trim().min(16).max(512),
    type: z.literal("magiclink"),
    next: z.string().nullable().optional(),
  })
  .strict();

function failureUrl(destination: string | null, status: string): string {
  const url = new URL("/sign-in", webRuntimeEnv.appUrl);
  url.searchParams.set("status", status);
  if (destination) url.searchParams.set("next", destination);
  return url.toString();
}

function jsonFailure(destination: string | null, status: string) {
  return NextResponse.json(
    { ok: false, redirectTo: failureUrl(destination, status) },
    {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
      status: 400,
    },
  );
}

function callbackLandingPage(): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Signing you in</title></head>
  <body>
    <main><h1>Signing you in…</h1><p>We’re confirming your results link.</p></main>
    <script>
      (() => {
        const fallback = "/sign-in?status=member-link-unavailable";
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const payload = {
          token_hash: hash.get("token_hash"),
          type: hash.get("type"),
          next: hash.get("next"),
        };
        window.history.replaceState(null, "", window.location.pathname);
        fetch(window.location.pathname, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify(payload),
        })
          .then((response) => response.json())
          .then((result) => {
            window.location.replace(
              typeof result.redirectTo === "string" ? result.redirectTo : fallback,
            );
          })
          .catch(() => window.location.replace(fallback));
      })();
    </script>
    <noscript><p>Turn on JavaScript to open this link.</p></noscript>
  </body>
</html>`,
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

export async function GET() {
  // The token is intentionally carried in the URL fragment. Browsers do not
  // send fragments in HTTP requests, so scanners and request logs cannot
  // consume or retain the bearer-equivalent token. The landing page posts it
  // once over same-origin HTTPS after removing the fragment from history.
  return callbackLandingPage();
}

export async function POST(request: Request) {
  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return jsonFailure(null, "member-link-expired");
  }
  const rawDestination =
    typeof rawPayload === "object" &&
    rawPayload !== null &&
    "next" in rawPayload
      ? memberAuthDestination(
          typeof rawPayload.next === "string" ? rawPayload.next : null,
        )
      : null;
  const parsedPayload = memberCallbackPayloadSchema.safeParse(rawPayload);
  if (!parsedPayload.success)
    return jsonFailure(rawDestination, "member-link-expired");
  const payload = parsedPayload.data;

  const destination = memberAuthDestination(payload.next ?? null);
  if (!destination) return jsonFailure(null, "member-link-expired");

  try {
    const supabase = await createServerActionSupabaseClient();
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: payload.token_hash,
      type: "magiclink",
    });
    if (error || !data.session || !data.user?.email_confirmed_at) {
      return jsonFailure(destination, "member-link-expired");
    }

    const claims = await resolveVerifiedSessionClaims(
      supabase,
      data.session.access_token,
    );
    if (!claims || claims.sub !== data.user.id) {
      await supabase.auth.signOut({ scope: "local" });
      return jsonFailure(destination, "member-link-unavailable");
    }

    return NextResponse.json(
      {
        ok: true,
        redirectTo: new URL(destination, webRuntimeEnv.appUrl).toString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  } catch {
    return jsonFailure(destination, "member-link-unavailable");
  }
}
