import { describe, expect, it, vi } from "vitest";

import { buildPortalDashboardSummary } from "../apps/web/src/domain/portal-dashboard";
import { executePortalDashboardData } from "../apps/web/src/lib/portal/dashboard-data";
import { MutationError } from "../apps/web/src/lib/mutations/result";

describe("portal dashboard summary", () => {
  it("counts every membership state and trusts the action-required projection", () => {
    const summary = buildPortalDashboardSummary(
      [
        { status: "pending" },
        { status: "active" },
        { status: "active" },
        { status: "inactive" },
      ],
      [
        { deliveryState: "failed_permanent", deliveryActionRequired: true },
        { deliveryState: "suppressed", deliveryActionRequired: true },
        { deliveryState: "queued", deliveryActionRequired: false },
        { deliveryState: "sent", deliveryActionRequired: false },
        { deliveryState: "sent", deliveryActionRequired: true },
        { deliveryState: null, deliveryActionRequired: false },
      ],
    );

    expect(summary).toEqual({
      membershipCounts: { pending: 1, active: 2, inactive: 1 },
      actionRequiredInvitations: {
        failedPermanent: 1,
        suppressed: 1,
        addressSuppression: 1,
        total: 3,
      },
    });
  });

  it("returns a calm zero-issue summary when all deliveries are healthy", () => {
    expect(
      buildPortalDashboardSummary(
        [],
        [
          { deliveryState: "queued", deliveryActionRequired: false },
          { deliveryState: "sent", deliveryActionRequired: false },
        ],
      ).actionRequiredInvitations,
    ).toEqual({
      failedPermanent: 0,
      suppressed: 0,
      addressSuppression: 0,
      total: 0,
    });
  });

  it("reuses both server-authoritative projections for one dashboard read", async () => {
    const listMembers = vi
      .fn()
      .mockResolvedValue([{ status: "pending" }, { status: "active" }]);
    const listInvitations = vi
      .fn()
      .mockResolvedValue([
        { deliveryState: "suppressed", deliveryActionRequired: true },
      ]);

    await expect(
      executePortalDashboardData("10000000-0000-4000-8000-000000000001", {
        listMembers,
        listInvitations,
      }),
    ).resolves.toEqual({
      membershipCounts: { pending: 1, active: 1, inactive: 0 },
      actionRequiredInvitations: {
        failedPermanent: 0,
        suppressed: 1,
        addressSuppression: 0,
        total: 1,
      },
    });
    expect(listMembers).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
    );
    expect(listInvitations).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
    );
  });

  it("does not turn a projection failure into a fabricated zero", async () => {
    const unavailable = new MutationError("unavailable");

    await expect(
      executePortalDashboardData("10000000-0000-4000-8000-000000000001", {
        listMembers: vi.fn().mockRejectedValue(unavailable),
        listInvitations: vi.fn().mockResolvedValue([]),
      }),
    ).rejects.toBe(unavailable);
  });
});
