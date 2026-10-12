import { describe, expect, it } from "vitest";

import {
  buildMembershipInvitationEmail,
  renderMembershipInvitationEmail,
} from "../apps/web/src/emails/membership-invitation";
import { renderMembershipRoleChangeEmail } from "../apps/web/src/emails/membership-role-change";
import {
  buildRoundPublishedEmail,
  renderRoundPublishedEmail,
} from "../apps/web/src/emails/round-published";
import {
  buildRoundCancelledEmail,
  renderRoundCancelledEmail,
} from "../apps/web/src/emails/round-cancelled";
import { renderInvitationDeliveryFailedEmail } from "../apps/web/src/emails/invitation-delivery-failed";

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

describe("round published email", () => {
  it("includes the round details in accessible HTML and plain text", async () => {
    const email = await renderRoundPublishedEmail({
      description: "<August Championship>",
      format: "individual_net",
      groupName: "<Saturday League>",
      groupTimeZone: "America/New_York",
      notificationPreferencesUrl:
        "https://greenroster.example/member/home#notifications",
      scheduledAt: "2026-08-15T09:00:00.000Z",
    });

    expect(email.subject).toContain("Saturday League");
    expect(email.html).toContain("August Championship");
    expect(email.html).toContain("Individual Net");
    expect(email.html).toContain("&lt;Saturday League&gt;");
    expect(email.html).toContain(
      "https://greenroster.example/member/home#notifications",
    );
    expect(email.html).not.toContain("<img");
    expect(email.text).toContain("Format: Individual Net");
    expect(email.text).toContain("Scheduled for: Aug 15, 2026, 5:00 AM EDT");
    expect(email.text).toContain(
      "Manage optional e-mail notifications: https://greenroster.example/member/home#notifications",
    );
  });

  it("normalizes invalid scheduled-at display input", () => {
    const email = buildRoundPublishedEmail({
      description: "August Championship",
      format: "individual_gross",
      groupName: "Saturday League",
      groupTimeZone: "America/New_York",
      notificationPreferencesUrl:
        "https://greenroster.example/member/home#notifications",
      scheduledAt: "scheduled time supplied by the server",
    });

    expect(email.text).toContain(
      "Scheduled for: scheduled time supplied by the server",
    );
    expect(email.text).toContain("Format: Individual Gross");
  });
});

describe("round cancelled email", () => {
  it("includes the mandatory cancellation reason in HTML and plain text", async () => {
    const email = await renderRoundCancelledEmail({
      cancellationReason: "<Course closed>\n",
      description: "<August Championship>",
      groupName: "<Saturday League>",
      groupTimeZone: "America/New_York",
      scheduledAt: "2026-08-15T13:00:00.000Z",
    });

    expect(email.subject).toContain("Saturday League");
    expect(email.html).toContain("Round cancelled");
    expect(email.html).toContain("&lt;Course closed&gt;");
    expect(email.html).toContain("August Championship");
    expect(email.html).not.toContain("<img");
    expect(email.text).toContain("Reason: <Course closed>");
    expect(email.text).toContain("Scheduled for:");
  });

  it("keeps text deterministic when the cancellation reason has line breaks", () => {
    const email = buildRoundCancelledEmail({
      cancellationReason: "weather\nclosure",
      description: "August Championship",
      groupName: "Saturday League",
      groupTimeZone: "UTC",
      scheduledAt: "2026-08-15T13:00:00.000Z",
    });

    expect(email.text).toContain("Reason: weather closure");
    expect(email.text).not.toContain("weather\nclosure");
  });
});

describe("invitation delivery failed email", () => {
  it("explains the hard bounce, deep-links to invitations, and has accessible alternatives", async () => {
    const email = await renderInvitationDeliveryFailedEmail({
      actionUrl: "https://greenroster.example/portal/invitations",
      groupName: "<Saturday League>",
      invitedAddress: "bounced-invite@example.com",
    });

    expect(email.subject).toContain("Saturday League");
    expect(email.html).toContain("We couldn&#x27;t deliver an invitation");
    expect(email.html).toContain("bounced-invite@example.com");
    expect(email.html).toContain(
      "https://greenroster.example/portal/invitations",
    );
    expect(email.html).not.toContain("<img");
    expect(email.text).toContain("bounced-invite@example.com");
    expect(email.text).toContain(
      "Open invitations: https://greenroster.example/portal/invitations",
    );
  });
});
