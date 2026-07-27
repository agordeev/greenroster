import { describe, expect, it } from "vitest";

import {
  directoryAddressLines,
  canApplyDirectoryResponse,
  directoryContactLines,
  directoryEmptyState,
  formatDirectoryMemberName,
  formatDirectoryTee,
} from "../apps/mobile/src/lib/group/mobile-group-directory-presentation";

describe("mobile group directory presentation", () => {
  it("suppresses delayed responses from a prior authenticated tenant", () => {
    expect(canApplyDirectoryResponse("member-a", "member-b", 1, 1)).toBe(false);
    expect(canApplyDirectoryResponse("member-a", null, 1, 1)).toBe(false);
    expect(canApplyDirectoryResponse("member-a", "member-a", 1, 2)).toBe(false);
    expect(canApplyDirectoryResponse("member-a", "member-a", 2, 2)).toBe(true);
  });

  it("keeps no members distinct from a filter with no matches", () => {
    expect(directoryEmptyState(null, { alphabet: null, search: "" })).toBe(
      "no_members",
    );
    expect(directoryEmptyState(0, { alphabet: "A", search: "" })).toBe(
      "no_members",
    );
    expect(directoryEmptyState(3, { alphabet: "A", search: "" })).toBe(
      "no_match",
    );
  });

  it("formats only nonblank contact and address lines", () => {
    const member = {
      address: {
        city: " Denver ",
        country: "",
        line1: " 1 Main St ",
        line2: " ",
        postalCode: "80202",
        stateRegion: "CO",
      },
      firstName: " Ada ",
      homePhone: " ",
      lastName: " Lovelace ",
      membershipId: "membership",
      mobilePhone: "+1 555 0100",
      secondaryEmail: null,
      teeLocation: "middle" as const,
      workPhone: "work@example.test",
    };

    expect(formatDirectoryMemberName(member)).toBe("Ada Lovelace");
    expect(formatDirectoryTee(member.teeLocation)).toBe("Middle");
    expect(directoryContactLines(member)).toEqual([
      ["Secondary e-mail", null],
      ["Home phone", null],
      ["Work phone", "work@example.test"],
      ["Mobile phone", "+1 555 0100"],
    ]);
    expect(directoryAddressLines(member.address)).toEqual([
      "1 Main St",
      "Denver, CO, 80202",
    ]);
  });
});
