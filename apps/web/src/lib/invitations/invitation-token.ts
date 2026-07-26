import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";

export const INVITATION_TOKEN_KEY_VERSION = 1 as const;
export const INVITATION_ACCEPTANCE_PATH = "/invitations/accept/start" as const;

export type InvitationToken = Readonly<{
  invitationId: string;
  rawToken: string;
  tokenDigest: string;
  keyVersion: typeof INVITATION_TOKEN_KEY_VERSION;
}>;

export type InvitationTokenInput = Readonly<{
  invitationId: string;
  secret: string;
  keyVersion?: typeof INVITATION_TOKEN_KEY_VERSION;
}>;

/**
 * Derive the one-time token from the server-issued invitation identifier.
 * The raw value is returned only so the authorized issuance response can put
 * it in the invitation URL; callers must never persist or log it.
 */
export function createInvitationToken(
  input: InvitationTokenInput,
): InvitationToken {
  const keyVersion = input.keyVersion ?? INVITATION_TOKEN_KEY_VERSION;

  if (keyVersion !== INVITATION_TOKEN_KEY_VERSION) {
    throw new Error("Unsupported invitation token key version");
  }

  const rawToken = createHmac("sha256", input.secret)
    .update(`${input.invitationId}:${keyVersion}`, "utf8")
    .digest("base64url");
  const tokenDigest = createHash("sha256")
    .update(rawToken, "utf8")
    .digest("hex");

  return {
    invitationId: input.invitationId,
    rawToken,
    tokenDigest,
    keyVersion,
  };
}

export function createInvitationId(): string {
  return randomUUID();
}

export type InvitationAcceptanceUrlInput = Readonly<{
  appUrl: string;
  invitationId: string;
  rawToken: string;
}>;

/** Build the allowlisted acceptance URL without ever putting the digest in it. */
export function buildInvitationAcceptanceUrl(
  input: InvitationAcceptanceUrlInput,
): string {
  const url = new URL(INVITATION_ACCEPTANCE_PATH, input.appUrl);
  url.searchParams.set("invitationId", input.invitationId);
  url.searchParams.set("token", input.rawToken);
  return url.toString();
}
