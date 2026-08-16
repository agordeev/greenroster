import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { webRuntimeEnv } from "@/lib/runtime-env";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const apiPathPrefix = "/api/";

const corsHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Correlation-Id, X-Requested-With",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "600",
};

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isTrustedWebOrigin(
  candidate: string | null,
  applicationOrigin: string,
): boolean {
  const candidateOrigin = originOf(candidate);
  const expectedOrigin = originOf(applicationOrigin);
  return Boolean(candidateOrigin && expectedOrigin === candidateOrigin);
}

export function isCsrfSafeRequest(
  request: Pick<Request, "headers" | "method">,
  applicationOrigin: string,
): boolean {
  if (!unsafeMethods.has(request.method.toUpperCase())) return true;

  const origin = request.headers.get("origin");
  if (origin) return isTrustedWebOrigin(origin, applicationOrigin);

  const referer = request.headers.get("referer");
  if (referer && !isTrustedWebOrigin(referer, applicationOrigin)) return false;

  // Fetch Metadata is present on modern browsers even when Origin is omitted.
  // Reject both cross-site and same-site requests: a sibling subdomain must not
  // be able to submit a cookie-backed mutation to the canonical origin.
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;

  // Native clients, cron, and provider webhooks do not send browser origin
  // metadata. They authenticate with bearer/signature credentials at the route.
  return true;
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith(apiPathPrefix);
}

function contentSecurityPolicy(): string {
  const supabaseOrigin = new URL(webRuntimeEnv.supabaseUrl).origin;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    [
      "script-src 'self' 'unsafe-inline'",
      ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : []),
    ].join(" "),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' ${supabaseOrigin} data: blob:`,
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin}`,
    "frame-src 'none'",
    "manifest-src 'self'",
    ...(new URL(webRuntimeEnv.appUrl).protocol === "https:"
      ? ["upgrade-insecure-requests"]
      : []),
  ].join("; ");
}

function applySecurityHeaders(response: NextResponse): void {
  response.headers.set("Content-Security-Policy", contentSecurityPolicy());
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()",
  );
  if (new URL(webRuntimeEnv.appUrl).protocol === "https:") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
}

function applyCorsHeaders(response: NextResponse, request: NextRequest): void {
  if (!isApiPath(request.nextUrl.pathname)) return;
  response.headers.set("Vary", "Origin");
  const origin = request.headers.get("origin");
  if (!origin) return;
  response.headers.set("Access-Control-Allow-Origin", webRuntimeEnv.appUrl);
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
}

function rejectedRequest(
  request: NextRequest,
  status: "cors_denied" | "csrf_rejected",
): NextResponse {
  const response = NextResponse.json(
    { ok: false, status },
    { headers: { "Cache-Control": "no-store" }, status: 403 },
  );
  applySecurityHeaders(response);
  if (isApiPath(request.nextUrl.pathname)) {
    response.headers.set("Vary", "Origin");
  }
  return response;
}

function preflightResponse(request: NextRequest): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  applySecurityHeaders(response);
  applyCorsHeaders(response, request);
  return response;
}

export async function proxy(request: NextRequest) {
  const applicationOrigin = webRuntimeEnv.appUrl;
  const isApi = isApiPath(request.nextUrl.pathname);
  const requestOrigin = request.headers.get("origin");

  if (
    isApi &&
    requestOrigin &&
    !isTrustedWebOrigin(requestOrigin, applicationOrigin)
  ) {
    return rejectedRequest(request, "cors_denied");
  }

  if (isApi && request.method.toUpperCase() === "OPTIONS") {
    if (!requestOrigin) return rejectedRequest(request, "cors_denied");
    return preflightResponse(request);
  }

  if (!isCsrfSafeRequest(request, applicationOrigin)) {
    return rejectedRequest(request, "csrf_rejected");
  }

  const nextResponse = () => {
    const result = NextResponse.next({ request });
    applySecurityHeaders(result);
    applyCorsHeaders(result, request);
    return result;
  };

  let response = nextResponse();
  const supabase = createServerClient(
    webRuntimeEnv.supabaseUrl,
    webRuntimeEnv.supabasePublishableKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = nextResponse();

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Supabase SSR uses this verified Auth request to refresh or clear cookies.
  // Authorization remains in the DAL beside each protected read or mutation.
  try {
    await supabase.auth.getUser();
  } catch {
    // Public routes must remain available during a transient Auth outage.
    // Protected reads verify the session again in their server-side DAL.
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
