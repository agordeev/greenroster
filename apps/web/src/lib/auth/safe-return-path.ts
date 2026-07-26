const protectedPortalPath = /^\/portal(?:\/[A-Za-z0-9_-]+)*$/;
const cleanInvitationAcceptancePath = "/invitations/accept";
const cleanMemberPaths = new Set(["/member/first-run", "/member/home"]);

export function resolveSafeReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/portal";
  if (value === cleanInvitationAcceptancePath) return value;
  if (cleanMemberPaths.has(value)) return value;
  return protectedPortalPath.test(value) ? value : "/portal";
}

export function signInPath(returnPath: string): string {
  return `/sign-in?next=${encodeURIComponent(resolveSafeReturnPath(returnPath))}`;
}
