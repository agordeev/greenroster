const protectedPortalPath = /^\/portal(?:\/[A-Za-z0-9_-]+)*$/;
const protectedMemberResultsPath =
  /^\/member\/results(?:\?round_id=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})?$/;
const cleanInvitationAcceptancePath = "/invitations/accept";
const cleanMemberPaths = new Set([
  "/member/first-run",
  "/member/home",
  "/member/results",
  "/member/standings",
]);
const cleanAccountPath = "/account";

export function resolveSafeReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/portal";
  if (value === cleanInvitationAcceptancePath) return value;
  if (value === cleanAccountPath) return value;
  if (cleanMemberPaths.has(value)) return value;
  if (protectedMemberResultsPath.test(value)) return value;
  return protectedPortalPath.test(value) ? value : "/portal";
}

export function signInPath(returnPath: string): string {
  return `/sign-in?next=${encodeURIComponent(resolveSafeReturnPath(returnPath))}`;
}
