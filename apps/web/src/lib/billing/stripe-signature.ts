import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader || !secret || !payload) return false;
  const parts = signatureHeader.split(",");
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const timestamp = Number(timestampPart?.slice(2));
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > toleranceSeconds
  ) {
    return false;
  }
  const signed = `${timestamp}.${payload}`;
  const expected = createHmac("sha256", secret).update(signed).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const candidates = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  return candidates.some((candidate) => {
    if (!/^[0-9a-f]{64}$/i.test(candidate)) return false;
    const candidateBytes = Buffer.from(candidate, "hex");
    return timingSafeEqual(expectedBytes, candidateBytes);
  });
}

export function createStripeSignature(
  payload: string,
  secret: string,
  timestamp: number,
): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}
