import type { NextConfig } from "next";

import { validateWebRuntimeEnv } from "./src/lib/validate-runtime-env";

const webRuntime = validateWebRuntimeEnv({
  APP_URL: process.env.APP_URL,
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  INVITATION_TOKEN_SECRET: process.env.INVITATION_TOKEN_SECRET,
  INVITATION_TTL_HOURS: process.env.INVITATION_TTL_HOURS,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
  CRON_SECRET: process.env.CRON_SECRET,
  NOTIFICATION_EMAIL_MAX_ATTEMPTS: process.env.NOTIFICATION_EMAIL_MAX_ATTEMPTS,
  NOTIFICATION_EMAIL_RETRY_SECONDS:
    process.env.NOTIFICATION_EMAIL_RETRY_SECONDS,
});

const appUrl = new URL(webRuntime.appUrl);
const supabaseUrl = new URL(webRuntime.supabaseUrl);
const isSecureDeployment = appUrl.protocol === "https:";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' ${supabaseUrl.origin} data: blob:`,
  "font-src 'self' data:",
  "connect-src 'self' " + supabaseUrl.origin,
  "frame-src 'none'",
  "manifest-src 'self'",
  ...(isSecureDeployment ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()",
  },
  ...(isSecureDeployment
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const apiCorsHeaders = [
  { key: "Access-Control-Allow-Origin", value: appUrl.origin },
  { key: "Access-Control-Allow-Credentials", value: "true" },
  {
    key: "Access-Control-Allow-Methods",
    value: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  },
  {
    key: "Access-Control-Allow-Headers",
    value: "Authorization, Content-Type, X-Correlation-Id, X-Requested-With",
  },
  { key: "Access-Control-Max-Age", value: "600" },
  { key: "Vary", value: "Origin" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    serverActions: {
      // Leave room for multipart metadata around the 1 MiB binary asset
      // limit enforced by the upload action.
      bodySizeLimit: "1.1mb",
      // Next compares Server Action Origin with Host/X-Forwarded-Host. Keep
      // the production origin explicit; wildcard origins would widen CSRF.
      allowedOrigins: [appUrl.host],
    },
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: securityHeaders,
    },
    {
      source: "/api/:path*",
      headers: apiCorsHeaders,
    },
  ],
};

export default nextConfig;
