import "server-only";

import { createHash, createHmac } from "node:crypto";

export const SCOREBOARD_TOKEN_KEY_VERSION = 1 as const;

export function createScoreboardToken(
  input: Readonly<{
    accessId: string;
    secret: string;
    keyVersion?: typeof SCOREBOARD_TOKEN_KEY_VERSION;
  }>,
): string {
  const keyVersion = input.keyVersion ?? SCOREBOARD_TOKEN_KEY_VERSION;
  if (keyVersion !== SCOREBOARD_TOKEN_KEY_VERSION) {
    throw new Error("Unsupported scoreboard token key version");
  }

  return createHmac("sha256", input.secret)
    .update(`scoreboard:${input.accessId}:${keyVersion}`, "utf8")
    .digest("base64url");
}

export function scoreboardTokenDigest(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
