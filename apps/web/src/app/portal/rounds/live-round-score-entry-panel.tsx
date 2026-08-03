"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { setRoundParticipantScoreAction } from "@/app/actions/rounds";
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
      className="group-roles-panel live-score-entry"
      aria-labelledby="live-score-entry-title"
    >
      <div className="group-panel-heading">
        <div>
          <p className="ledger-kicker">Round-day operations</p>
          <h2 id="live-score-entry-title">Enter live scores</h2>
        </div>
        <p>
          {participants.length} participant
          {participants.length === 1 ? "" : "s"}
        </p>
      </div>
      <p>
        Enter only the enabled final-total fields. The server confirms each
        revision and calculates plus/minus and ranking values; blank values stay
        Missing and are never treated as zero.
      </p>
      {participants.length === 0 ? (
        <p className="group-empty" role="status">
          No participants are available for live score entry.
        </p>
      ) : (
        <div className="group-role-list">
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
  const displayName = name || "Unnamed participant";
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
      setMessage("Change at least one score field before saving.");
      setMessageTone("error");
      return;
    }

    const normalizedReason = reason.trim();
    const requiresCorrectionReason = Object.keys(changedFields).some(
      (field) => scoreValueForField(score, field as RoundScoreField) !== null,
    );
    if (requiresCorrectionReason && !normalizedReason) {
      setMessage("Add a correction reason when replacing a confirmed value.");
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
        setMessage("The score service is temporarily unavailable. Try again.");
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
              ? "This score changed on the server. The current server values are shown below; re-enter your intended value before saving."
              : "This score changed on the server. Refresh the current values and re-enter your intended value before saving.",
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
      setMessage("Score saved and confirmed by the server.");
      setMessageTone("success");
      mutationContext.current = resetScoreMutationContext();
    });
  }

  return (
    <article
      className="group-role-row"
      data-score-state={scoreState.toLowerCase()}
    >
      <div className="group-panel-heading">
        <div>
          <h3>{playerLabel}</h3>
          <p>
            {locked
              ? "Not playing · score entry locked"
              : participant.canEdit
                ? "Playing · coordinator/admin entry"
                : "Playing · score entry read-only"}
          </p>
        </div>
        <p>{scoreState}</p>
      </div>

      {staleCurrentScore ? (
        <aside className="form-message error" role="alert">
          <strong>Current server values</strong>
          <span>{formatServerValues(staleCurrentScore, fields)}</span>
          <span>
            Re-enter the intended value before saving; nothing was overwritten.
          </span>
        </aside>
      ) : null}

      <form
        id={formId}
        className="group-profile-form"
        onSubmit={submit}
        aria-busy={pending}
        noValidate
      >
        <div className="group-profile-fields">
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
              Required when replacing a confirmed value (500 characters
              maximum).
            </small>
          </label>
        ) : null}

        <dl className="group-profile-facts">
          <div>
            <dt>Typed points plus/minus preview</dt>
            <dd>
              {formatServerValue(typedPlusMinus)} <small>Preview only</small>
            </dd>
          </div>
          <div>
            <dt>Server-confirmed plus/minus</dt>
            <dd>{formatServerValue(score.plusMinus)}</dd>
          </div>
          <div>
            <dt>Server ranking value</dt>
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
        Server value: {formatServerValue(confirmedValue)}
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
