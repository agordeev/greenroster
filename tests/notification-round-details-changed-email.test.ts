import { describe, expect, it } from "vitest";

import {
  buildRoundDetailsChangedEmail,
  renderRoundDetailsChangedEmail,
} from "../apps/web/src/emails/round-details-changed";

describe("round details changed email", () => {
  it("renders the safe changed details in accessible HTML and plain text", async () => {
    const email = await renderRoundDetailsChangedEmail({
      description: "<August Championship>",
      groupName: "<Saturday League>",
      groupTimeZone: "America/New_York",
      notificationPreferencesUrl:
        "https://greenroster.example/member/home#notifications",
      scheduledAt: "2026-08-15T13:00:00.000Z",
      venue: "<Pine Valley>\nClubhouse",
      rsvpDeadlineAt: "2026-08-12T13:00:00.000Z",
    });

    expect(email.subject).toBe("Round details changed in <Saturday League>");
    expect(email.html).toContain("Round details changed");
    expect(email.html).toContain("&lt;August Championship&gt;");
    expect(email.html).toContain("&lt;Pine Valley&gt; Clubhouse");
    expect(email.html).toContain("RSVP deadline");
    expect(email.html).toContain(
      "https://greenroster.example/member/home#notifications",
    );
    expect(email.html).not.toContain("<script");
    expect(email.html).not.toContain("notes");
    expect(email.html).not.toContain("member@example.com");
    expect(email.text).toContain("Scheduled for: Aug 15, 2026, 9:00 AM EDT");
    expect(email.text).toContain("Venue: <Pine Valley> Clubhouse");
    expect(email.text).toContain("RSVP deadline: Aug 12, 2026, 9:00 AM EDT");
    expect(email.text).toContain(
      "Manage optional e-mail notifications: https://greenroster.example/member/home#notifications",
    );
    expect(email.text).not.toContain("notes");
    expect(email.text).not.toContain("member@example.com");
  });

  it("uses explicit safe labels for missing optional venue and deadline", () => {
    const email = buildRoundDetailsChangedEmail({
      description: "August Championship",
      groupName: "Saturday League",
      groupTimeZone: "UTC",
      notificationPreferencesUrl:
        "https://greenroster.example/member/home#notifications",
      scheduledAt: "2026-08-15T13:00:00.000Z",
      venue: null,
      rsvpDeadlineAt: null,
    });

    expect(email.text).toContain("Venue: Not provided");
    expect(email.text).toContain("RSVP deadline: Not set");
  });

  it("keeps date text deterministic when the provider input is invalid", () => {
    const email = buildRoundDetailsChangedEmail({
      description: "August Championship",
      groupName: "Saturday League",
      groupTimeZone: "America/New_York",
      notificationPreferencesUrl:
        "https://greenroster.example/member/home#notifications",
      scheduledAt: "schedule supplied by the server",
      venue: "Pine Valley",
      rsvpDeadlineAt: "deadline supplied by the server",
    });

    expect(email.text).toContain(
      "Scheduled for: schedule supplied by the server",
    );
    expect(email.text).toContain(
      "RSVP deadline: deadline supplied by the server",
    );
  });
});
