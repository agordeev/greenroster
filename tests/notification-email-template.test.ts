import { describe, expect, it } from "vitest";

import {
  buildMembershipInvitationEmail,
  renderMembershipInvitationEmail,
} from "../apps/web/src/emails/membership-invitation";

const input = {
  acceptanceUrl:
    "https://greenroster.example/invitations/accept?invitationId=60000000-0000-4000-8000-000000000001&token=secret-token",
  expiresAt: "2026-08-01T12:00:00.000Z",
  firstName: "<Ava>",
  groupName: "<Saturday League>",
};

describe("membership invitation email", () => {
  it("contains the accessible link, member wording, and explicit plain text", async () => {
    const email = await renderMembershipInvitationEmail(input);

    expect(email.subject).toContain("Saturday League");
    expect(email.html).toContain("Accept your invitation");
    expect(email.html).toContain(input.acceptanceUrl.replaceAll("&", "&amp;"));
    expect(email.html).toContain("as a member on GreenRoster");
    expect(email.html).toContain("2026-08-01T12:00:00.000Z");
    expect(email.html).toContain("&lt;Ava&gt;");
    expect(email.html).not.toContain("<img");
    expect(email.text).toContain(
      `Accept your invitation: ${input.acceptanceUrl}`,
    );
    expect(email.text).toContain("as a member on GreenRoster");
  });

  it("keeps the text alternative deterministic for invalid expiry display input", () => {
    const email = buildMembershipInvitationEmail({
      ...input,
      expiresAt: "expiry supplied by the server",
    });

    expect(email.text).toContain(
      "This invitation expires on expiry supplied by the server.",
    );
  });
});
