import type {
  MobileGroupDirectoryAddress,
  MobileGroupDirectoryMember,
  MobileGroupDirectoryQuery,
} from "./mobile-group-directory-api";

export type MobileGroupDirectoryEmptyState = "no_members" | "no_match";

export function canApplyDirectoryResponse(
  responseSessionUserId: string,
  currentSessionUserId: string | null,
  responseRequestId: number,
  currentRequestId: number,
) {
  return (
    responseSessionUserId === currentSessionUserId &&
    responseRequestId === currentRequestId
  );
}

export function directoryEmptyState(
  allMemberCount: number | null,
  query: MobileGroupDirectoryQuery,
): MobileGroupDirectoryEmptyState {
  if (allMemberCount === 0) return "no_members";
  return query.search || query.alphabet ? "no_match" : "no_members";
}

export function formatDirectoryMemberName(
  member: Pick<MobileGroupDirectoryMember, "firstName" | "lastName">,
) {
  const name = [member.firstName.trim(), member.lastName.trim()]
    .filter(Boolean)
    .join(" ");
  return name || "Member";
}

export function formatDirectoryTee(
  teeLocation: MobileGroupDirectoryMember["teeLocation"],
) {
  if (!teeLocation) return null;
  return {
    pro: "Pro",
    back: "Back",
    middle: "Middle",
    front: "Front",
  }[teeLocation];
}

export function nonBlankDirectoryValue(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function directoryContactLines(member: MobileGroupDirectoryMember) {
  return [
    ["Secondary e-mail", nonBlankDirectoryValue(member.secondaryEmail)],
    ["Home phone", nonBlankDirectoryValue(member.homePhone)],
    ["Work phone", nonBlankDirectoryValue(member.workPhone)],
    ["Mobile phone", nonBlankDirectoryValue(member.mobilePhone)],
  ] as const satisfies readonly (readonly [string, string | null])[];
}

export function directoryAddressLines(address: MobileGroupDirectoryAddress) {
  return [
    nonBlankDirectoryValue(address.line1),
    nonBlankDirectoryValue(address.line2),
    [
      nonBlankDirectoryValue(address.city),
      nonBlankDirectoryValue(address.stateRegion),
      nonBlankDirectoryValue(address.postalCode),
    ]
      .filter(Boolean)
      .join(", ") || null,
    nonBlankDirectoryValue(address.country),
  ].filter((line): line is string => Boolean(line));
}
