import { describe, expect, it } from "vitest";

import {
  buildMembershipInvitationEmail,
  renderMembershipInvitationEmail,
} from "../apps/web/src/emails/membership-invitation";
import { renderMembershipRoleChangeEmail } from "../apps/web/src/emails/membership-role-change";

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

describe("membership role change email", () => {
  it("escapes group display data, includes old/new roles, and deep-links safely", async () => {
    const email = await renderMembershipRoleChangeEmail({
      actionUrl:
        "https://greenroster.example/portal/members?membership=60000000-0000-4000-8000-000000000001",
      groupName: "<Saturday League>\n",
      oldRole: "member",
      newRole: "coordinator",
    });

    expect(email.subject).toContain("Saturday League");
    expect(email.html).toContain("&lt;Saturday League&gt;");
    expect(email.html).toContain("Member");
    expect(email.html).toContain("Coordinator");
    expect(email.html).toContain("Open GreenRoster");
    expect(email.html).toContain(
      "https://greenroster.example/portal/members?membership=60000000-0000-4000-8000-000000000001",
    );
    expect(email.html).not.toContain("<script");
    expect(email.html).not.toContain("profile");
    expect(email.text).toContain(
      "Your role changed from Member to Coordinator.",
    );
    expect(email.text).toContain(
      "Open GreenRoster: https://greenroster.example/portal/members?membership=60000000-0000-4000-8000-000000000001",
    );
  });
});
