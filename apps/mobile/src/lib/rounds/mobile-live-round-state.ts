import { z } from "zod";

import type {
  MobileLiveRoundParticipant,
  MobileLiveRoundScore,
  MobileLiveRoundScoreReceipt,
  MobileScoreChangedFields,
} from "./mobile-live-round-api";

export const mobileLiveRoundSyncStateSchema = z.enum([
  "Confirmed",
  "Pending sync",
  "Syncing",
  "Failed",
  "Locked",
]);

export type MobileLiveRoundSyncState = z.infer<
  typeof mobileLiveRoundSyncStateSchema
>;

export type MobileLiveRoundPendingScore = Readonly<{
  participantId: string;
  baseVersion: number;
  changedFields: MobileScoreChangedFields;
  deviceOperationId: string;
  operationId: string;
  correlationId: string;
  clientChangedAt: string;
  queuedAt: string;
}>;

export type MobileLiveRoundFailure = Readonly<{
  code: "permission_denied" | "stale" | "locked" | "validation" | "unavailable";
  message: string;
  correlationId?: string;
  currentScore?: MobileLiveRoundScore | null;
  permanent: boolean;
}>;

export type MobileLiveRoundParticipantState = Readonly<{
  participant: MobileLiveRoundParticipant;
  confirmed: MobileLiveRoundScore;
  syncState: MobileLiveRoundSyncState;
  pending: MobileLiveRoundPendingScore | null;
  failure: MobileLiveRoundFailure | null;
  staleCurrentValue: MobileLiveRoundScore | null;
}>;

export type MobileLiveRoundState = Readonly<{
  roundId: string;
  groupId: string;
  roundVersion: number;
  participants: readonly MobileLiveRoundParticipantState[];
  lastSyncedAt: string | null;
  stale: boolean;
}>;

export type MobileLiveRoundStateSnapshot = Readonly<{
  participants: readonly MobileLiveRoundParticipant[];
  syncedAt?: string | null;
}>;

function isLocked(participant: MobileLiveRoundParticipant) {
  return participant.rsvpStatus !== "playing" || !participant.canEdit;
}

function stateForParticipant(
  participant: MobileLiveRoundParticipant,
): MobileLiveRoundParticipantState {
  return {
    participant,
    confirmed: participant.score,
    syncState: isLocked(participant) ? "Locked" : "Confirmed",
    pending: null,
    failure: null,
    staleCurrentValue: null,
  };
}

function compareText(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareRankingValue(
  left: MobileLiveRoundScore,
  right: MobileLiveRoundScore,
) {
  if (left.rankingValue === null && right.rankingValue === null) return 0;
  if (left.rankingValue === null) return 1;
  if (right.rankingValue === null) return -1;
  const leftValue = Number(left.rankingValue);
  const rightValue = Number(right.rankingValue);
  if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
    if (leftValue !== rightValue) return rightValue - leftValue;
  } else if (left.rankingValue !== right.rankingValue) {
    return compareText(left.rankingValue, right.rankingValue);
  }
  return 0;
}

/**
 * Keep the mobile leaderboard in the same deterministic order as the server:
 * ranking descending, null values last, then normalized name and participant
 * id. Pending local values never participate in this order.
 */
export function sortMobileLiveRoundParticipants(
  participants: readonly MobileLiveRoundParticipantState[],
) {
  return [...participants].sort((left, right) => {
    const ranking = compareRankingValue(left.confirmed, right.confirmed);
    if (ranking !== 0) return ranking;
    const lastName = compareText(
      (left.participant.lastName ?? "").trim().toLowerCase(),
      (right.participant.lastName ?? "").trim().toLowerCase(),
    );
    if (lastName !== 0) return lastName;
    const firstName = compareText(
      (left.participant.firstName ?? "").trim().toLowerCase(),
      (right.participant.firstName ?? "").trim().toLowerCase(),
    );
    if (firstName !== 0) return firstName;
    return compareText(
      left.participant.participantId,
      right.participant.participantId,
    );
  });
}

export function mobileLiveRoundVisibleOrder(
  serverOrder: readonly string[],
  deferredOrder: readonly string[] | null,
) {
  if (!deferredOrder) return [...serverOrder];
  const available = new Set(serverOrder);
  const preserved = deferredOrder.filter((participantId) =>
    available.has(participantId),
  );
  return [
    ...preserved,
    ...serverOrder.filter(
      (participantId) => !preserved.includes(participantId),
    ),
  ];
}

export function mobileLiveRoundOrderIsDeferred(
  serverOrder: readonly string[],
  visibleOrder: readonly string[],
  deferredOrder: readonly string[] | null,
) {
  return (
    deferredOrder !== null &&
    (visibleOrder.length !== serverOrder.length ||
      visibleOrder.some(
        (participantId, index) => participantId !== serverOrder[index],
      ))
  );
}

function sortStateParticipants(state: MobileLiveRoundState) {
  return {
    ...state,
    participants: sortMobileLiveRoundParticipants(state.participants),
  };
}

export function createMobileLiveRoundState(
  snapshot: MobileLiveRoundStateSnapshot,
): MobileLiveRoundState {
  const first = snapshot.participants[0];
  return {
    roundId: first?.roundId ?? "",
    groupId: first?.groupId ?? "",
    roundVersion: first?.roundVersion ?? 0,
    participants: sortMobileLiveRoundParticipants(
      snapshot.participants.map(stateForParticipant),
    ),
    lastSyncedAt: snapshot.syncedAt ?? null,
    stale: false,
  };
}

export function replaceMobileLiveRoundSnapshot(
  state: MobileLiveRoundState | null,
  snapshot: MobileLiveRoundStateSnapshot,
): MobileLiveRoundState {
  const next = createMobileLiveRoundState(snapshot);
  if (!state) return next;

  const priorByParticipant = new Map(
    state.participants.map((participant) => [
      participant.participant.participantId,
      participant,
    ]),
  );
  return {
    ...next,
    participants: sortMobileLiveRoundParticipants(
      next.participants.map((participant) => {
        const prior = priorByParticipant.get(
          participant.participant.participantId,
        );
        if (prior?.failure?.code === "stale") {
          return {
            ...participant,
            syncState: "Failed",
            pending: null,
            failure: {
              ...prior.failure,
              currentScore: participant.confirmed,
            },
            staleCurrentValue: participant.confirmed,
          };
        }
        // A fresh server snapshot confirms what was previously pending. Keep a
        // local failed value visible until the user deliberately re-enters it.
        if (!prior || !prior.pending) return participant;
        if (participant.confirmed.version >= prior.pending.baseVersion + 1) {
          return participant;
        }
        return {
          ...participant,
          syncState: prior.syncState,
          pending: prior.pending,
          failure: prior.failure,
          staleCurrentValue: prior.staleCurrentValue,
        };
      }),
    ),
  };
}

function updateParticipant(
  state: MobileLiveRoundState,
  participantId: string,
  update: (
    participant: MobileLiveRoundParticipantState,
  ) => MobileLiveRoundParticipantState,
) {
  let found = false;
  const participants = state.participants.map((participant) => {
    if (participant.participant.participantId !== participantId) {
      return participant;
    }
    found = true;
    return update(participant);
  });
  return found ? { ...state, participants } : state;
}

export function markMobileLiveRoundPending(
  state: MobileLiveRoundState,
  pending: MobileLiveRoundPendingScore,
): MobileLiveRoundState {
  return updateParticipant(state, pending.participantId, (participant) => {
    if (isLocked(participant.participant)) return participant;
    return {
      ...participant,
      syncState: "Pending sync",
      pending,
      failure: null,
      staleCurrentValue: null,
    };
  });
}

export function markMobileLiveRoundSyncing(
  state: MobileLiveRoundState,
  participantId: string,
): MobileLiveRoundState {
  return updateParticipant(state, participantId, (participant) => {
    if (isLocked(participant.participant)) return participant;
    return { ...participant, syncState: "Syncing", failure: null };
  });
}

export function applyMobileLiveRoundScoreReceipt(
  state: MobileLiveRoundState,
  receipt: MobileLiveRoundScoreReceipt,
): MobileLiveRoundState {
  const next = updateParticipant(
    state,
    receipt.participantId,
    (participant) => {
      const score: MobileLiveRoundScore = {
        participantId: receipt.participantId,
        version: receipt.version,
        revisionId: receipt.revisionId,
        grossScore: receipt.grossScore,
        netScore: receipt.netScore,
        golfPoints: receipt.golfPoints,
        manualMerit: receipt.manualMerit,
        plusMinus: receipt.plusMinus,
        rankingValue: receipt.rankingValue,
        changedAt: receipt.changedAt,
      };
      return {
        ...participant,
        confirmed: score,
        syncState: isLocked(participant.participant) ? "Locked" : "Confirmed",
        pending: null,
        failure: null,
        staleCurrentValue: null,
        participant: {
          ...participant.participant,
          score,
        },
      };
    },
  );
  return sortStateParticipants(next);
}

export function markMobileLiveRoundFailed(
  state: MobileLiveRoundState,
  participantId: string,
  failure: MobileLiveRoundFailure,
): MobileLiveRoundState {
  return updateParticipant(state, participantId, (participant) => ({
    ...participant,
    syncState: "Failed",
    failure,
    staleCurrentValue: failure.currentScore ?? null,
  }));
}

export function lockMobileLiveRoundParticipant(
  state: MobileLiveRoundState,
  participantId: string,
): MobileLiveRoundState {
  return updateParticipant(state, participantId, (participant) => ({
    ...participant,
    syncState: "Locked",
    pending: null,
  }));
}

export function markMobileLiveRoundStale(
  state: MobileLiveRoundState,
): MobileLiveRoundState {
  return { ...state, stale: true };
}

export function markMobileLiveRoundFresh(
  state: MobileLiveRoundState,
  syncedAt: string | null = new Date().toISOString(),
): MobileLiveRoundState {
  return { ...state, stale: false, lastSyncedAt: syncedAt };
}

/** Apply an authorized Realtime projection without losing local sync metadata. */
export function applyMobileLiveRoundRealtimeScore(
  state: MobileLiveRoundState,
  score: MobileLiveRoundScore,
): MobileLiveRoundState {
  const next = updateParticipant(state, score.participantId, (participant) => {
    if (score.version <= participant.confirmed.version) return participant;
    if (
      participant.pending &&
      score.version <= participant.pending.baseVersion
    ) {
      return participant;
    }
    if (participant.pending) {
      return {
        ...participant,
        confirmed: score,
        participant: { ...participant.participant, score },
        syncState: "Failed",
        failure: {
          code: "stale",
          message:
            "This score changed elsewhere. Review the current value and enter your score again.",
          currentScore: score,
          permanent: true,
        },
        staleCurrentValue: score,
      };
    }
    return {
      ...participant,
      confirmed: score,
      participant: { ...participant.participant, score },
      syncState: isLocked(participant.participant) ? "Locked" : "Confirmed",
    };
  });
  return sortStateParticipants(next);
}

export function findMobileLiveRoundParticipant(
  state: MobileLiveRoundState,
  participantId: string,
) {
  return state.participants.find(
    (participant) => participant.participant.participantId === participantId,
  );
}
