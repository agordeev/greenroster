"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { setRoundParticipantScoreAction } from "@/app/actions/rounds";
import { EmptyState, SectionHeading } from "@/components/ui";
import {
  roundScoreInputSchema,
  type LiveRoundScoreParticipant,
  type RoundScoreCurrentState,
  type RoundScoreField,
  type RoundScoreReceipt,
} from "@/domain/round-score";

import {
  changedFieldsFromDraft,
  currentScoreFromStaleDetails,
  enabledRoundScoreFields,
  plusMinusPreviewFromDraft,
  resetScoreMutationContext,
  retainScoreMutationContext,
  scoreDraftFromCurrentScore,
  scoreValueForField,
  type LiveRoundScoreDraft,
  type ScoreMutationContext,
} from "./live-round-score-entry-state";

const fieldLabels: Readonly<Record<RoundScoreField, string>> = {
  golf_points: "Golf points",
  gross_score: "Gross score",
  net_score: "Net score",
  manual_merit: "Manual merit",
};

const fieldConstraints: Readonly<
  Record<RoundScoreField, { min: number; max: number; step: string }>
> = {
  golf_points: { min: 0, max: 100, step: "0.01" },
  gross_score: { min: 0, max: 300, step: "1" },
  net_score: { min: 0, max: 300, step: "1" },
  manual_merit: { min: -1000, max: 1000, step: "0.01" },
};

export function LiveRoundScoreEntryPanel({
  participants,
}: Readonly<{
  participants: readonly LiveRoundScoreParticipant[];
}>) {
  return (
    <section
      className="page-section live-score-entry"
      aria-labelledby="live-score-entry-title"
    >
      <SectionHeading
        kicker="Round day"
        title="Enter live scores"
        titleId="live-score-entry-title"
        meta={
          <>
            {participants.length} player{participants.length === 1 ? "" : "s"}
          </>
        }
      />
      <p>
        Enter only the totals turned on for this round. Plus/minus and ranking
        are worked out for you. Blank scores show Missing and are never counted
        as zero.
      </p>
      {participants.length === 0 ? (
        <EmptyState>No players are available to score yet.</EmptyState>
      ) : (
        <div className="row-list">
          {participants.map((participant) => (
            <ParticipantScoreEditor
              key={participantSyncKey(participant)}
              participant={participant}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ParticipantScoreEditor({
  participant,
}: Readonly<{ participant: LiveRoundScoreParticipant }>) {
  const router = useRouter();
  const [score, setScore] = useState<RoundScoreCurrentState>(participant.score);
  const [draft, setDraft] = useState<LiveRoundScoreDraft>(() =>
    scoreDraftFromCurrentScore(participant.score),
  );
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "">("");
  const [staleCurrentScore, setStaleCurrentScore] =
    useState<RoundScoreCurrentState | null>(null);
  const [pending, startTransition] = useTransition();
  const mutationContext = useRef<ScoreMutationContext>(
    resetScoreMutationContext(),
  );

  const fields = enabledRoundScoreFields(participant);
  const locked = participant.rsvpStatus !== "playing";
  const readOnly = locked || !participant.canEdit;
  const name = [participant.firstName, participant.lastName]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .trim();
  const displayName = name || "Unnamed player";
  const playerLabel =
    participant.participantKind === "guest"
      ? `${displayName} · Guest`
      : displayName;
  const scoreState = locked
    ? "Locked"
    : score.version === 0
      ? "Missing"
      : "Confirmed";
  const formId = `live-score-entry-${participant.participantId}`;
  const typedPlusMinus = plusMinusPreviewFromDraft(participant, draft);

  function updateDraft(field: RoundScoreField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    mutationContext.current = resetScoreMutationContext();
    setMessage("");
    setMessageTone("");
    setStaleCurrentScore(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || readOnly) return;
    setMessage("");
    setMessageTone("");

    const { changedFields, invalidField } = changedFieldsFromDraft(
      draft,
      score,
      fields,
    );
    if (invalidField) {
      setMessage(`Enter a valid ${fieldLabels[invalidField].toLowerCase()}.`);
      setMessageTone("error");
      return;
    }
    if (Object.keys(changedFields).length === 0) {
      setMessage("Change at least one score before you save.");
      setMessageTone("error");
      return;
    }

    const normalizedReason = reason.trim();
    const requiresCorrectionReason = Object.keys(changedFields).some(
      (field) => scoreValueForField(score, field as RoundScoreField) !== null,
    );
    if (requiresCorrectionReason && !normalizedReason) {
      setMessage("Add a reason to change a score that's already saved.");
      setMessageTone("error");
      return;
    }

    mutationContext.current = retainScoreMutationContext(
      mutationContext.current,
      () => crypto.randomUUID(),
      () => new Date().toISOString(),
    );
    const parsed = roundScoreInputSchema.safeParse({
      participantId: participant.participantId,
      changedFields,
      expectedScoreVersion: score.version,
      deviceOperationId: mutationContext.current.deviceOperationId,
      reason: normalizedReason || null,
      clientChangedAt: mutationContext.current.clientChangedAt,
      operationId: mutationContext.current.operationId,
    });
    if (!parsed.success) {
      setMessage("Review the score values and try again.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof setRoundParticipantScoreAction>>;
      try {
        result = await setRoundParticipantScoreAction(parsed.data);
      } catch {
        setMessage("The score wasn't saved. Try again.");
        setMessageTone("error");
        return;
      }

      if (!result.ok) {
        setMessage(result.error.message);
        setMessageTone("error");
        if (result.error.code === "stale_version") {
          const currentScore = currentScoreFromStaleDetails(
            result.error.details,
            participant.participantId,
          );
          if (currentScore) {
            setScore(currentScore);
            setDraft(scoreDraftFromCurrentScore(currentScore));
            setStaleCurrentScore(currentScore);
          }
          setReason("");
          setMessage(
            currentScore
              ? "This score changed while you were entering it. The current scores are shown below. Enter your score again before you save."
              : "This score changed while you were entering it. Refresh the page and enter your score again.",
          );
          mutationContext.current = resetScoreMutationContext();
          router.refresh();
        } else if (
          result.error.code === "locked" ||
          result.error.code === "operation_reused"
        ) {
          mutationContext.current = resetScoreMutationContext();
          if (result.error.code === "locked") router.refresh();
        }
        return;
      }

      const nextScore = scoreFromReceipt(result.data);
      setScore(nextScore);
      setDraft(scoreDraftFromCurrentScore(nextScore));
      setReason("");
      setStaleCurrentScore(null);
      setMessage("Score saved.");
      setMessageTone("success");
      mutationContext.current = resetScoreMutationContext();
    });
  }

  return (
    <article className="row-item" data-score-state={scoreState.toLowerCase()}>
      <div className="section-heading">
        <div>
          <h3>{playerLabel}</h3>
          <p>
            {locked
              ? "Not playing · score entry locked"
              : participant.canEdit
                ? "Playing · you can enter scores"
                : "Playing · view only"}
          </p>
        </div>
        <p>{scoreState}</p>
      </div>

      {staleCurrentScore ? (
        <aside className="form-message error" role="alert">
          <strong>Current scores</strong>
          <span>{formatServerValues(staleCurrentScore, fields)}</span>
          <span>
            Enter your score again to save it. Nothing was overwritten.
          </span>
        </aside>
      ) : null}

      <form
        id={formId}
        className="form-stack"
        onSubmit={submit}
        aria-busy={pending}
        noValidate
      >
        <div className="form-row">
          {fields.map((field) => (
            <ScoreFieldInput
              key={field}
              field={field}
              formId={formId}
              playerLabel={playerLabel}
              value={draft[field]}
              confirmedValue={scoreValueForField(score, field)}
              disabled={readOnly || pending}
              onChange={(value) => updateDraft(field, value)}
            />
          ))}
        </div>

        {score.version > 0 && !readOnly ? (
          <label className="field-group" htmlFor={`${formId}-reason`}>
            <span>Correction reason</span>
            <textarea
              id={`${formId}-reason`}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                mutationContext.current = resetScoreMutationContext();
                setMessage("");
                setMessageTone("");
              }}
              maxLength={500}
              rows={2}
              disabled={pending}
              aria-describedby={`${formId}-reason-help`}
            />
            <small id={`${formId}-reason-help`} className="field-help">
              Required to change a score that’s already saved. Up to 500
              characters.
            </small>
          </label>
        ) : null}

        <dl className="group-profile-facts">
          <div>
            <dt>Plus/minus as you type</dt>
            <dd>
              {formatServerValue(typedPlusMinus)} <small>Preview only</small>
            </dd>
          </div>
          <div>
            <dt>Plus/minus</dt>
            <dd>{formatServerValue(score.plusMinus)}</dd>
          </div>
          <div>
            <dt>Ranking value</dt>
            <dd>{formatServerValue(score.rankingValue)}</dd>
          </div>
        </dl>

        {message ? (
          <p className={`form-message ${messageTone}`} role="status">
            {message}
          </p>
        ) : null}
        <button
          className="primary-button"
          type="submit"
          disabled={readOnly || pending}
        >
          {pending ? "Saving score…" : "Save score"}
        </button>
      </form>
    </article>
  );
}

function ScoreFieldInput({
  field,
  formId,
  playerLabel,
  value,
  confirmedValue,
  disabled,
  onChange,
}: Readonly<{
  field: RoundScoreField;
  formId: string;
  playerLabel: string;
  value: string;
  confirmedValue: string | null;
  disabled: boolean;
  onChange: (value: string) => void;
}>) {
  const inputId = `${formId}-${field}`;
  const helpId = `${inputId}-help`;
  const constraints = fieldConstraints[field];
  return (
    <label className="field-group" htmlFor={inputId}>
      <span>{fieldLabels[field]}</span>
      <input
        id={inputId}
        type="number"
        inputMode="decimal"
        min={constraints.min}
        max={constraints.max}
        step={constraints.step}
        value={value}
        placeholder="Missing"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`${fieldLabels[field]} for ${playerLabel}`}
        aria-describedby={helpId}
      />
      <small id={helpId} className="field-help">
        Saved: {formatServerValue(confirmedValue)}
      </small>
    </label>
  );
}

function scoreFromReceipt(receipt: RoundScoreReceipt): RoundScoreCurrentState {
  return {
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
}

function formatServerValues(
  score: RoundScoreCurrentState,
  fields: readonly RoundScoreField[],
): string {
  return fields
    .map(
      (field) =>
        `${fieldLabels[field]}: ${formatServerValue(scoreValueForField(score, field))}`,
    )
    .join(" · ");
}

function formatServerValue(value: string | null): string {
  return value === null ? "Missing" : value;
}

function participantSyncKey(participant: LiveRoundScoreParticipant): string {
  return [
    participant.participantId,
    participant.rsvpStatus,
    participant.participantVersion,
    participant.score.version,
    participant.score.revisionId ?? "missing",
  ].join(":");
}
