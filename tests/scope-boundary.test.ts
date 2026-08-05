import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type RouteFile = Readonly<{
  file: string;
  route: string;
}>;

type DeferredScopeToken = Readonly<{
  name: string;
  pattern: RegExp;
}>;

function collectRouteFiles(
  root: string,
  kind: "mobile" | "web",
  relativeDirectory = "",
): readonly RouteFile[] {
  const directory = `${root}${relativeDirectory ? `/${relativeDirectory}` : ""}`;
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryRelativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      return collectRouteFiles(root, kind, entryRelativePath);
    }

    const isRoute =
      kind === "web"
        ? entry.name === "page.tsx" || entry.name === "route.ts"
        : !entry.name.startsWith("_") && /\.(tsx|ts)$/.test(entry.name);
    if (!isRoute) return [];

    const routeDirectory = dirname(entryRelativePath)
      .split("/")
      .filter((segment) => segment !== ".")
      .join("/");
    return [
      {
        file: `${directory}/${entry.name}`,
        route: `/${routeDirectory}`.replace(/\/+/g, "/"),
      },
    ];
  });
}

function collectSourceFiles(
  root: string,
  relativeDirectory = "",
): readonly string[] {
  const directory = `${root}${relativeDirectory ? `/${relativeDirectory}` : ""}`;
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryRelativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      return collectSourceFiles(root, entryRelativePath);
    }
    return /\.(tsx|ts)$/u.test(entry.name)
      ? [`${directory}/${entry.name}`]
      : [];
  });
}

function routeSegments(route: string): readonly string[] {
  return route
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
}

const webAppRoot = fileURLToPath(
  new URL("../apps/web/src/app/", import.meta.url),
);
const mobileAppRoot = fileURLToPath(
  new URL("../apps/mobile/src/app/", import.meta.url),
);
const webSourceRoot = fileURLToPath(
  new URL("../apps/web/src/", import.meta.url),
);
const mobileSourceRoot = fileURLToPath(
  new URL("../apps/mobile/src/", import.meta.url),
);
const roundDraftFormFile = fileURLToPath(
  new URL(
    "../apps/web/src/app/portal/rounds/round-draft-form.tsx",
    import.meta.url,
  ),
);

const deferredScopeTokens: readonly DeferredScopeToken[] = [
  { name: "advanced format", pattern: /\badvanced[-_ ]formats?\b/iu },
  { name: "best-ball", pattern: /\bbest[-_ ]ball\b/iu },
  { name: "billing", pattern: /\bbilling\b/iu },
  { name: "group-switch", pattern: /\bgroup[-_ ]switch\b/iu },
  { name: "hole-by-hole", pattern: /\bhole[-_ ]by[-_ ]hole\b/iu },
  { name: "message composer", pattern: /\bmessage[-_ ]composer\b/iu },
  { name: "scramble", pattern: /\bscramble\b/iu },
  { name: "skins", pattern: /\bskins\b/iu },
  { name: "sms", pattern: /\bsms\b/iu },
  { name: "teams", pattern: /\bteams\b/iu },
];

function readSource(file: string): string {
  return readFileSync(file, "utf8");
}

describe("v1 scope boundary", () => {
  it("keeps the member namespace to onboarding plus three view screens", () => {
    const memberRoot = `${webAppRoot}/member`;
    const routes = collectRouteFiles(memberRoot, "web")
      .filter((entry) => entry.file.endsWith("/page.tsx"))
      .map((entry) => entry.route)
      .sort();

    expect(routes).toContain("/first-run");
    expect(routes.filter((route) => route !== "/first-run")).toEqual([
      "/home",
      "/results",
      "/standings",
    ]);
  });

  it("does not expose deferred capability route segments", () => {
    const routeFiles = [
      ...collectRouteFiles(webAppRoot, "web"),
      ...collectRouteFiles(mobileAppRoot, "mobile"),
    ];
    const deferredSegments = new Set([
      "advanced",
      "best-ball",
      "best_ball",
      "billing",
      "group-switch",
      "group_switch",
      "hole-by-hole",
      "hole_by_hole",
      "message",
      "message-composer",
      "message_composer",
      "messages",
      "scramble",
      "skins",
      "sms",
      "teams",
    ]);
    const violations = routeFiles.flatMap((entry) =>
      routeSegments(entry.route)
        .filter((segment) => deferredSegments.has(segment))
        .map((segment) => `${segment}: ${entry.route}`),
    );

    expect(violations).toEqual([]);
  });

  it("does not expose deferred capability controls or links in app sources", () => {
    const sourceFiles = [
      ...collectSourceFiles(webSourceRoot),
      ...collectSourceFiles(mobileSourceRoot),
    ];
    const violations = sourceFiles.flatMap((file) => {
      const source = readSource(file);
      return deferredScopeTokens
        .filter(({ pattern }) => pattern.test(source))
        .map(({ name }) => `${name}: ${file}`);
    });

    expect(violations).toEqual([]);
  });

  it("keeps the existing format control closed to Individual Net and Gross", () => {
    const source = readSource(roundDraftFormFile);

    expect(source).toMatch(/roundFormats\.map\(\(option\) =>/u);
    expect(source).toContain("formatRoundFormat(option)");
    expect(source).not.toMatch(/scramble|best[-_ ]ball|hole[-_ ]by[-_ ]hole/iu);
  });
});
