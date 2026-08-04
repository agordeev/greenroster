export const PRIVACY_REQUEST_RECENT_AUTH_WINDOW_MS = 15 * 60 * 1000;

export function hasRecentPrivacyAuthentication(
  sessionStartedAt: string | null,
  now = Date.now(),
): boolean {
  if (!sessionStartedAt) return false;

  const signedInAt = Date.parse(sessionStartedAt);
  if (!Number.isFinite(signedInAt)) return false;

  const age = now - signedInAt;
  return age >= 0 && age <= PRIVACY_REQUEST_RECENT_AUTH_WINDOW_MS;
}
