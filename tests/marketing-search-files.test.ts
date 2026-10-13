import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/lib/runtime-env", () => ({
  webRuntimeEnv: { appUrl: "https://greenroster.example" },
}));

import { guides } from "../apps/web/src/app/(marketing)/guides/guides";
import robots from "../apps/web/src/app/robots";
import sitemap from "../apps/web/src/app/sitemap";

const appPrefixes = [
  "/portal",
  "/member",
  "/scoreboard",
  "/account",
  "/home",
  "/sign-in",
  "/recover-password",
  "/reset-password",
  "/api",
  "/auth",
];

function readPage(path: string): string {
  return readFileSync(
    new URL(`../apps/web/src/app/(marketing)${path}/page.tsx`, import.meta.url),
    "utf8",
  );
}

describe("search files for the public pages", () => {
  const paths = sitemap().map((entry) => new URL(entry.url).pathname);

  it("lists the calculator, the guides index and every guide", () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        "/tools/quota-calculator",
        "/guides",
        ...guides.map((guide) => guide.path),
      ]),
    );
  });

  it("lists no address behind sign-in", () => {
    expect(
      paths.filter((path) =>
        appPrefixes.some(
          (prefix) => path === prefix || path.startsWith(`${prefix}/`),
        ),
      ),
    ).toEqual([]);
  });

  it("points crawlers at the sitemap", () => {
    expect(robots().sitemap).toBe("https://greenroster.example/sitemap.xml");
  });

  it("gives each public page its own title, description and one h1", () => {
    const titles = new Set<string>();
    for (const path of [
      "/tools/quota-calculator",
      ...guides.map((g) => g.path),
    ]) {
      const source = readPage(path);
      const title = /title:\s*"([^"]+)"/u.exec(source)?.[1];

      expect(title, path).toBeTruthy();
      expect(source, path).toMatch(/description:/u);
      expect(source, path).toContain(`canonical:`);
      titles.add(title ?? "");
    }
    expect(titles.size).toBe(guides.length + 1);
  });

  it("keeps the word the owner ruled out off the public pages", () => {
    for (const path of [
      "/tools/quota-calculator",
      "/guides",
      ...guides.map((g) => g.path),
    ]) {
      expect(readPage(path).toLowerCase(), path).not.toContain("dogfight");
    }
  });
});
