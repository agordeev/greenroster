import {
  resolveMobileLinkDestination,
  type MobileLinkDestination,
} from "./mobile-link-destination";

type PendingLinkReader = Readonly<{
  get(): Promise<string | null>;
}>;

export async function resumeMobilePendingDestination(
  currentDestination: MobileLinkDestination | null,
  storage: PendingLinkReader,
  canonicalOrigin: string,
): Promise<MobileLinkDestination> {
  if (currentDestination) return currentDestination;

  const storedLink = await storage.get();
  const storedDestination = storedLink
    ? resolveMobileLinkDestination(storedLink, canonicalOrigin)
    : null;

  return storedDestination?.href ?? "/profile";
}

export function hasArrivedAtMobilePendingDestination(
  pendingDestination: MobileLinkDestination | null,
  pathname: string,
): boolean {
  return pendingDestination !== null && pendingDestination === pathname;
}
