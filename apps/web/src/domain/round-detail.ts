import { z } from "zod";

import type { RoundFormat, RoundState } from "./round-drafts";

export const coordinatorRoundParticipantRsvpStates = [
  "no_response",
  "playing",
  "not_playing",
] as const;
export type CoordinatorRoundParticipantRsvpState =
  (typeof coordinatorRoundParticipantRsvpStates)[number];
export type CoordinatorRoundParticipantKind = "member" | "guest";

export type RoundCoordinatorRuleSnapshot = Readonly<{
  roundId: string;
  groupId: string;
  format: RoundFormat | null;
  quotaMethod:
    "moving_average" | "best_10_of_20" | "previous_plus_minus" | null;
  movingAverageHistoryLength: number | null;
  quotaPrecision: number | null;
  quotaRoundingRule: "half_away_from_zero" | null;
  adjustmentBands: readonly Record<string, unknown>[];
  settingsVersion: number;
}>;

export type RoundCoordinatorParticipant = Readonly<{
  roundId: string;
  participantId: string;
  groupId: string;
  participantKind: CoordinatorRoundParticipantKind;
  membershipId: string | null;
  sponsorMembershipId: string | null;
  firstName: string | null;
  lastName: string | null;
  rsvpStatus: CoordinatorRoundParticipantRsvpState;
  version: number;
  quotaSnapshot: string | null;
  quotaSnapshotSource: Record<string, unknown> | null;
  handicapSnapshot: string | null;
  handicapSnapshotSource: "manual" | "import" | null;
  handicapSnapshotAsOf: string | null;
  teeSnapshot: string | null;
}>;

export type RoundCoordinatorCounts = Readonly<{
  playing: number;
  notPlaying: number;
  noResponse: number;
  guests: number;
}>;

export type RoundCoordinatorDetail = Readonly<{
  roundId: string;
  groupId: string;
  description: string | null;
  scheduledAt: string | null;
  groupTimeZone: string;
  venue: string | null;
  roundUrl: string | null;
  notes: string | null;
  notesVisibleToPlayers: boolean;
  rsvpDeadlineAt: string | null;
  format: RoundFormat | null;
  state: RoundState;
  version: number;
  publishedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  ruleSnapshot: RoundCoordinatorRuleSnapshot | null;
  participants: readonly RoundCoordinatorParticipant[];
  counts: RoundCoordinatorCounts;
}>;

export function participantDisplayName(
  participant: Pick<RoundCoordinatorParticipant, "firstName" | "lastName">,
): string {
  const name = [participant.firstName, participant.lastName]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .trim();
  return name || "Unnamed participant";
}

export function formatParticipantRsvp(
  status: CoordinatorRoundParticipantRsvpState,
): string {
  return status === "no_response"
    ? "No response"
    : status === "not_playing"
      ? "Not playing"
      : "Playing";
}

export function formatSnapshotValue(value: string | null): string {
  return value === null ? "Not applicable" : value;
}

export const coordinatorRoundParticipantRsvpStateSchema = z.enum(
  coordinatorRoundParticipantRsvpStates,
);
