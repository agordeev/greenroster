import { createHash, timingSafeEqual } from "node:crypto";

export function cronBearerMatches(
  authorization: string | null,
  expectedSecret: string,
): boolean {
  const token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token || !expectedSecret) return false;
  const actual = createHash("sha256").update(token, "utf8").digest();
  const expected = createHash("sha256").update(expectedSecret, "utf8").digest();
  return timingSafeEqual(actual, expected);
}
