import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const INVITATION_ACCEPTANCE_COOKIE = "greenroster_invitation";
export const INVITATION_ACCEPTANCE_COOKIE_PATH = "/invitations";
export const DEFAULT_INVITATION_ACCEPTANCE_COOKIE_MAX_AGE_SECONDS = 15 * 60;

const invitationIdSchema = z.uuid();
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,200}$/);
const cookiePayloadSchema = z
  .object({
    invitationId: z.uuid(),
    tokenDigest: z.string().regex(/^[0-9a-f]{64}$/),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type InvitationAcceptanceCookiePayload = z.infer<
  typeof cookiePayloadSchema
>;

export function invitationAcceptanceCookieMaxAgeSeconds(
  invitationTtlMilliseconds: number,
): number {
  if (
    !Number.isSafeInteger(invitationTtlMilliseconds) ||
    invitationTtlMilliseconds < 1000
  ) {
    throw new Error("Invitation TTL must be at least one second");
  }
  return Math.floor(invitationTtlMilliseconds / 1000);
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function signatureFor(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`invitation-acceptance:${payload}`, "utf8")
    .digest("base64url");
}

function signaturesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function invitationIdFromUnknown(value: unknown): string | null {
  const parsed = invitationIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function tokenDigestFromUnknown(value: unknown): string | null {
  const parsed = tokenSchema.safeParse(value);
  if (!parsed.success) return null;
  return createHash("sha256").update(parsed.data, "utf8").digest("hex");
}

/**
 * Acceptance retries need one stable operation id, but the intent cookie is
 * deliberately limited to invitation id, token digest, and expiry. Derive
 * the id from those signed values instead of adding another cookie field.
 */
export function invitationAcceptanceOperationId(
  input: Readonly<{ invitationId: string; tokenDigest: string }>,
): string {
  const digest = createHash("sha256")
    .update(
      `invitation-acceptance-operation:${input.invitationId}:${input.tokenDigest}`,
      "utf8",
    )
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-${(8 | (Number.parseInt(digest.slice(16, 17), 16) % 4)).toString(16)}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function createInvitationAcceptanceCookieValue(
  input: Readonly<{
    invitationId: string;
    tokenDigest: string;
    expiresAt?: number;
    now?: number;
  }>,
  secret: string,
): string {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const payload = cookiePayloadSchema.parse({
    invitationId: input.invitationId,
    tokenDigest: input.tokenDigest,
    expiresAt:
      input.expiresAt ??
      now + DEFAULT_INVITATION_ACCEPTANCE_COOKIE_MAX_AGE_SECONDS,
  });
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signatureFor(encodedPayload, secret)}`;
}

export function readInvitationAcceptanceCookieValue(
  value: unknown,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): InvitationAcceptanceCookiePayload | null {
  if (typeof value !== "string") return null;
  const [encodedPayload, signature, extra] = value.split(".");
  if (!encodedPayload || !signature || extra) return null;
  if (!signaturesMatch(signature, signatureFor(encodedPayload, secret))) {
    return null;
  }
  const decoded = decodeBase64Url(encodedPayload);
  if (!decoded) return null;
  const parsed = cookiePayloadSchema.safeParse(
    (() => {
      try {
        return JSON.parse(decoded);
      } catch {
        return null;
      }
    })(),
  );
  if (!parsed.success || parsed.data.expiresAt <= now) return null;
  return parsed.data;
}
