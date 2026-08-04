import { describe, expect, it } from "vitest";

import {
  MOBILE_LINK_PATHS,
  resolveMobileLinkDestination,
} from "../apps/mobile/src/lib/auth/mobile-link-destination";

const canonicalOrigin = "https://members.greenroster.example";

describe("mobile link destination contract", () => {
  it("resolves only the current custom-scheme destinations", () => {
    for (const path of MOBILE_LINK_PATHS) {
      const url = path === "/" ? "greenroster://" : `greenroster:/${path}`;
      expect(resolveMobileLinkDestination(url, canonicalOrigin)).toEqual({
        href: path,
        source: "custom-scheme",
      });
    }

    expect(
      resolveMobileLinkDestination("greenroster://rounds", canonicalOrigin),
    ).toEqual({ href: "/rounds", source: "custom-scheme" });
    expect(
      resolveMobileLinkDestination(
        "greenroster:///leaderboard",
        canonicalOrigin,
      ),
    ).toEqual({ href: "/leaderboard", source: "custom-scheme" });
  });

  it("resolves exact paths on the configured canonical HTTPS origin", () => {
    for (const path of MOBILE_LINK_PATHS) {
      expect(
        resolveMobileLinkDestination(
          `${canonicalOrigin}${path}`,
          canonicalOrigin,
        ),
      ).toEqual({ href: path, source: "https" });
    }
  });

  it("resolves a validated result round query for notification taps", () => {
    const roundId = "70000000-0000-4000-8000-000000000001";
    expect(
      resolveMobileLinkDestination(
        `${canonicalOrigin}/rounds?roundId=${roundId}`,
        canonicalOrigin,
      ),
    ).toEqual({
      href: `/rounds?roundId=${roundId}`,
      source: "https",
    });
    expect(
      resolveMobileLinkDestination(
        `greenroster://rounds?roundId=${roundId}`,
        canonicalOrigin,
      ),
    ).toEqual({
      href: `/rounds?roundId=${roundId}`,
      source: "custom-scheme",
    });
  });

  it("rejects auth callbacks and URLs with credentials, queries, or fragments", () => {
    const rejected = [
      "greenroster://auth/callback",
      "greenroster:///auth/callback",
      "greenroster://rounds?from=email",
      "greenroster:///rounds#top",
      "https://members.greenroster.example/profile?tab=privacy",
      "https://members.greenroster.example/profile#settings",
      "https://user:password@members.greenroster.example/profile",
      "greenroster://user:password@rounds",
    ];

    for (const url of rejected) {
      expect(resolveMobileLinkDestination(url, canonicalOrigin)).toBeNull();
    }
  });

  it("rejects foreign origins, malformed URLs, and unknown or dynamic paths", () => {
    const rejected = [
      "https://attacker.example/profile",
      "http://members.greenroster.example/profile",
      "https://members.greenroster.example/rounds/123",
      "https://members.greenroster.example/auth/callback",
      "https://members.greenroster.example/unknown",
      "https://members.greenroster.example/profile/",
      "greenroster://attacker.example/profile",
      "greenroster://rounds/123",
      "greenroster://rounds/",
      "greenroster:/rounds",
      "greenroster:rounds",
      "not a URL",
      "",
    ];

    for (const url of rejected) {
      expect(resolveMobileLinkDestination(url, canonicalOrigin)).toBeNull();
    }
  });

  it("requires an exact HTTPS canonical origin", () => {
    expect(
      resolveMobileLinkDestination(
        "greenroster://profile",
        "http://127.0.0.1:3000",
      ),
    ).toEqual({ href: "/profile", source: "custom-scheme" });
    expect(
      resolveMobileLinkDestination(
        "https://members.greenroster.example/profile",
        "http://127.0.0.1:3000",
      ),
    ).toBeNull();
    expect(
      resolveMobileLinkDestination(
        "https://members.greenroster.example/profile",
        "https://members.greenroster.example/",
      ),
    ).toBeNull();
  });
});
