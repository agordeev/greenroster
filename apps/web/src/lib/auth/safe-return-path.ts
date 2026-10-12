const protectedPortalPath = /^\/portal(?:\/[A-Za-z0-9_-]+)*$/;
const protectedMemberResultsPath =
  /^\/member\/results(?:\?round_id=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})?$/;
const protectedMemberRoundPath =
  /^\/member\/rounds\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const cleanPaths = new Set([
  "/invitations/accept",
  "/account",
  "/account/privacy",
  "/member/first-run",
  "/member/home",
  "/member/inbox",
  "/member/profile",
  "/member/directory",
  "/member/results",
  "/member/standings",
]);

export function resolveSafeReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/portal";
  if (cleanPaths.has(value)) return value;
  if (
    protectedMemberResultsPath.test(value) ||
    protectedMemberRoundPath.test(value)
  ) {
    return value;
  }
  return protectedPortalPath.test(value) ? value : "/portal";
}

export function signInPath(returnPath: string): string {
  return `/sign-in?next=${encodeURIComponent(resolveSafeReturnPath(returnPath))}`;
}

export function memberAuthDestination(candidate: string | null): string | null {
  const destination = resolveSafeReturnPath(candidate);
  return destination.startsWith("/member/") ? destination : null;
}
