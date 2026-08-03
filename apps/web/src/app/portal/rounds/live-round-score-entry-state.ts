import type {
  LiveRoundScoreParticipant,
  RoundScoreChangedFields,
  RoundScoreCurrentState,
  RoundScoreField,
} from "@/domain/round-score";

export type LiveRoundScoreDraft = Readonly<Record<RoundScoreField, string>>;

export type ScoreMutationContext = Readonly<{
  operationId: string | null;
  deviceOperationId: string | null;
  clientChangedAt: string | null;
}>;

export function resetScoreMutationContext(): ScoreMutationContext {
  return {
    operationId: null,
    deviceOperationId: null,
    clientChangedAt: null,
  };
}

export function retainScoreMutationContext(
  current: ScoreMutationContext,
  createOperationId: () => string,
  createClientChangedAt: () => string,
): ScoreMutationContext {
  return {
    operationId: current.operationId ?? createOperationId(),
    deviceOperationId: current.deviceOperationId ?? createOperationId(),
    clientChangedAt: current.clientChangedAt ?? createClientChangedAt(),
  };
}

export function enabledRoundScoreFields(
  participant: Pick<
    LiveRoundScoreParticipant,
    "enabledFields" | "canAuthorManualMerit"
  >,
): readonly RoundScoreField[] {
  const fields: RoundScoreField[] = [];
  if (participant.enabledFields.golfPoints) fields.push("golf_points");
  if (participant.enabledFields.grossScore) fields.push("gross_score");
  if (participant.enabledFields.netScore) fields.push("net_score");
  if (participant.canAuthorManualMerit) fields.push("manual_merit");
  return fields;
}

export function scoreValueForField(
  score: Pick<
    RoundScoreCurrentState,
    "golfPoints" | "grossScore" | "netScore" | "manualMerit"
  >,
  field: RoundScoreField,
): string | null {
  switch (field) {
    case "golf_points":
      return score.golfPoints;
    case "gross_score":
      return score.grossScore;
    case "net_score":
      return score.netScore;
    case "manual_merit":
      return score.manualMerit;
  }
}

export function scoreDraftFromCurrentScore(
  score: RoundScoreCurrentState,
): LiveRoundScoreDraft {
  return {
    golf_points: score.golfPoints ?? "",
    gross_score: score.grossScore ?? "",
    net_score: score.netScore ?? "",
    manual_merit: score.manualMerit ?? "",
  };
}

export function sameScoreValue(
  left: number | null,
  right: string | number | null,
): boolean {
  if (left === null) return right === null || String(right).trim() === "";
  if (right === null || String(right).trim() === "") return false;
  const rightNumber = Number(right);
  return Number.isFinite(rightNumber) && left === rightNumber;
}

export function changedFieldsFromDraft(
  draft: LiveRoundScoreDraft,
  score: RoundScoreCurrentState,
  fields: readonly RoundScoreField[],
): Readonly<{
  changedFields: RoundScoreChangedFields;
  invalidField: RoundScoreField | null;
}> {
  const changedFields: Record<string, number | null> = {};
  let invalidField: RoundScoreField | null = null;

  for (const field of fields) {
    const rawValue = draft[field].trim();
    const nextValue = rawValue === "" ? null : Number(rawValue);
    if (nextValue !== null && !Number.isFinite(nextValue)) {
      invalidField ??= field;
      continue;
    }

    if (!sameScoreValue(nextValue, scoreValueForField(score, field))) {
      changedFields[field] = nextValue;
    }
  }

  return { changedFields, invalidField };
}

/**
 * A visual-only preview for the points field. Official values still come from
 * the score RPC; this mirrors its snapshot formula so a likely entry mistake
 * is visible before submit.
 */
export function plusMinusPreviewFromDraft(
  participant: Pick<LiveRoundScoreParticipant, "quotaSnapshot">,
  draft: Pick<LiveRoundScoreDraft, "golf_points">,
): string | null {
  const rawPoints = draft.golf_points.trim();
  if (!rawPoints || participant.quotaSnapshot === null) return null;
  const points = Number(rawPoints);
  const quota = Number(participant.quotaSnapshot);
  if (!Number.isFinite(points) || !Number.isFinite(quota)) return null;
  return (points - quota).toFixed(2);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCurrentScore(value: unknown): value is RoundScoreCurrentState {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.participantId === "string" &&
    typeof record.version === "number" &&
    Number.isSafeInteger(record.version) &&
    record.version >= 0 &&
    isNullableString(record.revisionId) &&
    isNullableString(record.grossScore) &&
    isNullableString(record.netScore) &&
    isNullableString(record.golfPoints) &&
    isNullableString(record.manualMerit) &&
    isNullableString(record.plusMinus) &&
    isNullableString(record.rankingValue) &&
    isNullableString(record.changedAt)
  );
}

export function currentScoreFromStaleDetails(
  details: unknown,
  participantId: string,
): RoundScoreCurrentState | null {
  if (typeof details !== "object" || details === null) return null;
  const currentScore = (details as Record<string, unknown>).currentScore;
  return isCurrentScore(currentScore) &&
    currentScore.participantId === participantId
    ? currentScore
    : null;
}
