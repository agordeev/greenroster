import { describe, expect, it } from "vitest";

import {
  createInvitationAcceptanceCookieValue,
  invitationAcceptanceCookieMaxAgeSeconds,
  invitationAcceptanceOperationId,
  invitationIdFromUnknown,
  readInvitationAcceptanceCookieValue,
  tokenDigestFromUnknown,
} from "../apps/web/src/lib/invitations/invitation-acceptance-state";

const invitationId = "70000000-0000-4000-8000-000000000001";
const secret = "correct horse battery staple invitation secret";

describe("invitation acceptance handoff", () => {
  it("accepts strict UUIDs and derives only a SHA-256 digest from the raw token", () => {
    expect(invitationIdFromUnknown(invitationId)).toBe(invitationId);
    expect(
      invitationIdFromUnknown("70000000-0000-4000-8000-000000000001.extra"),
    ).toBeNull();
    const digest = tokenDigestFromUnknown(
      "a-token-that-is-long-enough-0123456789",
    );
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenDigestFromUnknown("not short")).toBeNull();
  });

  it("signs a digest-only cookie and rejects tampering or expiry", () => {
    const cookie = createInvitationAcceptanceCookieValue(
      {
        invitationId,
        tokenDigest: "a".repeat(64),
        now: 100,
        expiresAt: 200,
      },
      secret,
    );
    expect(readInvitationAcceptanceCookieValue(cookie, secret, 199)).toEqual({
      invitationId,
      tokenDigest: "a".repeat(64),
      expiresAt: 200,
    });
    expect(
      readInvitationAcceptanceCookieValue(`${cookie}x`, secret, 100),
    ).toBeNull();
    expect(
      readInvitationAcceptanceCookieValue(cookie, "another secret", 100),
    ).toBeNull();
    expect(readInvitationAcceptanceCookieValue(cookie, secret, 200)).toBeNull();
    expect(cookie).not.toContain("raw-token");
  });

  it("derives one stable UUID operation id without adding it to the cookie", () => {
    const input = { invitationId, tokenDigest: "b".repeat(64) };
    const first = invitationAcceptanceOperationId(input);
    expect(first).toBe(invitationAcceptanceOperationId(input));
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("keeps the cookie lifetime bounded by the configured invitation TTL", () => {
    expect(invitationAcceptanceCookieMaxAgeSeconds(48 * 60 * 60 * 1000)).toBe(
      48 * 60 * 60,
    );
    expect(() => invitationAcceptanceCookieMaxAgeSeconds(0)).toThrow();
  });
});
