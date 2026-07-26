const protectedPortalPath = /^\/portal(?:\/[A-Za-z0-9_-]+)*$/;

export function resolveSafeReturnPath(value: unknown): string {
  return typeof value === "string" && protectedPortalPath.test(value)
    ? value
    : "/portal";
}

export function signInPath(returnPath: string): string {
  return `/sign-in?next=${encodeURIComponent(resolveSafeReturnPath(returnPath))}`;
}
