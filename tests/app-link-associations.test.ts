import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getAndroidAssociation } from "../apps/web/src/app/.well-known/assetlinks.json/route";
import { GET as getAppleAssociation } from "../apps/web/src/app/.well-known/apple-app-site-association/route";
import { createAppLinkAssociations } from "../apps/web/src/lib/app-link-associations";

const fingerprint = Array.from({ length: 32 }, () => "AB").join(":");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("website application-link associations", () => {
  it("binds the exact native application identifiers and safe paths", () => {
    const associations = createAppLinkAssociations({
      APPLE_APP_IDENTIFIER_PREFIX: "a1b2c3d4e5",
      ANDROID_APP_CERTIFICATE_SHA256: fingerprint.toLowerCase(),
    });

    expect(associations.apple.applinks.details).toEqual([
      {
        appID: "A1B2C3D4E5.com.greenroster.app",
        paths: ["/", "/rounds", "/leaderboard", "/profile"],
      },
    ]);
    expect(associations.android.target).toEqual({
      namespace: "android_app",
      package_name: "com.greenroster.app",
      sha256_cert_fingerprints: [fingerprint],
    });
  });

  it("fails fast when Apple association configuration is absent", () => {
    expect(() =>
      createAppLinkAssociations({
        ANDROID_APP_CERTIFICATE_SHA256: fingerprint,
      }),
    ).toThrowError(
      "Missing required environment variable: APPLE_APP_IDENTIFIER_PREFIX",
    );
  });

  it("rejects a malformed Android signing fingerprint", () => {
    expect(() =>
      createAppLinkAssociations({
        APPLE_APP_IDENTIFIER_PREFIX: "A1B2C3D4E5",
        ANDROID_APP_CERTIFICATE_SHA256: "not-a-fingerprint",
      }),
    ).toThrowError(
      "ANDROID_APP_CERTIFICATE_SHA256 must be a colon-delimited SHA-256 fingerprint",
    );
  });

  it("serves both platform association documents as cacheable JSON", async () => {
    vi.stubEnv("APPLE_APP_IDENTIFIER_PREFIX", "A1B2C3D4E5");
    vi.stubEnv("ANDROID_APP_CERTIFICATE_SHA256", fingerprint);

    const [appleResponse, androidResponse] = [
      getAppleAssociation(),
      getAndroidAssociation(),
    ];

    expect(appleResponse.headers.get("content-type")).toContain(
      "application/json",
    );
    expect(androidResponse.headers.get("cache-control")).toBe(
      "public, max-age=3600",
    );
    expect(await appleResponse.json()).toMatchObject({
      applinks: { apps: [] },
    });
    expect(await androidResponse.json()).toEqual([
      expect.objectContaining({
        relation: ["delegate_permission/common.handle_all_urls"],
      }),
    ]);
  });
});
