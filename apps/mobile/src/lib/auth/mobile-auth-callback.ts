import { z } from "zod";

export const MOBILE_AUTH_CALLBACK_URL = "greenroster://auth/callback";
const recoveryStateSchema = z.uuid();

export type MobileAuthCallback =
  | Readonly<{ kind: "code"; code: string; recoveryState: string }>
  | Readonly<{ kind: "error" }>
  | Readonly<{ kind: "ignored" }>;

export function parseMobileAuthCallback(url: string): MobileAuthCallback {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return { kind: "ignored" };
  }

  if (
    parsed.protocol !== "greenroster:" ||
    parsed.hostname !== "auth" ||
    parsed.pathname !== "/callback"
  ) {
    return { kind: "ignored" };
  }

  if (parsed.searchParams.has("error")) {
    return { kind: "error" };
  }

  const code = parsed.searchParams.get("code")?.trim();
  const recoveryState = recoveryStateSchema.safeParse(
    parsed.searchParams.get("recovery_state"),
  );

  return code && recoveryState.success
    ? { kind: "code", code, recoveryState: recoveryState.data }
    : { kind: "error" };
}
