import { afterEach, describe, expect, it, vi } from "vitest";

import {
  validateInvitationRuntimeEnv,
  validateWebRuntimeEnv,
} from "../apps/web/src/lib/validate-runtime-env";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("web runtime configuration", () => {
  const validEnvironment = {
    APP_URL: "http://127.0.0.1:3000",
    SUPPORT_EMAIL: "Support@GreenRoster.example",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    SUPABASE_SECRET_KEY: "secret-key",
    INVITATION_TOKEN_SECRET: "correct horse battery staple invitation secret",
    INVITATION_TTL_HOURS: "48",
    RESEND_API_KEY: "re_test_synthetic",
    RESEND_FROM_EMAIL: "notifications@greenroster.test",
    RESEND_WEBHOOK_SECRET: "whsec_test_synthetic",
    CRON_SECRET: "test-only-notification-cron-secret-value",
    NOTIFICATION_EMAIL_MAX_ATTEMPTS: "3",
    NOTIFICATION_EMAIL_RETRY_SECONDS: "300",
  };

  it("returns validated configuration", () => {
    expect(validateWebRuntimeEnv(validEnvironment)).toEqual({
      appUrl: "http://127.0.0.1:3000",
      supportEmail: "support@greenroster.example",
      supabaseUrl: "http://127.0.0.1:54321",
      supabasePublishableKey: "publishable-key",
      supabaseSecretKey: "secret-key",
      invitationTokenSecret: "correct horse battery staple invitation secret",
      invitationTtlHours: 48,
      invitationTtlMilliseconds: 48 * 60 * 60 * 1000,
      resendApiKey: "re_test_synthetic",
      resendFromEmail: "notifications@greenroster.test",
      resendWebhookSecret: "whsec_test_synthetic",
      cronSecret: "test-only-notification-cron-secret-value",
      notificationEmailMaxAttempts: 3,
      notificationEmailRetrySeconds: 300,
    });
  });

  it("validates invitation workers without requiring the e-mail provider", () => {
    expect(
      validateInvitationRuntimeEnv({
        APP_URL: validEnvironment.APP_URL,
        INVITATION_TOKEN_SECRET: validEnvironment.INVITATION_TOKEN_SECRET,
        INVITATION_TTL_HOURS: validEnvironment.INVITATION_TTL_HOURS,
      }),
    ).toEqual({
      appUrl: "http://127.0.0.1:3000",
      invitationTokenSecret: validEnvironment.INVITATION_TOKEN_SECRET,
      invitationTtlHours: 48,
      invitationTtlMilliseconds: 48 * 60 * 60 * 1000,
    });
  });

  it("requires invitation configuration at startup", async () => {
    for (const [name, value] of Object.entries(validEnvironment)) {
      vi.stubEnv(name, value);
    }
    vi.stubEnv("INVITATION_TOKEN_SECRET", "");

    await expect(
      import("../apps/web/src/lib/runtime-env"),
    ).rejects.toThrowError(
      "Missing required environment variable: INVITATION_TOKEN_SECRET",
    );
  });

  it("requires provider credentials at startup", async () => {
    for (const [name, value] of Object.entries(validEnvironment)) {
      vi.stubEnv(name, value);
    }
    vi.stubEnv("RESEND_API_KEY", "");

    await expect(
      import("../apps/web/src/lib/runtime-env"),
    ).rejects.toThrowError(
      "Missing required environment variable: RESEND_API_KEY",
    );
  });

  it("rejects malformed provider and notification worker configuration", () => {
    expect(() =>
      validateWebRuntimeEnv({
        ...validEnvironment,
        RESEND_WEBHOOK_SECRET: "not-a-webhook-secret",
      }),
    ).toThrowError("RESEND_WEBHOOK_SECRET must be a valid whsec_ secret");

    expect(() =>
      validateWebRuntimeEnv({
        ...validEnvironment,
        CRON_SECRET: "too-short",
      }),
    ).toThrowError("CRON_SECRET must contain at least 32 bytes");

    expect(() =>
      validateWebRuntimeEnv({
        ...validEnvironment,
        NOTIFICATION_EMAIL_MAX_ATTEMPTS: "0",
      }),
    ).toThrowError(
      "NOTIFICATION_EMAIL_MAX_ATTEMPTS must be a positive integer",
    );
  });

  it("rejects weak invitation secrets and invalid TTL values", () => {
    expect(() =>
      validateWebRuntimeEnv({
        ...validEnvironment,
        INVITATION_TOKEN_SECRET: "too-short",
      }),
    ).toThrowError("INVITATION_TOKEN_SECRET must contain at least 32 bytes");

    for (const ttl of ["0", "-1", "1.5", "many"]) {
      expect(() =>
        validateWebRuntimeEnv({
          ...validEnvironment,
          INVITATION_TTL_HOURS: ttl,
        }),
      ).toThrowError("INVITATION_TTL_HOURS must be a positive integer");
    }
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

  it("requires a valid support address", () => {
    expect(() =>
      validateWebRuntimeEnv({
        ...validEnvironment,
        SUPPORT_EMAIL: "not-an-address",
      }),
    ).toThrowError("SUPPORT_EMAIL must be a valid e-mail address");
  });
});
