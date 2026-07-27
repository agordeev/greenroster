import { describe, expect, it } from "vitest";

import {
  describeInvitationDelivery,
  filterManageableInvitations,
  filterManageableMembers,
  parseInvitationDeliveryFilter,
  parseMemberStatusFilter,
} from "../apps/web/src/domain/portal-list-filters";

describe("portal filtered list query boundaries", () => {
  it("allowlists member status filters and ignores unknown values", () => {
    expect(parseMemberStatusFilter("pending")).toBe("pending");
    expect(parseMemberStatusFilter(["inactive", "active"])).toBe("inactive");
    expect(parseMemberStatusFilter("all")).toBeNull();
    expect(parseMemberStatusFilter(undefined)).toBeNull();
  });

  it("filters already-authorized member projections without changing their shape", () => {
    const members = [
      { membershipId: "member-1", status: "pending" },
      { membershipId: "member-2", status: "active" },
      { membershipId: "member-3", status: "inactive" },
    ] as const;

    expect(filterManageableMembers(members, "active")).toEqual([members[1]]);
    expect(filterManageableMembers(members, null)).toBe(members);
    expect(filterManageableMembers(members, "pending")).toHaveLength(1);
  });

  it("allowlists the action-required invitation filter", () => {
    expect(parseInvitationDeliveryFilter("action-required")).toBe(
      "action-required",
    );
    expect(parseInvitationDeliveryFilter(["action-required"])).toBe(
      "action-required",
    );
    expect(parseInvitationDeliveryFilter("failed")).toBeNull();
  });

  it("keeps only invitations flagged as action-required by the projection", () => {
    const invitations = [
      {
        invitationId: "inv-1",
        deliveryState: "failed_permanent",
        deliveryActionRequired: true,
      },
      {
        invitationId: "inv-2",
        deliveryState: "suppressed",
        deliveryActionRequired: true,
      },
      {
        invitationId: "inv-3",
        deliveryState: "queued",
        deliveryActionRequired: false,
      },
      {
        invitationId: "inv-4",
        deliveryState: "sent",
        deliveryActionRequired: true,
      },
      {
        invitationId: "inv-5",
        deliveryState: null,
        deliveryActionRequired: false,
      },
    ] as const;

    expect(filterManageableInvitations(invitations, "action-required")).toEqual(
      [invitations[0], invitations[1], invitations[3]],
    );
    expect(filterManageableInvitations(invitations, null)).toBe(invitations);
  });

  it("does not present a complaint-suppressed sent invitation as healthy", () => {
    expect(
      describeInvitationDelivery({
        deliveryActionRequired: true,
        deliveryState: "sent",
      }),
    ).toBe(
      "Action required: the invited address is suppressed. Latest delivery: sent.",
    );
    expect(
      describeInvitationDelivery({
        deliveryActionRequired: false,
        deliveryState: "sent",
      }),
    ).toBe("Latest delivery: sent");
  });
});
