import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

import { cronBearerMatches } from "../apps/web/src/lib/jobs/cron-auth";

const runtimeEnvironment = {
  APP_URL: "https://greenroster.example",
  SUPPORT_EMAIL: "support@greenroster.example",
  NEXT_PUBLIC_SUPABASE_URL: "https://greenroster.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  SUPABASE_SECRET_KEY: "secret-key",
  INVITATION_TOKEN_SECRET: "correct horse battery staple invitation secret",
  INVITATION_TTL_HOURS: "48",
  RESEND_API_KEY: "re_test_synthetic",
  RESEND_FROM_EMAIL: "notifications@greenroster.example",
  RESEND_WEBHOOK_SECRET: "whsec_test_synthetic",
  CRON_SECRET: "test-only-notification-cron-secret-value",
  NOTIFICATION_EMAIL_MAX_ATTEMPTS: "3",
  NOTIFICATION_EMAIL_RETRY_SECONDS: "300",
};

let securityBoundary: typeof import("../apps/web/src/proxy");
let nextConfig: typeof import("../apps/web/next.config").default;

function proxyRequest(
  url: string,
  init: Readonly<{ headers?: HeadersInit; method?: string }> = {},
): Parameters<typeof securityBoundary.proxy>[0] {
  const parsedUrl = new URL(url);
  return {
    headers: new Headers(init.headers),
    method: init.method ?? "GET",
    nextUrl: parsedUrl,
  } as unknown as Parameters<typeof securityBoundary.proxy>[0];
}

beforeAll(async () => {
  for (const [name, value] of Object.entries(runtimeEnvironment)) {
    vi.stubEnv(name, value);
  }
  securityBoundary = await import("../apps/web/src/proxy");
  nextConfig = (await import("../apps/web/next.config")).default;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("release security headers", () => {
  it("sets restrictive headers, an explicit Server Action origin, and API CORS policy", async () => {
    const groups = await nextConfig.headers?.();
    expect(groups).toBeDefined();
    const allHeaders = groups?.flatMap((group) => group.headers) ?? [];
    const values = new Map(
      allHeaders.map((header) => [header.key, header.value]),
    );

    expect(values.get("Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
    expect(values.get("Content-Security-Policy")).toContain(
      "connect-src 'self' https://greenroster.supabase.co",
    );
    expect(values.get("Content-Security-Policy")).not.toContain("unsafe-eval");
    expect(values.get("Strict-Transport-Security")).toContain(
      "max-age=63072000",
    );
    expect(values.get("X-Content-Type-Options")).toBe("nosniff");
    expect(values.get("X-Frame-Options")).toBe("DENY");
    expect(values.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(values.get("Permissions-Policy")).toContain("camera=()");
    expect(nextConfig.experimental?.serverActions?.allowedOrigins).toEqual([
      "greenroster.example",
    ]);

    const apiGroup = groups?.find((group) => group.source === "/api/:path*");
    expect(apiGroup?.headers).toEqual(
      expect.arrayContaining([
        {
          key: "Access-Control-Allow-Origin",
          value: "https://greenroster.example",
        },
        { key: "Access-Control-Allow-Credentials", value: "true" },
        { key: "Vary", value: "Origin" },
      ]),
    );
  });
});

describe("web origin and CSRF boundary", () => {
  it("accepts only the exact configured origin", () => {
    expect(
      securityBoundary.isTrustedWebOrigin(
        "https://greenroster.example",
        "https://greenroster.example",
      ),
    ).toBe(true);
    expect(
      securityBoundary.isTrustedWebOrigin(
        "https://attacker.example",
        "https://greenroster.example",
      ),
    ).toBe(false);
    expect(
      securityBoundary.isTrustedWebOrigin(
        "null",
        "https://greenroster.example",
      ),
    ).toBe(false);
  });

  it("rejects foreign browser origins and sibling-site metadata for mutations", () => {
    const foreignOrigin = new Request(
      "https://greenroster.example/api/member-imports",
      {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
      },
    );
    expect(
      securityBoundary.isCsrfSafeRequest(
        foreignOrigin,
        "https://greenroster.example",
      ),
    ).toBe(false);

    const siblingSite = new Request(
      "https://greenroster.example/api/member-imports",
      {
        method: "POST",
        headers: { "Sec-Fetch-Site": "same-site" },
      },
    );
    expect(
      securityBoundary.isCsrfSafeRequest(
        siblingSite,
        "https://greenroster.example",
      ),
    ).toBe(false);

    const nativeRequest = new Request(
      "https://greenroster.example/api/member-imports",
      {
        method: "POST",
        headers: { Authorization: "Bearer access-token" },
      },
    );
    expect(
      securityBoundary.isCsrfSafeRequest(
        nativeRequest,
        "https://greenroster.example",
      ),
    ).toBe(true);
  });

  it("returns a narrow preflight response for the canonical origin", async () => {
    const response = await securityBoundary.proxy(
      proxyRequest("https://greenroster.example/api/member-imports", {
        method: "OPTIONS",
        headers: {
          Origin: "https://greenroster.example",
          "Access-Control-Request-Headers": "content-type",
          "Access-Control-Request-Method": "POST",
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://greenroster.example",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  });

  it("rejects a cross-origin API request before authentication or route work", async () => {
    const response = await securityBoundary.proxy(
      proxyRequest("https://greenroster.example/api/member-imports", {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      status: "cors_denied",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("job credential boundary", () => {
  it("requires an exact bearer secret and compares it without leaking length", () => {
    const secret = runtimeEnvironment.CRON_SECRET;
    expect(cronBearerMatches(`Bearer ${secret}`, secret)).toBe(true);
    expect(cronBearerMatches(`Bearer ${secret}x`, secret)).toBe(false);
    expect(cronBearerMatches(`bearer ${secret}`, secret)).toBe(false);
    expect(cronBearerMatches(secret, secret)).toBe(false);
    expect(cronBearerMatches(null, secret)).toBe(false);
    expect(cronBearerMatches(`Bearer ${secret}`, "")).toBe(false);
  });
});
