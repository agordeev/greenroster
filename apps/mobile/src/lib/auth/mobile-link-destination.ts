import type { Href } from "expo-router";

/**
 * Routes that are real protected mobile destinations today.
 *
 * Keep this list deliberately small. Resource-specific links (for example a
 * round or invitation) will add their own authenticated contracts when those
 * routes exist; they must not become accepted merely because a URL looks
 * plausible.
 */
export const MOBILE_LINK_PATHS = [
  "/",
  "/rounds",
  "/leaderboard",
  "/profile",
] as const;

export type MobileLinkPath = (typeof MOBILE_LINK_PATHS)[number];

export type MobileRoundResultDestination = `/rounds?roundId=${string}`;

/** A route string that can be handed directly to Expo Router navigation. */
export type MobileLinkDestination =
  (MobileLinkPath & Href) | (MobileRoundResultDestination & Href);

export type MobileLinkSource = "custom-scheme" | "https";

export type ResolvedMobileLinkDestination = Readonly<{
  href: MobileLinkDestination;
  source: MobileLinkSource;
}>;

const MOBILE_SCHEME = "greenroster:";

function isAllowedPath(pathname: string): pathname is MobileLinkPath {
  return (MOBILE_LINK_PATHS as readonly string[]).includes(pathname);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function resolveAllowedDestination(
  pathname: string,
  search: string,
): MobileLinkDestination | null {
  if (search === "" && isAllowedPath(pathname)) return pathname;
  if (pathname !== "/rounds") return null;
  const params = new URLSearchParams(search);
  const roundId = params.get("roundId");
  if (
    !roundId ||
    !isUuid(roundId) ||
    params.size !== 1 ||
    params.get("roundId") !== roundId
  ) {
    return null;
  }
  return `/rounds?roundId=${roundId}`;
}

function isCanonicalOrigin(value: string): boolean {
  try {
    const origin = new URL(value);

    return (
      origin.protocol === "https:" &&
      origin.origin === value &&
      origin.pathname === "/" &&
      origin.search === "" &&
      origin.hash === "" &&
      origin.username === "" &&
      origin.password === ""
    );
  } catch {
    return false;
  }
}

function resolveCustomSchemePath(parsed: URL): MobileLinkDestination | null {
  if (
    parsed.protocol !== MOBILE_SCHEME ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    return null;
  }

  // Expo's default native shape is `greenroster://rounds`; it parses the
  // route as the hostname. Triple-slash URLs (`greenroster:///rounds`) are
  // valid too, and parse the route as the pathname. No other host/path
  // combination is accepted.
  if (parsed.hostname !== "") {
    const hostPath = `/${parsed.hostname}`;
    if (parsed.pathname !== "") return null;
    return resolveAllowedDestination(hostPath, parsed.search);
  }

  // `greenroster://` is the canonical two-slash root form; URL exposes its
  // empty pathname, so normalize that one exact shape to Expo's `/` route.
  if (parsed.pathname === "" && parsed.search === "") {
    return "/";
  }

  return resolveAllowedDestination(parsed.pathname, parsed.search);
}

/**
 * Resolve an incoming app/universal link to a protected Expo Router route.
 *
 * `canonicalOrigin` is supplied by validated runtime configuration rather
 * than imported here, keeping this contract pure and making it impossible
 * for a local HTTP origin to silently widen production universal links.
 */
export function resolveMobileLinkDestination(
  value: string,
  canonicalOrigin: string,
): ResolvedMobileLinkDestination | null {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const customPath = value.startsWith("greenroster://")
    ? resolveCustomSchemePath(parsed)
    : null;
  if (customPath) {
    return { href: customPath, source: "custom-scheme" };
  }

  if (
    parsed.protocol !== "https:" ||
    !isCanonicalOrigin(canonicalOrigin) ||
    parsed.origin !== canonicalOrigin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.hash !== ""
  ) {
    return null;
  }

  const destination = resolveAllowedDestination(parsed.pathname, parsed.search);
  return destination ? { href: destination, source: "https" } : null;
}
