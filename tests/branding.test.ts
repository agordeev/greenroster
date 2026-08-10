import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { brandingAssetInputSchema } from "../apps/web/src/domain/clubhouse-content";

const baseInput = {
  slot: "scoreboard_footer" as const,
  storagePath: "50000000-0000-4000-8000-000000000001/banner.png",
  assetUrl: "https://cdn.example.test/banner.png",
  mimeType: "image/png" as const,
  byteSize: 1,
  altText: "Sponsor banner",
  decorative: false,
  operationId: "d3100000-0000-4000-8000-000000000001",
};

describe("clubhouse branding contract", () => {
  it("accepts an HTTPS click link and a footer position", () => {
    expect(
      brandingAssetInputSchema.parse({
        ...baseInput,
        clickUrl: "https://sponsor.example.test/offer",
        displayOrder: 2,
      }),
    ).toMatchObject({
      clickUrl: "https://sponsor.example.test/offer",
      displayOrder: 2,
    });
  });

  it("rejects non-HTTPS click links before the server action runs", () => {
    expect(() =>
      brandingAssetInputSchema.parse({
        ...baseInput,
        clickUrl: "http://sponsor.example.test/offer",
      }),
    ).toThrow();
  });

  it("requires a group-scoped private storage path", () => {
    expect(() =>
      brandingAssetInputSchema.parse({
        ...baseInput,
        storagePath: "https://cdn.example.test/banner.png",
      }),
    ).toThrow();
  });

  it("rejects a fourth footer position", () => {
    expect(() =>
      brandingAssetInputSchema.parse({
        ...baseInput,
        displayOrder: 3,
      }),
    ).toThrow();
  });

  it("keeps the portal preview and footer ordering controls visible", () => {
    const form = readFileSync(
      new URL(
        "../apps/web/src/app/portal/branding/branding-form.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(form).toContain('id="branding-order"');
    expect(form).toContain('id="branding-click-url"');
    expect(form).toContain('id="branding-preview-title"');
    expect(form).toContain('id="branding-file"');
    expect(form).toContain("Remove current banner");
    expect(form).toContain("secureUrl");
  });
});
