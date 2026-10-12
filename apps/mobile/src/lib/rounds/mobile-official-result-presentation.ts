import type { MobileRoundSummary } from "./mobile-rounds-api";
import type { MobileOfficialRoundResult } from "./mobile-official-results-api";

export const OFFICIAL_RESULTS_REFRESH_INTERVAL_MS = 15_000;

export function buildOfficialResultAccessibilityLabel(
  format: MobileRoundSummary["format"],
  groupTimeZone: string,
  result: MobileOfficialRoundResult,
) {
  const displayName = formatParticipantName(result);
  const primaryLabel = format === "individual_net" ? "Plus/minus" : "Points";
  const primaryValue =
    format === "individual_net" ? result.plusMinus : result.golfPoints;
  const rank =
    result.competitionRank === null ? "Unranked" : `#${result.competitionRank}`;

  return [
    `${rank}, ${displayName}`,
    result.participantKind === "guest" ? "Guest" : "Member",
    `RSVP ${formatRsvp(result.rsvpStatus)}`,
    `RSVP changed ${formatRsvpChangedAt(result.rsvpChangedAt, groupTimeZone)}`,
    `${primaryLabel} ${formatValue(primaryValue)}`,
    `Golf points ${formatValue(result.golfPoints)}`,
    `Gross ${formatValue(result.grossScore)}`,
    `Net ${formatValue(result.netScore)}`,
    `Plus/minus ${formatValue(result.plusMinus)}`,
    `Quota ${formatValue(result.quotaSnapshot)}`,
    `Participation merit ${formatValue(result.participationMerit)}`,
    `Placement merit ${formatValue(result.placementMerit)}`,
    `Total merit ${formatValue(result.totalMerit)}`,
    `Generated merit ${formatValue(result.generatedMerit)}`,
    `Manual merit ${formatValue(result.manualMerit)}`,
  ].join(", ");
}

export function formatParticipantName(result: MobileOfficialRoundResult) {
  const name = [result.firstName, result.lastName]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .trim();
  return name || "Unnamed player";
}

export function formatRsvp(status: MobileOfficialRoundResult["rsvpStatus"]) {
  switch (status) {
    case "playing":
      return "Playing";
    case "not_playing":
      return "Not Playing";
    default:
      return "No response";
  }
}

export function formatRsvpChangedAt(
  value: string | null,
  timeZone: string,
): string {
  if (!value) return "time not available";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(value));
  } catch {
    return "time not available";
  }
}

export function formatValue(value: string | null) {
  return value ?? "Not applicable";
}
