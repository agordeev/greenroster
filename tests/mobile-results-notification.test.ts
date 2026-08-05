import { describe, expect, it } from "vitest";

import { resolveResultsNotificationDestination } from "../apps/mobile/src/lib/notifications/mobile-results-notification";

describe("results notification destination", () => {
  it("maps only strict result payloads to a round detail route", () => {
    expect(
      resolveResultsNotificationDestination({
        type: "results_published",
        roundId: "70000000-0000-4000-8000-000000000001",
      }),
    ).toBe("/rounds?roundId=70000000-0000-4000-8000-000000000001");
    expect(
      resolveResultsNotificationDestination({
        type: "results_published",
        roundId: "70000000-0000-4000-8000-000000000001",
        extra: true,
      }),
    ).toBeNull();
  });

  it("maps strict cancellation payloads to the cancelled round detail route", () => {
    expect(
      resolveResultsNotificationDestination({
        type: "round_cancelled",
        roundId: "70000000-0000-4000-8000-000000000001",
        summary: "August Championship was cancelled: Course closure",
      }),
    ).toBe("/rounds?roundId=70000000-0000-4000-8000-000000000001");
    expect(
      resolveResultsNotificationDestination({
        type: "round_cancelled",
        roundId: "70000000-0000-4000-8000-000000000001",
      }),
    ).toBeNull();
  });

  it("maps strict publication and detail-change payloads", () => {
    expect(
      resolveResultsNotificationDestination({
        type: "round_published",
        roundId: "70000000-0000-4000-8000-000000000001",
      }),
    ).toBe("/rounds?roundId=70000000-0000-4000-8000-000000000001");
    expect(
      resolveResultsNotificationDestination({
        type: "round_details_changed",
        roundId: "70000000-0000-4000-8000-000000000001",
      }),
    ).toBe("/rounds?roundId=70000000-0000-4000-8000-000000000001");
  });

  it("rejects malformed notification data", () => {
    expect(resolveResultsNotificationDestination(null)).toBeNull();
    expect(
      resolveResultsNotificationDestination({
        type: "round_published",
        roundId: "70000000-0000-4000-8000-000000000001",
        extra: true,
      }),
    ).toBeNull();
    expect(
      resolveResultsNotificationDestination({
        type: "results_published",
        roundId: "not-a-uuid",
      }),
    ).toBeNull();
  });
});
