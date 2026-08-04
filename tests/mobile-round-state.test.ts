import { describe, expect, it } from "vitest";

import {
  applyMobileRoundRsvpReceipt,
  createMobileRoundDetailState,
  markMobileRoundRsvpFailed,
  markMobileRoundRsvpPending,
} from "../apps/mobile/src/lib/rounds/mobile-round-state";

const detail = {
  roundId: "10000000-0000-4000-8000-000000000001",
  groupId: "20000000-0000-4000-8000-000000000001",
  description: "Saturday round",
  scheduledAt: "2026-08-08T12:00:00.000Z",
  groupTimeZone: "UTC",
  venue: "North Course",
  format: "individual_net" as const,
  state: "published" as const,
  version: 2,
  participantStatus: "no_response" as const,
  participantVersion: 1,
  participantCount: 4,
  playingCount: 2,
  updatedAt: "2026-08-04T12:00:00.000Z",
  roundUrl: null,
  notes: "Bring carts.",
  rsvpDeadlineAt: "2026-08-08T10:00:00.000Z",
  rsvpChangedAt: null,
  cancelledAt: null,
  cancellationReason: null,
};

describe("mobile round RSVP state", () => {
  it("keeps a local pending choice distinct from confirmed state", () => {
    const initial = createMobileRoundDetailState(detail);
    const pending = markMobileRoundRsvpPending(initial, "playing");

    expect(pending).toMatchObject({
      confirmedStatus: "no_response",
      pendingStatus: "playing",
      syncState: "Pending",
    });
  });

  it("applies only a matching server receipt and clears pending state", () => {
    const initial = markMobileRoundRsvpPending(
      createMobileRoundDetailState(detail),
      "playing",
    );
    const confirmed = applyMobileRoundRsvpReceipt(initial, {
      roundId: detail.roundId,
      groupId: detail.groupId,
      participantId: "30000000-0000-4000-8000-000000000001",
      membershipId: "40000000-0000-4000-8000-000000000001",
      rsvpStatus: "playing",
      version: 2,
      changedAt: "2026-08-04T12:01:00.000Z",
    });

    expect(confirmed).toMatchObject({
      confirmedStatus: "playing",
      confirmedVersion: 2,
      pendingStatus: null,
      syncState: "Confirmed",
      detail: {
        participantStatus: "playing",
        participantVersion: 2,
      },
    });
  });

  it("rolls back failed responses to the last confirmed choice", () => {
    const initial = markMobileRoundRsvpPending(
      createMobileRoundDetailState({
        ...detail,
        participantStatus: "not_playing",
      }),
      "playing",
    );
    const failed = markMobileRoundRsvpFailed(
      initial,
      "This round is no longer accepting RSVP changes.",
    );

    expect(failed).toMatchObject({
      confirmedStatus: "not_playing",
      pendingStatus: null,
      syncState: "Failed",
      failure: "This round is no longer accepting RSVP changes.",
    });
  });
});
