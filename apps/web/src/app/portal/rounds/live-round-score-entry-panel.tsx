"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { setRoundParticipantScoreAction } from "@/app/actions/rounds";
import { EmptyState, FormMessage, SectionHeading } from "@/components/blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
      className="mt-10 pt-8 border-t [&>h2]:mx-0 [&>h2]:text-[1.5rem] [&>h2]:font-semibold [&>h2]:mt-1.5! [&>h2]:mb-0! live-score-entry"
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
        Enter each player&apos;s totals. A blank score shows as Missing and
        doesn&apos;t count as zero.
      </p>
      {participants.length === 0 ? (
        <EmptyState>No players are available to score yet.</EmptyState>
      ) : (
        <div className="mx-0 mt-6 mb-0 p-0 gap-3 grid list-none">
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
      : "Saved";
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
      setMessage("Check the scores and try again.");
      setMessageTone("error");
      return;
    }

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof setRoundParticipantScoreAction>>;
      try {
        result = await setRoundParticipantScoreAction(parsed.data);
      } catch {
        setMessage("We couldn't save the score. Try again.");
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
    <article
      className="p-4 gap-4 border border-border/50 flex items-center justify-between bg-muted max-[720px]:items-start max-[720px]:flex-col [&_p]:mx-0 [&_p]:mb-0 [&_p]:text-muted-foreground [&_p]:mt-[0.35rem]! [&_p]:text-[0.8125rem]!"
      data-score-state={scoreState.toLowerCase()}
    >
      <div className="gap-4 flex items-end justify-between max-[720px]:items-start max-[720px]:flex-col [&>p]:mx-0 [&>p]:mb-0 [&>p]:text-muted-foreground [&>p]:whitespace-nowrap [&>p]:mt-0! [&>p]:text-[0.75rem]! [&_h2]:mx-0 [&_h2]:mt-1.5 [&_h2]:mb-0 [&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_h3]:mx-0 [&_h3]:mt-1.5 [&_h3]:mb-0">
        <div>
          <h3>{playerLabel}</h3>
          <p>
            {locked
              ? "Not playing · no scores"
              : participant.canEdit
                ? "Playing · you can enter scores"
                : "Playing · view only"}
          </p>
        </div>
        <p>{scoreState}</p>
      </div>

      {staleCurrentScore ? (
        <FormMessage role="alert">
          <strong>Current scores</strong>
          <span>{formatServerValues(staleCurrentScore, fields)}</span>
          <span>Enter your score again to save it.</span>
        </FormMessage>
      ) : null}

      <form
        id={formId}
        className="mt-5 gap-5 grid [:where(&)>*]:my-0"
        data-slot="form-stack"
        onSubmit={submit}
        aria-busy={pending}
        noValidate
      >
        <div className="grid grid-cols-2 gap-y-5 gap-x-4 max-[720px]:grid-cols-[1fr]">
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
          <label
            className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
            data-slot="field"
            htmlFor={`${formId}-reason`}
          >
            <span>Reason for the change</span>
            <Textarea
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
            <small
              id={`${formId}-reason-help`}
              className="m-0 min-h-5 text-[0.8125rem] leading-[1.45] text-muted-foreground [&_a]:text-primary [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-[0.2em]"
              data-slot="field-help"
            >
              Required to change a score that’s already saved.
            </small>
          </label>
        ) : null}

        <dl className="mx-0 mt-5 mb-0 gap-4 grid grid-cols-2 max-[720px]:grid-cols-[1fr] [&_dd]:mx-0 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:text-muted-foreground [&_dd]:leading-[1.45] [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground [&_dt]:text-[0.6875rem] [&_dt]:tracking-[0.08em] [&_dt]:uppercase">
          <div>
            <dt>Plus/minus as you type</dt>
            <dd>{formatServerValue(typedPlusMinus)} </dd>
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
          <FormMessage
            tone={messageTone === "success" ? "success" : "error"}
            role="status"
          >
            {message}
          </FormMessage>
        ) : null}
        <Button type="submit" disabled={readOnly || pending}>
          {pending ? "Saving score…" : "Save score"}
        </Button>
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
    <label
      className="gap-2 grid [&>label]:text-[0.8125rem] [&>label]:font-bold [&>label]:tracking-[0.015em] [&>span]:text-[0.8125rem] [&>span]:font-bold [&>span]:tracking-[0.015em]"
      data-slot="field"
      htmlFor={inputId}
    >
      <span>{fieldLabels[field]}</span>
      <Input
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
      <small
        id={helpId}
        className="m-0 min-h-5 text-[0.8125rem] leading-[1.45] text-muted-foreground [&_a]:text-primary [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-[0.2em]"
        data-slot="field-help"
      >
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
