export function recoveryDestination(candidate: string | null) {
  return candidate === "/reset-password" ? candidate : null;
}
