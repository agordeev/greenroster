import { describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/app/actions/rounds", () => ({
  setRoundRsvpAction: vi.fn(),
}));

import {
  formatRsvp,
  formatRsvpChangedAt,
} from "../apps/web/src/app/member/home/member-next-round-rsvp";

describe("member next-round RSVP display", () => {
  it("labels every confirmed response state", () => {
    expect(formatRsvp("no_response")).toBe("No response");
    expect(formatRsvp("playing")).toBe("Playing");
    expect(formatRsvp("not_playing")).toBe("Not playing");
  });

  it("formats the server-confirmed timestamp in the group zone", () => {
    expect(
      formatRsvpChangedAt("2026-08-03T13:30:00.000Z", "America/New_York"),
    ).toBe("Aug 3, 2026, 9:30 AM");
  });
});
