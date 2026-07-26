import { afterEach, describe, expect, it, vi } from "vitest";

import { validateMobileRuntimeEnv } from "../apps/mobile/src/lib/validate-runtime-env";
import { validateWebRuntimeEnv } from "../apps/web/src/lib/validate-runtime-env";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("web runtime configuration", () => {
  const validEnvironment = {
    APP_URL: "http://127.0.0.1:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    SUPABASE_SECRET_KEY: "secret-key",
  };

  it("returns validated configuration", () => {
    expect(validateWebRuntimeEnv(validEnvironment)).toEqual({
      appUrl: "http://127.0.0.1:3000",
      supabaseUrl: "http://127.0.0.1:54321",
      supabasePublishableKey: "publishable-key",
      supabaseSecretKey: "secret-key",
    });
  });

  it("names a missing required variable without exposing another value", () => {
    expect(() =>
      validateWebRuntimeEnv({
        ...validEnvironment,
        SUPABASE_SECRET_KEY: " ",
      }),
    ).toThrowError(
      "Missing required environment variable: SUPABASE_SECRET_KEY",
    );
  });

  it("rejects a non-HTTP Supabase URL", () => {
    expect(() =>
      validateWebRuntimeEnv({
        ...validEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: "file:///tmp/database",
      }),
    ).toThrowError(
      "NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP or HTTPS URL",
    );
  });

  it("rejects a non-HTTP application URL", () => {
    expect(() =>
      validateWebRuntimeEnv({
        ...validEnvironment,
        APP_URL: "file:///tmp/app",
      }),
    ).toThrowError("APP_URL must be a valid HTTP or HTTPS URL");
  });

  it("requires the application URL to be an origin", () => {
    expect(() =>
      validateWebRuntimeEnv({
        ...validEnvironment,
        APP_URL: "https://example.com/greenroster?preview=true",
      }),
    ).toThrowError("APP_URL must be an HTTP or HTTPS origin");
  });

  it("rejects a copied secret-key placeholder", () => {
    expect(() =>
      validateWebRuntimeEnv({
        ...validEnvironment,
        SUPABASE_SECRET_KEY: "replace-with-local-secret-key",
      }),
    ).toThrowError(
      "Replace placeholder environment variable: SUPABASE_SECRET_KEY",
    );
  });
});

describe("mobile runtime configuration", () => {
  const validEnvironment = {
    EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  };

  it("returns validated public configuration", () => {
    expect(validateMobileRuntimeEnv(validEnvironment)).toEqual({
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "publishable-key",
    });
  });

  it("names a missing publishable key", () => {
    expect(() =>
      validateMobileRuntimeEnv({
        ...validEnvironment,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
      }),
    ).toThrowError(
      "Missing required environment variable: EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  });

  it("fails when the app root imports missing runtime configuration", async () => {
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    await expect(
      import("../apps/mobile/src/lib/runtime-env"),
    ).rejects.toThrowError(
      "Missing required environment variable: EXPO_PUBLIC_SUPABASE_URL",
    );
  });

  it("rejects a copied publishable-key placeholder", () => {
    expect(() =>
      validateMobileRuntimeEnv({
        ...validEnvironment,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          "replace-with-local-publishable-key",
      }),
    ).toThrowError(
      "Replace placeholder environment variable: EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  });
});
