import { describe, expect, it } from "vitest";

import { createGreenRosterExpoConfig } from "../apps/mobile/app.config";

const baseConfig = {
  name: "GreenRoster",
  slug: "greenroster",
};

describe("mobile app-link registration", () => {
  it("registers the canonical HTTPS origin for iOS and Android", () => {
    const config = createGreenRosterExpoConfig(
      baseConfig,
      "https://members.greenroster.example",
    );

    expect(config.ios?.associatedDomains).toEqual([
      "applinks:members.greenroster.example",
    ]);
    expect(config.android?.intentFilters).toEqual([
      {
        action: "VIEW",
        autoVerify: true,
        category: ["BROWSABLE", "DEFAULT"],
        data: ["/", "/rounds", "/leaderboard", "/profile"].map((path) => ({
          scheme: "https",
          host: "members.greenroster.example",
          path,
        })),
      },
    ]);
  });

  it("keeps local HTTP development on the custom application scheme", () => {
    const config = createGreenRosterExpoConfig(
      baseConfig,
      "http://127.0.0.1:3000",
    );

    expect(config.ios?.associatedDomains).toBeUndefined();
    expect(config.android?.intentFilters).toBeUndefined();
  });

  it("rejects an HTTPS origin that cannot be associated by hostname", () => {
    expect(() =>
      createGreenRosterExpoConfig(
        baseConfig,
        "https://members.greenroster.example:8443",
      ),
    ).toThrowError("HTTPS application links require the default port");
  });
});
