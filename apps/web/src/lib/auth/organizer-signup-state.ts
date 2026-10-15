import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const ORGANIZER_SIGNUP_COOKIE = "greenroster_organizer_signup";
export const ORGANIZER_SIGNUP_COOKIE_PATH = "/sign-up";
export const ORGANIZER_SIGNUP_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

const payloadSchema = z
  .object({
    termsVersion: z.string().min(1).max(100),
    privacyVersion: z.string().min(1).max(100),
    source: z.string().min(1).max(64).optional(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type OrganizerSignupCookiePayload = z.infer<typeof payloadSchema>;

function signatureFor(payload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`organizer-signup:${payload}`, "utf8")
    .digest("base64url");
}

function signaturesMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createOrganizerSignupCookieValue(
  input: Readonly<{
    termsVersion: string;
    privacyVersion: string;
    source?: string | null;
    now?: number;
  }>,
  secret: string,
) {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const payload = payloadSchema.parse({
    termsVersion: input.termsVersion,
    privacyVersion: input.privacyVersion,
    source: input.source ?? undefined,
    expiresAt: now + ORGANIZER_SIGNUP_COOKIE_MAX_AGE_SECONDS,
  });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encoded}.${signatureFor(encoded, secret)}`;
}

export function readOrganizerSignupCookieValue(
  value: unknown,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): OrganizerSignupCookiePayload | null {
  if (typeof value !== "string") return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) return null;
  if (!signaturesMatch(signature, signatureFor(encoded, secret))) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(decoded);
  } catch {
    return null;
  }

  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success || parsed.data.expiresAt <= now) return null;
  return parsed.data;
}
