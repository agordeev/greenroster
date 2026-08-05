import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type RouteFile = Readonly<{
  file: string;
  route: string;
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
});
