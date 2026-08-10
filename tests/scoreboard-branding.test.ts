import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.APP_URL = "http://127.0.0.1:3000";
  process.env.SUPPORT_EMAIL = "support@greenroster.example";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_SECRET_KEY = "secret-key";
  process.env.INVITATION_TOKEN_SECRET =
    "correct horse battery staple invitation secret";
  process.env.INVITATION_TTL_HOURS = "48";
  process.env.RESEND_API_KEY = "re_test_synthetic";
  process.env.RESEND_FROM_EMAIL = "notifications@greenroster.test";
  process.env.RESEND_WEBHOOK_SECRET = "whsec_test_synthetic";
  process.env.CRON_SECRET = "test-only-notification-cron-secret-value";
  process.env.NOTIFICATION_EMAIL_MAX_ATTEMPTS = "3";
  process.env.NOTIFICATION_EMAIL_RETRY_SECONDS = "300";
  return {
    rpc: vi.fn(),
    createSignedUrl: vi.fn(),
  };
});

vi.mock("../apps/web/src/lib/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({
    rpc: mocks.rpc,
    storage: {
      from: () => ({ createSignedUrl: mocks.createSignedUrl }),
    },
  }),
}));

import { executeReadPublicScoreboardBranding } from "../apps/web/src/lib/scoreboard/scoreboard-access-data";

describe("public scoreboard branding projection", () => {
  it("signs only private storage paths returned by the service projection", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          slot: "scoreboard_header",
          storage_path: "group-a/header.png",
          alt_text: "Group banner",
          decorative: false,
          click_url: null,
          display_order: 0,
        },
        {
          slot: "scoreboard_footer",
          storage_path: "group-a/footer.png",
          alt_text: null,
          decorative: true,
          click_url: "https://sponsor.example.test",
          display_order: 1,
        },
      ],
      error: null,
    });
    mocks.createSignedUrl
      .mockResolvedValueOnce({
        data: { signedUrl: "http://127.0.0.1:54321/storage/v1/signed/header" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { signedUrl: "http://127.0.0.1:54321/storage/v1/signed/footer" },
        error: null,
      });

    await expect(
      executeReadPublicScoreboardBranding("valid-scoreboard-token"),
    ).resolves.toEqual([
      {
        slot: "scoreboard_header",
        assetUrl: "http://127.0.0.1:54321/storage/v1/signed/header",
        altText: "Group banner",
        decorative: false,
        clickUrl: null,
        displayOrder: 0,
      },
      {
        slot: "scoreboard_footer",
        assetUrl: "http://127.0.0.1:54321/storage/v1/signed/footer",
        altText: null,
        decorative: true,
        clickUrl: "https://sponsor.example.test",
        displayOrder: 1,
      },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "read_public_scoreboard_branding_storage",
      { p_token: "valid-scoreboard-token" },
    );
    expect(mocks.createSignedUrl).toHaveBeenNthCalledWith(
      1,
      "group-a/header.png",
      3600,
    );
    expect(mocks.createSignedUrl).toHaveBeenNthCalledWith(
      2,
      "group-a/footer.png",
      3600,
    );
  });

  it("omits a broken cosmetic asset without taking the scoreboard offline", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          slot: "scoreboard_header",
          storage_path: "group-a/header.png",
          alt_text: "Group banner",
          decorative: false,
          click_url: null,
          display_order: 0,
        },
      ],
      error: null,
    });
    mocks.createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: "storage unavailable" },
    });

    await expect(
      executeReadPublicScoreboardBranding("valid-scoreboard-token"),
    ).resolves.toEqual([]);
  });
});
