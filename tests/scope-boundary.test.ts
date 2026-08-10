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

function collectMigrationFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => `${root}/${entry.name}`)
    .sort();
}

function stripSqlComments(source: string): string {
  return source.replace(/--[^\r\n]*/gu, "").replace(/\/\*[\s\S]*?\*\//gu, "");
}

function collectPublicFunctionEndpoints(source: string): readonly string[] {
  return [
    ...stripSqlComments(source).matchAll(
      /^\s*create\s+(?:or\s+replace\s+)?function\s+(?:public|"public")\s*\.\s*(?:"([a-z_][a-z0-9_$]*)"|([a-z_][a-z0-9_$]*))\s*\(/gimu,
    ),
  ].flatMap((match) => {
    const endpoint = match[1] ?? match[2];
    return endpoint ? [endpoint] : [];
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
const migrationRoot = fileURLToPath(
  new URL("../supabase/migrations/", import.meta.url),
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

const deferredPublicRpcTokens: readonly DeferredScopeToken[] = [
  {
    name: "advanced format",
    pattern: /(?:^|[^a-z0-9])advanced[-_ ]formats?(?=$|[^a-z0-9])/iu,
  },
  {
    name: "best-ball",
    pattern: /(?:^|[^a-z0-9])best[-_ ]ball(?=$|[^a-z0-9])/iu,
  },
  {
    name: "billing",
    pattern:
      /(?:^|[^a-z0-9])(?:billing|stripe|subscriptions?|entitlements?|checkout|customer[-_ ]portal|invoices?|payments?)(?=$|[^a-z0-9])/iu,
  },
  {
    name: "group-switch",
    pattern:
      /(?:^|[^a-z0-9])(?:group[-_ ]switch(?:ing)?|active[-_ ]group)(?=$|[^a-z0-9])/iu,
  },
  {
    name: "hole-by-hole",
    pattern: /(?:^|[^a-z0-9])hole[-_ ]by[-_ ]hole(?=$|[^a-z0-9])/iu,
  },
  {
    name: "free-text messaging",
    pattern:
      /(?:^|[^a-z0-9])(?:bulk[-_ ]communication|free[-_ ]text|messag(?:e|es|ing)(?:[-_ ]composer)?)(?=$|[^a-z0-9])/iu,
  },
  {
    name: "require entry",
    pattern: /(?:^|[^a-z0-9])require[-_ ]entry(?=$|[^a-z0-9])/iu,
  },
  { name: "scramble", pattern: /(?:^|[^a-z0-9])scramble(?=$|[^a-z0-9])/iu },
  { name: "skins", pattern: /(?:^|[^a-z0-9])skins(?=$|[^a-z0-9])/iu },
  { name: "sms", pattern: /(?:^|[^a-z0-9])sms(?=$|[^a-z0-9])/iu },
  { name: "teams", pattern: /(?:^|[^a-z0-9])teams?(?=$|[^a-z0-9])/iu },
];

function readSource(file: string): string {
  return readFileSync(file, "utf8");
}

function deferredPublicRpcViolations(source: string): readonly string[] {
  return collectPublicFunctionEndpoints(source).flatMap((endpoint) =>
    deferredPublicRpcTokens
      .filter(({ pattern }) => pattern.test(endpoint))
      .map(({ name }) => `${name}: ${endpoint}`),
  );
}

describe("v1 scope boundary", () => {
  it("keeps the member namespace to onboarding plus four view screens", () => {
    const memberRoot = `${webAppRoot}/member`;
    const routes = collectRouteFiles(memberRoot, "web")
      .filter((entry) => entry.file.endsWith("/page.tsx"))
      .map((entry) => entry.route)
      .sort();

    expect(routes).toContain("/first-run");
    expect(routes.filter((route) => route !== "/first-run")).toEqual([
      "/home",
      "/inbox",
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

  it("does not create deferred capability RPC endpoints in migrations", () => {
    const migrationFiles = collectMigrationFiles(migrationRoot);
    const violations = migrationFiles.flatMap((file) => {
      return deferredPublicRpcViolations(readSource(file)).map(
        (violation) => `${violation} (${file})`,
      );
    });

    expect(violations).toEqual([]);
  });

  it("detects canonical billing and active-group RPC names", () => {
    const source = [
      "create function public.create_stripe_checkout() returns void language sql as $$ select 1 $$;",
      "create function public.sync_subscription_entitlement() returns void language sql as $$ select 1 $$;",
      "create function public.list_subscriptions() returns void language sql as $$ select 1 $$;",
      "create function public.create_customer_portal_session() returns void language sql as $$ select 1 $$;",
      "create function public.set_active_group() returns void language sql as $$ select 1 $$;",
    ].join("\n");

    expect(deferredPublicRpcViolations(source)).toEqual([
      "billing: create_stripe_checkout",
      "billing: sync_subscription_entitlement",
      "billing: list_subscriptions",
      "billing: create_customer_portal_session",
      "group-switch: set_active_group",
    ]);
  });

  it("detects prefixed and quoted deferred public RPC names", () => {
    const source = [
      "-- create function public.ignore_sms()",
      "create function public.create_billing_portal() returns void as $$ begin null; end; $$ language plpgsql;",
      'create or replace function "public"."send_sms_notification"() returns void as $$ begin null; end; $$ language plpgsql;',
      "create function public.request_group_switching() returns void as $$ begin null; end; $$ language plpgsql;",
      "create function public.send_free_text_message() returns void as $$ begin null; end; $$ language plpgsql;",
      "create function public.post_round_message() returns void as $$ begin null; end; $$ language plpgsql;",
      'create function "public" . "create_team"() returns void as $$ begin null; end; $$ language plpgsql;',
      "create or replace function public.set_require_entry() returns void as $$ begin null; end; $$ language plpgsql;",
    ].join("\n");

    expect(deferredPublicRpcViolations(source)).toEqual([
      "billing: create_billing_portal",
      "sms: send_sms_notification",
      "group-switch: request_group_switching",
      "free-text messaging: send_free_text_message",
      "free-text messaging: post_round_message",
      "teams: create_team",
      "require entry: set_require_entry",
    ]);
  });

  it("keeps the existing format control closed to Individual Net and Gross", () => {
    const source = readSource(roundDraftFormFile);

    expect(source).toMatch(/roundFormats\.map\(\(option\) =>/u);
    expect(source).toContain("formatRoundFormat(option)");
    expect(source).not.toMatch(/scramble|best[-_ ]ball|hole[-_ ]by[-_ ]hole/iu);
  });
});
