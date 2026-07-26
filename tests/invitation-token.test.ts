import { describe, expect, it } from "vitest";

import {
  buildInvitationAcceptanceUrl,
  createInvitationToken,
} from "../apps/web/src/lib/invitations/invitation-token";

const invitationId = "60000000-0000-4000-8000-000000000001";
const secret = "correct horse battery staple invitation secret";

describe("invitation token contract", () => {
  it("derives the versioned HMAC token and lowercase SHA-256 digest", async () => {
    const { createHash, createHmac } = await import("node:crypto");
    const token = createInvitationToken({ invitationId, secret });
    const expectedRawToken = createHmac("sha256", secret)
      .update(`${invitationId}:1`, "utf8")
      .digest("base64url");
    const expectedDigest = createHash("sha256")
      .update(expectedRawToken, "utf8")
      .digest("hex");

    expect(token).toEqual({
      invitationId,
      rawToken: expectedRawToken,
      tokenDigest: expectedDigest,
      keyVersion: 1,
    });
    expect(token.tokenDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("builds the allowlisted URL with the raw token only in the query", () => {
    const url = buildInvitationAcceptanceUrl({
      appUrl: "https://greenroster.example",
      invitationId,
      rawToken: "a+/token?",
    });
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://greenroster.example");
    expect(parsed.pathname).toBe("/invitations/accept");
    expect(parsed.searchParams.get("invitationId")).toBe(invitationId);
    expect(parsed.searchParams.get("token")).toBe("a+/token?");
    expect(parsed.pathname).not.toContain("a+/token?");
  });
});
