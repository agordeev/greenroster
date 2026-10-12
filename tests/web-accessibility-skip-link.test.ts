import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SkipLink } from "../apps/web/src/components/blocks";

const routeFiles = [
  "../apps/web/src/app/information-shell.tsx",
  "../apps/web/src/app/portal/portal-shell.tsx",
  "../apps/web/src/app/sign-in/page.tsx",
  "../apps/web/src/app/member/home/page.tsx",
  "../apps/web/src/app/member/results/page.tsx",
  "../apps/web/src/app/member/standings/page.tsx",
] as const;

function readRoute(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

describe("web accessibility skip navigation", () => {
  it("gives every sign-in and member render branch a skip target", () => {
    for (const file of routeFiles) {
      const source = readRoute(file);
      const mainTags = [...source.matchAll(/<main\b[^>]*>/gu)].map(
        ([tag]) => tag,
      );
      const skipLinks = source.match(/<SkipLink \/>/gu);

      expect(mainTags.length, file).toBeGreaterThan(0);
      expect(
        mainTags.every((tag) => tag.includes('id="main-content"')),
        file,
      ).toBe(true);
      expect(
        mainTags.every((tag) => tag.includes("tabIndex={-1}")),
        file,
      ).toBe(true);
      expect(skipLinks?.length ?? 0, file).toBe(mainTags.length);
    }
  });

  it("renders the skip link with its text and target", () => {
    const link = SkipLink({});

    expect(link.type).toBe("a");
    expect(link.props).toMatchObject({
      href: "#main-content",
      children: "Skip to main content",
    });
  });
});
